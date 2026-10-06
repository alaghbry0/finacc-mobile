import { z } from 'zod';
import { getDb } from '@/db/client';
import type { DbEngine } from '@/db/types';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getSetting } from './settings';
import { getRateSnapshot, getBaseCurrency } from './currency';
import { assertPeriodOpen, assertBackdateAllowed } from './fiscal';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';
import { customerBalances } from './parties';
import { computeInvoiceTotals, assertTotalsValid, type InvoiceLineInput, type InvoiceTotals } from './invoice-math';
import { nextDocNumber } from './docseq';

/**
 * فاتورة البيع — الحفظ الذرّي وآلة الحالات (الوحدة 02 + قرار 2 + قاعدة 5.4-4):
 *
 * ── آلة الحالات (جدول 5.4-2) ─────────────────────────────────────────────
 *   إنشاء مكتمل (نقدي/آجل/مختلط) → completed + رقم + كامل الآثار فوراً
 *   حفظ كمسودة (saveAsDraft)     → draft بلا رقم ولا أي أثر مالي/مخزوني
 *   تحويل المسودة                → completed + يُستهلك الرقم الآن + فحص الرصيد
 *                                  وقت التحويل (FR-02-18) + issued_at = اليوم
 *   إلغاء (void)                 → حركات معاكسة كاملة (لا حذف) + الرقم لا يُعاد
 *
 * ── قرارات موثقة داخل هذا الملف ───────────────────────────────────────────
 * 1) «سند القبض لحظة البيع لا يحمل customer_id»: معادلة رصيد العميل (FR-03-02)
 *    تطرح كل قبض مربوط بالعميل كتحصيل لدين سابق؛ والجزء النقدي لفاتورة mixed
 *    ليس تحصيلاً لدين بل دفعة فورية — فحملُه customer_id كان سيخصم مرتين.
 *    الربط يبقى محفوظاً عبر payment_allocation ← invoice.customer_id.
 * 2) التسلسل (runSerialized): محرك sql.js ينفّذ المعاملات المتوازية كـ
 *    SAVEPOINTs متداخلة تحت أول BEGIN فيُنهيها أول COMMIT — لذا تمر كل كتابات
 *    هذه الوحدة عبر سلسلة تسلسل واحدة (نفس مبرر docseq.ts) فتبقى الذرّة
 *    صحيحة تحت Promise.all (اختبار 100 فاتورة متوازية).
 * 3) سطر الخدمة الحرة (productId=null): lineDesc إلزامي، بلا مخزون، line_cost=0
 *    (قرار 5)؛ والصنف الخدمي المسجل كذلك بلا أثر مخزوني.
 */

// ============ الأخطاء (عقود الواجهة) ============

/** نقص المخزون — رسالة نمط 6.3 تسمّي الصنف والكمية الناقصة (قرار 9). */
export class StockShortageError extends Error {
  readonly productName: string;
  readonly requested: string;
  readonly available: string;
  constructor(productName: string, requested: string, available: string) {
    const missing = dec(requested).minus(dec(available));
    super(
      `كمية «${productName}» المطلوبة ${requested} والمتاح منها ${available} فقط — ينقص ${money(missing)}. ` +
        'خفّض الكمية أو احذف الزيادة',
    );
    this.name = 'StockShortageError';
    this.productName = productName;
    this.requested = requested;
    this.available = available;
  }
}

/** تجاوز حد ائتمان العميل مع parties.credit_limit_action=warn — يتطلب تأكيداً (FR-03-05). */
export class CreditLimitConfirmationRequiredError extends Error {
  readonly customerId: number;
  readonly customerName: string;
  readonly creditLimit: string;
  readonly projectedBalance: string;
  constructor(customerName: string, creditLimit: string, projectedBalance: string, customerId: number) {
    super(
      `تجاوز حد الائتمان للعميل «${customerName}»: الرصيد بعد الفاتورة (${projectedBalance}) يتجاوز الحد (${creditLimit}). ` +
        'خفّض المبلغ الآجل أو أكّد تجاوز الحد للمتابعة',
    );
    this.name = 'CreditLimitConfirmationRequiredError';
    this.customerId = customerId;
    this.customerName = customerName;
    this.creditLimit = creditLimit;
    this.projectedBalance = projectedBalance;
  }
}

// ============ الأنواع والعقود ============

export interface SaleItemInput {
  /** null = سطر خدمة حرة (قرار 5 — lineDesc إلزامي وبلا مخزون). */
  productId: number | null;
  lineDesc?: string;
  qty: string;
  unitPrice: string;
  discountPercent?: string;
  /** لكل البند — يُستخدم فقط في نمط الضريبة per_item. */
  taxPercent?: string;
}

export type SalePayType = 'cash' | 'credit' | 'mixed';

export interface SaveSaleInput {
  items: SaleItemInput[];
  payType: SalePayType;
  /** مطلوب لـ mixed (≤ total)؛ payType=cash يتجاهله (= total). */
  cashPart?: string;
  /** إلزامي لـ credit/mixed (غير المسودة). */
  customerId?: number | null;
  /** إلزامي لـ cash/mixed (غير المسودة). */
  cashboxId?: number | null;
  warehouseId: number;
  currencyId: number;
  invoiceDiscount?: string;
  notesInternal?: string;
  notesPrinted?: string;
  /** افتراضي اليوم (YYYY-MM-DD). */
  issuedAt?: string;
  /** draft: بلا رقم ولا أثر (قرار 2). */
  saveAsDraft?: boolean;
  managerConfirmedBackdate?: boolean;
  /** تجاوز تحذير حد الائتمان (parties.credit_limit_action=warn). */
  creditLimitConfirmed?: boolean;
}

export interface SaveSaleResult {
  invoiceId: number;
  invoiceNo: string | null;
  payStatus: SalePayType;
  total: string;
  dueAmount: string;
}

export interface ConvertDraftOpts {
  payType?: SalePayType;
  cashPart?: string;
  customerId?: number | null;
  cashboxId?: number | null;
  managerConfirmedBackdate?: boolean;
  creditLimitConfirmed?: boolean;
}

// ============ التحقق (zod) ============

const POS_MONEY_RE = /^\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const qtyField = z
  .string()
  .regex(POS_MONEY_RE, 'الكمية يجب أن تكون رقماً أكبر من صفر مثل «2» أو «0.5»')
  .refine((s) => dec(s).greaterThan(0), { message: 'الكمية يجب أن تكون أكبر من صفر' });

const priceField = z
  .string()
  .regex(POS_MONEY_RE, 'السعر يجب أن يكون رقماً غير سالب مثل «150» أو «12500.50»');

const SaleItemSchema = z.object({
  productId: z.number().int().positive('رقم الصنف غير صالح').nullable(),
  lineDesc: z.string().trim().max(200, 'وصف السطر طويل جداً (الحد 200 حرف)').optional(),
  qty: qtyField,
  unitPrice: priceField,
  discountPercent: z.string().regex(POS_MONEY_RE, 'نسبة الخصم يجب أن تكون بين 0 و 100').optional(),
  taxPercent: z.string().regex(POS_MONEY_RE, 'نسبة الضريبة يجب أن تكون رقماً غير سالب').optional(),
});

const SaveSaleSchema = z.object({
  items: z.array(SaleItemSchema).min(1, 'لا يمكن حفظ فاتورة بلا بنود — أضف صنفاً واحداً على الأقل'),
  payType: z.enum(['cash', 'credit', 'mixed']),
  cashPart: z.string().regex(POS_MONEY_RE, 'الجزء النقدي يجب أن يكون رقماً موجباً').optional(),
  customerId: z.number().int().positive('رقم العميل غير صالح').nullable().optional(),
  cashboxId: z.number().int().positive('رقم الصندوق غير صالح').nullable().optional(),
  warehouseId: z.number().int().positive('المستودع مطلوب — اختر المستودع من شريط الأعلى قبل الحفظ'),
  currencyId: z.number().int().positive('العملة مطلوبة — اختر عملة الفاتورة'),
  invoiceDiscount: z.string().regex(POS_MONEY_RE, 'خصم الفاتورة يجب أن يكون رقماً غير سالب').optional(),
  notesInternal: z.string().trim().max(500, 'الملاحظة الداخلية طويلة (الحد 500 حرف)').optional(),
  notesPrinted: z.string().trim().max(500, 'الملاحظة المطبوعة طويلة (الحد 500 حرف)').optional(),
  issuedAt: z.string().regex(ISO_DATE_RE, 'تاريخ الفاتورة يجب أن يكون بصيغة YYYY-MM-DD').optional(),
  saveAsDraft: z.boolean().optional(),
  managerConfirmedBackdate: z.boolean().optional(),
  creditLimitConfirmed: z.boolean().optional(),
});

type SaveSaleParsed = z.output<typeof SaveSaleSchema>;

function parseOrThrow(input: SaveSaleInput): SaveSaleParsed {
  const parsed = SaveSaleSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error!.issues[0];
    throw new Error(
      `مدخلات فاتورة البيع غير مكتملة: ${issue?.message ?? 'راجع البنود'} (الحقل: ${issue?.path?.join('.') ?? '?'})`,
    );
  }
  return parsed.data;
}

// ============ التسلسل (انظر القرار 2 أعلاه) ============

let writeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

// ============ سياق الحساب المشترك ============

interface ProductLite {
  id: number;
  name: string;
  costPrice: Decimal;
  isService: boolean;
}

interface SaleCtx {
  db: DbEngine;
  now: string;
  issuedAt: string;
  warehouseId: number;
  currencyId: number;
  rate: string;
  rateIsFallback: boolean;
  taxMode: 'per_item' | 'on_total';
  taxRate: string;
  products: Map<number, ProductLite>;
  totals: InvoiceTotals;
  payType: SalePayType;
  paid: Decimal;
  due: Decimal;
  customerId: number | null;
  cashboxId: number | null;
}

async function loadProducts(db: DbEngine, items: SaleItemInput[]): Promise<Map<number, ProductLite>> {
  const ids = [...new Set(items.filter((it) => it.productId !== null).map((it) => it.productId as number))];
  const products = new Map<number, ProductLite>();
  for (const id of ids) {
    const rows = await db.all<{ id: number; name: string; cost_price: string | number | null; is_service: number; is_archived: number }>(
      'SELECT id, name, cost_price, is_service, is_archived FROM product WHERE id = ?',
      [id],
    );
    const r = rows[0];
    if (r === undefined) {
      throw new Error(`صنف غير موجود (رقم ${id}) — ربما حُذف رابطه، أعد إضافة الصنف للفاتورة`);
    }
    if (Number(r.is_archived) === 1) {
      throw new Error(`الصنف «${r.name}» مؤرشف ولا يمكن بيعه — أعد تفعيله من شاشة المخزون أولاً`);
    }
    products.set(Number(r.id), {
      id: Number(r.id),
      name: r.name,
      costPrice: dec(r.cost_price ?? 0),
      isService: Number(r.is_service) === 1,
    });
  }
  return products;
}

/** بناء السياق: تحقق + حسابات + سعر صرف + فترات + دفع + حد ائتمان (بلا كتابة). */
async function buildSaleCtx(db: DbEngine, v: SaveSaleParsed, opts: { fromDraft?: boolean }): Promise<SaleCtx> {
  const now = new Date().toISOString();
  const issuedAt = v.issuedAt ?? todayISO();
  const isDraft = v.saveAsDraft === true;

  // 1) المراجع: مستودع/عملة (+ صندوق/عميل عند الحاجة)
  const wh = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM warehouse WHERE id = ? AND is_archived = 0',
    [v.warehouseId],
  );
  if (wh.length === 0) {
    throw new Error(`المستودع (رقم ${v.warehouseId}) غير موجود أو مؤرشف — اختر مستودعاً صالحاً`);
  }
  const cur = await db.all<{ id: number; code: string; is_active: number }>(
    'SELECT id, code, is_active FROM currency WHERE id = ?',
    [v.currencyId],
  );
  if (cur.length === 0 || Number(cur[0]!.is_active) !== 1) {
    throw new Error(`العملة (رقم ${v.currencyId}) غير موجودة أو موقوفة — اختر عملة مفعلة`);
  }

  // 2) الأصناف والخدمات
  const products = await loadProducts(db, v.items);
  for (const it of v.items) {
    if (it.productId === null && (it.lineDesc ?? '').trim().length === 0) {
      throw new Error('سطر الخدمة الحرة يتطلب وصفاً — أدخل وصف البند (مثل «توصيل») أو اربطه بصنف');
    }
  }

  // 3) الحسابات (computeInvoiceTotals فقط — لا حساب يدوي)
  const taxModeRaw = await getSetting('invoicing.tax_mode');
  const taxMode: 'per_item' | 'on_total' = taxModeRaw === 'per_item' ? 'per_item' : 'on_total';
  const companyRows = await db.all<{ tax_rate: string | number | null }>('SELECT tax_rate FROM company LIMIT 1');
  const taxRate = money(companyRows[0]?.tax_rate ?? 0);

  const lines: InvoiceLineInput[] = v.items.map((it) => {
    const p = it.productId !== null ? products.get(it.productId) : undefined;
    const lineCost = p !== undefined && !p.isService ? money(roundTo(p.costPrice.times(dec(it.qty)), 4)) : '0';
    return {
      productId: it.productId,
      lineDesc: it.lineDesc,
      qty: it.qty,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent ?? '0',
      taxPercent: it.taxPercent ?? '0',
      lineCost,
    };
  });
  const totals = computeInvoiceTotals(lines, { taxMode, taxRate, invoiceDiscount: v.invoiceDiscount ?? '0' });
  assertTotalsValid(totals); // منع صافي ≤ 0 (FR-02-05)

  // 4) سعر الصرف (قرار 3): MissingRateError تمر كما هي — قبل أي كتابة
  const base = await getBaseCurrency();
  const snapshot = v.currencyId === base.id ? { rate: '1', rateIsFallback: false } : await getRateSnapshot(v.currencyId, issuedAt);

  // 5) الفترات والتأريخ (قاعدة 5.4-11 + قرار 6) — assertBackdateAllowed يقيّد backdate في audit
  await assertPeriodOpen(issuedAt);
  await assertBackdateAllowed(issuedAt, { managerConfirmed: v.managerConfirmedBackdate });

  const total = dec(totals.total);

  // 6) تقسيم الدفع (المسودة: نوايا بلا متطلبات)
  let paid = dec(0);
  let due = dec(0);
  if (isDraft) {
    due = total;
  } else if (v.payType === 'cash') {
    paid = total;
  } else if (v.payType === 'credit') {
    due = total;
  } else {
    if (v.cashPart === undefined || v.cashPart === '') {
      throw new Error('الفاتورة المختلطة تتطلب مبلغ الجزء النقدي — أدخل المبلغ المدفوع نقداً أو اختر نوع دفع آخر');
    }
    const cp = dec(v.cashPart);
    if (cp.lessThanOrEqualTo(0)) {
      throw new Error('الجزء النقدي في الفاتورة المختلطة يجب أن يكون أكبر من صفر — للآجل الكامل استخدم «حفظ آجل»');
    }
    if (cp.greaterThan(total)) {
      throw new Error('الجزء النقدي أكبر من إجمالي الفاتورة — خفّض المبلغ أو استخدم الدفع النقدي الكامل');
    }
    paid = cp;
    due = total.minus(cp);
  }

  // 7) متطلبات الطرف/الصندوق (للمكتملة فقط)
  let customerId: number | null = v.customerId ?? null;
  let cashboxId: number | null = v.cashboxId ?? null;
  if (!isDraft) {
    if ((v.payType === 'credit' || v.payType === 'mixed') && customerId === null) {
      throw new Error('حفظ الفاتورة الآجلة يتطلب اختيار عميل أولاً — اختر العميل من شريط الأعلى أو استخدم الدفع النقدي');
    }
    if ((v.payType === 'cash' || v.payType === 'mixed') && cashboxId === null) {
      throw new Error('الدفع النقدي يتطلب اختيار صندوق — اختر الصندوق من شريط الأعلى قبل الحفظ');
    }
  }
  if (customerId !== null) {
    const cust = await db.all<{ id: number; name: string; is_archived: number }>(
      'SELECT id, name, is_archived FROM customer WHERE id = ?',
      [customerId],
    );
    if (cust.length === 0) {
      throw new Error(`عميل غير موجود (رقم ${customerId}) — أعد اختيار العميل من القائمة`);
    }
    if (Number(cust[0]!.is_archived) === 1) {
      throw new Error(`العميل «${cust[0]!.name}» مؤرشف — أعد تفعيله من شاشة الأطراف أولاً`);
    }
  }
  if (cashboxId !== null) {
    const box = await db.all<{ id: number; name: string; is_archived: number }>(
      'SELECT id, name, is_archived FROM cashbox WHERE id = ?',
      [cashboxId],
    );
    if (box.length === 0) {
      throw new Error(`صندوق غير موجود (رقم ${cashboxId}) — أعد اختيار الصندوق`);
    }
    if (Number(box[0]!.is_archived) === 1) {
      throw new Error(`الصندوق «${box[0]!.name}» مؤرشف — اختر صندوقاً فاعلاً`);
    }
  }

  // 8) فحص المخزون قبل أي كتابة (قرار 9 — لا مسار يحفظ وينقص سالباً)
  //    المسودة لا تُنقص شيئاً فلا تُفحص (الفحص وقت التحويل — FR-02-18)
  if (!isDraft) {
    await assertStockAvailable(db, v.items, v.warehouseId, products);
  }

  // 9) حد الائتمان (FR-03-05) — للمكتملة الآجلة/المختلطة
  if (!isDraft && (v.payType === 'credit' || v.payType === 'mixed') && customerId !== null) {
    await assertCreditLimit(db, customerId, v.currencyId, due, v.creditLimitConfirmed === true);
  }

  return {
    db,
    now,
    issuedAt,
    warehouseId: v.warehouseId,
    currencyId: v.currencyId,
    rate: snapshot.rate,
    rateIsFallback: snapshot.rateIsFallback,
    taxMode,
    taxRate,
    products,
    totals,
    payType: v.payType,
    paid,
    due,
    customerId,
    cashboxId,
  };
}

/** جمع الكميات لكل صنف غير خدمي ومقارنتها برصيد المستودع — أول نقص يرمي. */
async function assertStockAvailable(
  db: DbEngine,
  items: SaleItemInput[],
  warehouseId: number,
  products: Map<number, ProductLite>,
): Promise<void> {
  const requested = new Map<number, Decimal>();
  for (const it of items) {
    if (it.productId === null) continue;
    const p = products.get(it.productId);
    if (p === undefined || p.isService) continue;
    requested.set(it.productId, (requested.get(it.productId) ?? dec(0)).plus(dec(it.qty)));
  }
  for (const [productId, qty] of requested) {
    const rows = await db.all<{ qty: string | number }>(
      'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
      [productId, warehouseId],
    );
    const available = dec(rows[0]?.qty ?? 0);
    if (qty.greaterThan(available)) {
      const p = products.get(productId)!;
      throw new StockShortageError(p.name, money(qty), money(available));
    }
  }
}

/** حد ائتمان العميل: 0 يمنع الآجل كلياً، والتجاوز حسب parties.credit_limit_action. */
async function assertCreditLimit(
  db: DbEngine,
  customerId: number,
  currencyId: number,
  due: Decimal,
  confirmed: boolean,
): Promise<void> {
  const rows = await db.all<{ name: string; credit_limit: string | number | null }>(
    'SELECT name, credit_limit FROM customer WHERE id = ?',
    [customerId],
  );
  const cust = rows[0];
  if (cust === undefined || cust.credit_limit === null) return; // null = بلا حد
  const limit = dec(cust.credit_limit);
  if (limit.isZero()) {
    throw new Error(
      `البيع الآجل ممنوع للعميل «${cust.name}» — حد الائتمان مضبوط على صفر. ` +
        'اختر الدفع النقدي أو عدّل حد الائتمان من ملف العميل',
    );
  }
  const balances = await customerBalances(customerId);
  const current = dec(balances.find((b) => b.currencyId === currencyId)?.balance ?? 0);
  const projected = current.plus(due);
  if (!projected.greaterThan(limit)) return;

  const action = await getSetting('parties.credit_limit_action');
  if (action === 'block') {
    throw new Error(
      `تجاوز حد الائتمان للعميل «${cust.name}» (الحد ${money(limit)} والرصيد بعد الفاتورة ${money(projected)}) — ` +
        'الإعداد يمنع الحفظ. خفّض المبلغ الآجل أو عدّل الحد من ملف العميل',
    );
  }
  if (!confirmed) {
    throw new CreditLimitConfirmationRequiredError(cust.name, money(limit), money(projected), customerId);
  }
}

// ============ الكتابات المشتركة ============

async function insertSaleItems(db: DbEngine, ctx: SaleCtx, invoiceId: number, items: SaleItemInput[]): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const line = ctx.totals.lines[i]!;
    await db.run(
      'INSERT INTO invoice_item(invoice_id, product_id, line_desc, qty, unit_id, unit_factor, unit_price, ' +
        'discount_percent, discount_amount, tax_percent, line_total, line_cost, created_at) ' +
        'VALUES(?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)',
      [
        invoiceId,
        it.productId,
        it.lineDesc?.trim() || null,
        money(dec(it.qty)),
        money(dec(it.unitPrice)),
        money(dec(it.discountPercent ?? '0')),
        money(dec(line.lineDiscount)),
        ctx.taxMode === 'per_item' ? money(dec(it.taxPercent ?? '0')) : '0',
        money(dec(line.lineTotal)),
        money(dec(line.lineCost)),
        ctx.now,
      ],
    );
  }
}

/** حركات المخزون (sale سالبة) + تحديث stock_level — للأصناف غير الخدمية فقط. */
async function applyStockOut(db: DbEngine, ctx: SaleCtx, invoiceId: number, items: SaleItemInput[]): Promise<void> {
  for (const it of items) {
    if (it.productId === null) continue;
    const p = ctx.products.get(it.productId);
    if (p === undefined || p.isService) continue;
    const qty = dec(it.qty).neg();
    await db.run(
      'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
        "VALUES(?, ?, 'sale', ?, ?, 'invoice', ?, ?, NULL, ?, ?)",
      [p.id, ctx.warehouseId, money(qty), money(p.costPrice), invoiceId, ctx.now, ctx.now, getCurrentUserId() ?? null],
    );
    // ملاحظة محرك: UPSERT بقيمة سالبة يفشل على CHECK qty>=0 قبل معالجة التعارض —
    // صف الرصيد موجود حتماً بعد فحص التوفر (متاح ≥ مطلوب > 0)، فيكفي UPDATE مباشر.
    const res = await db.run(
      'UPDATE stock_level SET qty = qty + ? WHERE product_id = ? AND warehouse_id = ?',
      [money(qty), p.id, ctx.warehouseId],
    );
    if (res.changes === 0) {
      // دفاعي (لا يُفترض الوصول إليه بعد فحص النقص) — قرار 9: لا مسار يحفظ سالباً
      throw new StockShortageError(p.name, money(dec(it.qty)), '0');
    }
  }
}

/**
 * حركة القبض + التخصيص للجزء النقدي.
 * ملاحظة (قرار موثق أعلاه): customer_id=NULL — الجزء النقدي ليس تحصيلاً لدين سابق،
 * ومعادلة رصيد العميل تطرح القبضات المربوطة بالعميل فقط.
 */
async function applyCashIn(db: DbEngine, ctx: SaleCtx, invoiceId: number): Promise<void> {
  if (ctx.paid.lessThanOrEqualTo(0) || ctx.cashboxId === null) return;
  const res = await db.run(
    'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
      'customer_id, is_voided, description, created_at, created_by) ' +
      "VALUES('receipt', ?, ?, ?, ?, ?, 'invoice', ?, NULL, 0, ?, ?, ?)",
    [
      ctx.cashboxId,
      ctx.currencyId,
      money(ctx.paid),
      ctx.rate,
      ctx.issuedAt,
      invoiceId,
      `تحصيل نقدي لفاتورة البيع رقم ${invoiceId}`,
      ctx.now,
      getCurrentUserId() ?? null,
    ],
  );
  await db.run(
    'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
    [Number(res.lastInsertRowId), invoiceId, money(ctx.paid), ctx.now, getCurrentUserId() ?? null],
  );
}

function invoiceValues(ctx: SaleCtx, v: SaveSaleParsed, invoiceNo: string | null, status: 'draft' | 'completed') {
  return {
    invoiceNo,
    payStatus: v.payType,
    status,
    subtotal: money(dec(ctx.totals.subtotal)),
    discountAmount: money(dec(ctx.totals.invoiceDiscount)),
    taxRate: ctx.taxRate,
    taxAmount: money(dec(ctx.totals.taxAmount)),
    total: money(dec(ctx.totals.total)),
    totalBase: money(roundTo(dec(ctx.totals.total).times(dec(ctx.rate)), 4)),
    paidAmount: money(ctx.paid),
    dueAmount: money(ctx.due),
    costTotal: money(dec(ctx.totals.costTotal)),
  };
}

// ============ الحفظ (saveSaleInvoice) ============

export async function saveSaleInvoice(input: SaveSaleInput): Promise<SaveSaleResult> {
  const v = parseOrThrow(input);
  return runSerialized(() => persistNewSale(v));
}

async function persistNewSale(v: SaveSaleParsed): Promise<SaveSaleResult> {
  const db = await getDb();
  return db.transaction(async () => {
    const ctx = await buildSaleCtx(db, v, {});
    const isDraft = v.saveAsDraft === true;

    // الرقم للمكتملة فقط (قرار 2/6) — يُستهلك داخل نفس المعاملة فيرجع معها عند الفشل
    let invoiceNo: string | null = null;
    if (!isDraft) {
      invoiceNo = (await nextDocNumber('INV', { date: ctx.issuedAt })).docNo;
    }

    const vals = invoiceValues(ctx, v, invoiceNo, isDraft ? 'draft' : 'completed');
    const res = await db.run(
      'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, customer_id, cashbox_id, warehouse_id, ' +
        'currency_id, exchange_rate, rate_is_fallback, subtotal, discount_amount, tax_rate, tax_amount, total, total_base, ' +
        'paid_amount, due_amount, cost_total, notes_internal, notes_printed, created_at, updated_at, created_by) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        vals.invoiceNo,
        'sale',
        vals.payStatus,
        vals.status,
        ctx.issuedAt,
        ctx.customerId,
        ctx.cashboxId,
        ctx.warehouseId,
        ctx.currencyId,
        ctx.rate,
        ctx.rateIsFallback ? 1 : 0,
        vals.subtotal,
        vals.discountAmount,
        vals.taxRate,
        vals.taxAmount,
        vals.total,
        vals.totalBase,
        vals.paidAmount,
        vals.dueAmount,
        vals.costTotal,
        v.notesInternal?.trim() || null,
        v.notesPrinted?.trim() || null,
        ctx.now,
        ctx.now,
        getCurrentUserId() ?? null,
      ],
    );
    const invoiceId = Number(res.lastInsertRowId);
    await insertSaleItems(db, ctx, invoiceId, v.items);

    if (!isDraft) {
      await applyStockOut(db, ctx, invoiceId, v.items);
      await applyCashIn(db, ctx, invoiceId);
    }

    return {
      invoiceId,
      invoiceNo,
      payStatus: v.payType,
      total: vals.total,
      dueAmount: vals.dueAmount,
    };
  });
}

// ============ تحويل المسودة (convertDraftToCompleted — FR-02-18) ============

export async function convertDraftToCompleted(draftId: number, opts?: ConvertDraftOpts): Promise<SaveSaleResult> {
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const rows = await db.all<{
        id: number; invoice_no: string | null; doc_type: string; pay_status: string; status: string;
        customer_id: number | null; cashbox_id: number | null; warehouse_id: number; currency_id: number;
        discount_amount: string | number; notes_internal: string | null; notes_printed: string | null;
      }>('SELECT * FROM invoice WHERE id = ?', [draftId]);
      const draft = rows[0];
      if (draft === undefined) {
        throw new Error(`فاتورة غير موجودة (رقم ${draftId}) — ربما حُذف الرابط، عد للقائمة وأعد المحاولة`);
      }
      if (draft.doc_type !== 'sale') {
        throw new Error('هذا المستند ليس فاتورة بيع — التحويل متاح لمسودات البيع فقط');
      }
      if (draft.status !== 'draft') {
        throw new Error('يمكن تحويل المسودات فقط — هذه الفاتورة مكتملة أو ملغاة بالفعل');
      }

      const itemRows = await db.all<{
        id: number; product_id: number | null; line_desc: string | null; qty: string | number;
        unit_price: string | number; discount_percent: string | number | null; tax_percent: string | number | null;
      }>('SELECT * FROM invoice_item WHERE invoice_id = ? ORDER BY id ASC', [draftId]);

      const items: SaleItemInput[] = itemRows.map((r) => ({
        productId: r.product_id === null ? null : Number(r.product_id),
        lineDesc: r.line_desc ?? undefined,
        qty: money(r.qty),
        unitPrice: money(r.unit_price),
        discountPercent: money(r.discount_percent ?? 0),
        taxPercent: money(r.tax_percent ?? 0),
      }));

      // issued_at = تاريخ التحويل (قرار 2) — اليوم داخل حدود التأريخ دائماً
      const v = parseOrThrow({
        items,
        payType: (['cash', 'credit', 'mixed'] as const).includes(draft.pay_status as SalePayType)
          ? (opts?.payType ?? (draft.pay_status as SalePayType))
          : 'cash',
        cashPart: opts?.cashPart,
        customerId: opts?.customerId !== undefined ? opts.customerId : draft.customer_id,
        cashboxId: opts?.cashboxId !== undefined ? opts.cashboxId : draft.cashbox_id,
        warehouseId: Number(draft.warehouse_id),
        currencyId: Number(draft.currency_id),
        invoiceDiscount: money(draft.discount_amount ?? 0),
        notesInternal: draft.notes_internal ?? undefined,
        notesPrinted: draft.notes_printed ?? undefined,
        issuedAt: todayISO(),
        managerConfirmedBackdate: opts?.managerConfirmedBackdate,
        creditLimitConfirmed: opts?.creditLimitConfirmed,
      });

      // فحص الرصيد وقت التحويل + كل قواعد الحفظ (قرار 2)
      const ctx = await buildSaleCtx(db, v, { fromDraft: true });
      const { docNo } = await nextDocNumber('INV', { date: ctx.issuedAt });
      const vals = invoiceValues(ctx, v, docNo, 'completed');

      await db.run(
        'UPDATE invoice SET invoice_no = ?, pay_status = ?, status = ?, issued_at = ?, converted_at = ?, ' +
          'customer_id = ?, cashbox_id = ?, exchange_rate = ?, rate_is_fallback = ?, subtotal = ?, discount_amount = ?, ' +
          'tax_rate = ?, tax_amount = ?, total = ?, total_base = ?, paid_amount = ?, due_amount = ?, cost_total = ?, ' +
          'notes_internal = ?, notes_printed = ?, updated_at = ? WHERE id = ?',
        [
          docNo,
          v.payType,
          'completed',
          ctx.issuedAt,
          ctx.now,
          ctx.customerId,
          ctx.cashboxId,
          ctx.rate,
          ctx.rateIsFallback ? 1 : 0,
          vals.subtotal,
          vals.discountAmount,
          vals.taxRate,
          vals.taxAmount,
          vals.total,
          vals.totalBase,
          vals.paidAmount,
          vals.dueAmount,
          vals.costTotal,
          v.notesInternal?.trim() || null,
          v.notesPrinted?.trim() || null,
          ctx.now,
          draftId,
        ],
      );

      // تحديث بنود المسودة بالتكلفة الجارية (WAC وقت الإصدار) والإجماليات المعاد حسابها
      for (let i = 0; i < itemRows.length; i++) {
        const line = ctx.totals.lines[i]!;
        const rowId = Number(itemRows[i]!.id);
        await db.run(
          'UPDATE invoice_item SET line_cost = ?, line_total = ?, discount_amount = ? WHERE id = ?',
          [money(dec(line.lineCost)), money(dec(line.lineTotal)), money(dec(line.lineDiscount)), rowId],
        );
      }

      await applyStockOut(db, ctx, draftId, items);
      await applyCashIn(db, ctx, draftId);

      return {
        invoiceId: draftId,
        invoiceNo: docNo,
        payStatus: v.payType,
        total: vals.total,
        dueAmount: vals.dueAmount,
      };
    });
  });
}

// ============ الإلغاء (voidInvoice — FR-02-15) ============

export async function voidInvoice(invoiceId: number, opts: { managerConfirmed: boolean; reason?: string }): Promise<void> {
  if (opts.managerConfirmed !== true) {
    throw new Error('إلغاء الفاتورة يتطلب صلاحية المدير — أكّد الإلغاء من نافذة التأكيد أولاً');
  }
  return runSerialized(() => voidInvoiceCore(invoiceId, opts));
}

async function voidInvoiceCore(invoiceId: number, opts: { managerConfirmed: boolean; reason?: string }): Promise<void> {
  const db = await getDb();
  await db.transaction(async () => {
    const rows = await db.all<{
      id: number; invoice_no: string | null; doc_type: string; status: string; customer_id: number | null;
    }>('SELECT id, invoice_no, doc_type, status, customer_id FROM invoice WHERE id = ?', [invoiceId]);
    const inv = rows[0];
    if (inv === undefined) {
      throw new Error(`فاتورة غير موجودة (رقم ${invoiceId}) — لا يمكن إلغاؤها`);
    }
    if (inv.status === 'void') {
      throw new Error('هذه الفاتورة ملغاة مسبقاً — لا يمكن إلغاؤها مرتين');
    }

    const now = new Date().toISOString();

    // المسودة: تُلغى بلا أثر أصلاً (تحويل الحالة فقط — قرار 2)
    if (inv.status === 'draft') {
      await db.run('UPDATE invoice SET status = ?, updated_at = ? WHERE id = ?', ['void', now, invoiceId]);
      await logAudit('void_invoice', {
        entity: 'invoice',
        entityId: invoiceId,
        details: { invoiceNo: inv.invoice_no, reason: opts.reason ?? null, wasDraft: true },
      });
      return;
    }

    // مرتجعات بيع مكتملة مرتبطة → رفض (ألغِ المرتجعات أولاً)
    if (inv.doc_type === 'sale') {
      const returns = await db.all<{ c: number }>(
        "SELECT count(*) AS c FROM invoice WHERE original_invoice_id = ? AND doc_type = 'sale_return' AND status = 'completed'",
        [invoiceId],
      );
      if (Number(returns[0]?.c ?? 0) > 0) {
        throw new Error(
          'لا يمكن إلغاء فاتورة عليها مرتجعات مكتملة — ألغِ المرتجعات المرتبطة بها أولاً ثم أعد محاولة إلغاء الفاتورة',
        );
      }
    }

    // 1) مخزون معاكس: لكل حركة sale سالبة مرتبطة بالفاتورة حركة موجبة بنفس unit_cost وref
    const moves = await db.all<{ id: number; product_id: number; warehouse_id: number; qty: string | number; unit_cost: string | number }>(
      "SELECT id, product_id, warehouse_id, qty, unit_cost FROM stock_movement WHERE ref_type = 'invoice' AND ref_id = ? AND movement_type = 'sale'",
      [invoiceId],
    );
    for (const m of moves) {
      const back = dec(m.qty).neg(); // موجبة
      await db.run(
        'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
          "VALUES(?, ?, 'sale', ?, ?, 'invoice', ?, ?, ?, ?, ?)",
        [
          Number(m.product_id),
          Number(m.warehouse_id),
          money(back),
          money(m.unit_cost),
          invoiceId,
          now,
          `حركة معاكسة لإلغاء الفاتورة ${inv.invoice_no ?? invoiceId}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      const res = await db.run(
        'UPDATE stock_level SET qty = qty + ? WHERE product_id = ? AND warehouse_id = ?',
        [money(back), Number(m.product_id), Number(m.warehouse_id)],
      );
      if (res.changes === 0) {
        // صف رصيد جديد (حركة موجبة — CHECK يسمح)
        await db.run(
          'INSERT INTO stock_level(product_id, warehouse_id, qty) VALUES(?, ?, ?)',
          [Number(m.product_id), Number(m.warehouse_id), money(back)],
        );
      }
    }

    // 2) نقدية معاكسة: الأصلية is_voided=1 + حركة معاكسة receipt↔payment بنفس المبلغ والعملة والمرجع
    const txs = await db.all<{
      id: number; tx_type: string; cashbox_id: number; currency_id: number; amount: string | number;
      exchange_rate: string | number; tx_date: string; customer_id: number | null; supplier_id: number | null;
    }>("SELECT * FROM cash_tx WHERE ref_type = 'invoice' AND ref_id = ? AND is_voided = 0", [invoiceId]);
    for (const t of txs) {
      await db.run('UPDATE cash_tx SET is_voided = 1 WHERE id = ?', [Number(t.id)]);
      const oppositeType = t.tx_type === 'receipt' ? 'payment' : 'receipt';
      await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
          'customer_id, supplier_id, is_voided, reversal_of, description, created_at, created_by) ' +
          'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
        [
          oppositeType,
          Number(t.cashbox_id),
          Number(t.currency_id),
          money(t.amount),
          money(t.exchange_rate),
          todayISO(),
          'invoice',
          invoiceId,
          t.customer_id,
          t.supplier_id,
          Number(t.id),
          `عكس حركة إلغاء الفاتورة ${inv.invoice_no ?? invoiceId}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
    }

    // 3) الحالة (يبقى الرقم ولا يُعاد أبداً — قرار 6)
    await db.run('UPDATE invoice SET status = ?, updated_at = ? WHERE id = ?', ['void', now, invoiceId]);
    await logAudit('void_invoice', {
      entity: 'invoice',
      entityId: invoiceId,
      details: { invoiceNo: inv.invoice_no, reason: opts.reason ?? null },
    });
  });
}

// ============ الاستعلام (getSaleInvoice / listInvoices) ============

export interface InvoiceRow {
  id: number;
  invoiceNo: string | null;
  docType: string;
  payStatus: string;
  status: string;
  issuedAt: string;
  convertedAt: string | null;
  originalInvoiceId: number | null;
  customerId: number | null;
  supplierId: number | null;
  cashboxId: number | null;
  warehouseId: number;
  currencyId: number;
  exchangeRate: string;
  rateIsFallback: boolean;
  subtotal: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  totalBase: string;
  paidAmount: string;
  dueAmount: string;
  costTotal: string;
  notesInternal: string | null;
  notesPrinted: string | null;
  createdAt: string | null;
}

export interface InvoiceItemRow {
  id: number;
  productId: number | null;
  productName: string | null;
  lineDesc: string | null;
  qty: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxPercent: string;
  lineTotal: string;
  lineCost: string;
}

export interface InvoiceAllocationRow {
  cashTxId: number;
  amount: string;
  txType: string;
  txDate: string;
  isVoided: boolean;
}

export interface InvoiceFull {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  customerName: string | null;
  supplierName: string | null;
  cashboxName: string | null;
  warehouseName: string | null;
  currencyCode: string;
  currencyName: string;
  currencyDecimals: number;
  allocations: InvoiceAllocationRow[];
}

/** فاتورة كاملة (بنود + أطراف + تخصيصات) — تستخدمها شاشة التفاصيل (الموجة 4-b). */
export async function getSaleInvoice(id: number): Promise<InvoiceFull | null> {
  const db = await getDb();
  const rows = await db.all<{
    id: number; invoice_no: string | null; doc_type: string; pay_status: string; status: string;
    issued_at: string; converted_at: string | null; original_invoice_id: number | null;
    customer_id: number | null; supplier_id: number | null; cashbox_id: number | null;
    warehouse_id: number; currency_id: number; exchange_rate: string | number; rate_is_fallback: number;
    subtotal: string | number; discount_amount: string | number; tax_rate: string | number; tax_amount: string | number;
    total: string | number; total_base: string | number; paid_amount: string | number; due_amount: string | number;
    cost_total: string | number; notes_internal: string | null; notes_printed: string | null;
    created_at: string | null;
  }>('SELECT * FROM invoice WHERE id = ?', [id]);
  const r = rows[0];
  if (r === undefined) return null;

  const items = await db.all<{
    id: number; product_id: number | null; product_name: string | null; line_desc: string | null;
    qty: string | number; unit_price: string | number; discount_percent: string | number | null;
    discount_amount: string | number | null; tax_percent: string | number | null;
    line_total: string | number; line_cost: string | number;
  }>(
    'SELECT ii.*, p.name AS product_name FROM invoice_item ii LEFT JOIN product p ON p.id = ii.product_id ' +
      'WHERE ii.invoice_id = ? ORDER BY ii.id ASC',
    [id],
  );

  const party = await db.all<{ customer_name: string | null; supplier_name: string | null; cashbox_name: string | null; warehouse_name: string | null; currency_code: string; currency_name: string; currency_decimals: number }>(
    `SELECT cu.name AS customer_name, su.name AS supplier_name, cb.name AS cashbox_name, w.name AS warehouse_name,
            c.code AS currency_code, c.name AS currency_name, c.decimals AS currency_decimals
     FROM invoice i
     LEFT JOIN customer cu ON cu.id = i.customer_id
     LEFT JOIN supplier su ON su.id = i.supplier_id
     LEFT JOIN cashbox cb ON cb.id = i.cashbox_id
     LEFT JOIN warehouse w ON w.id = i.warehouse_id
     LEFT JOIN currency c ON c.id = i.currency_id
     WHERE i.id = ?`,
    [id],
  );

  const allocations = await db.all<{ cash_tx_id: number; allocated_amount: string | number; tx_type: string; tx_date: string; is_voided: number }>(
    `SELECT pa.cash_tx_id, pa.allocated_amount, t.tx_type, t.tx_date, t.is_voided
     FROM payment_allocation pa JOIN cash_tx t ON t.id = pa.cash_tx_id
     WHERE pa.invoice_id = ? ORDER BY pa.allocated_at ASC, pa.cash_tx_id ASC`,
    [id],
  );

  const p = party[0];
  return {
    invoice: {
      id: Number(r.id),
      invoiceNo: r.invoice_no,
      docType: r.doc_type,
      payStatus: r.pay_status,
      status: r.status,
      issuedAt: r.issued_at,
      convertedAt: r.converted_at,
      originalInvoiceId: r.original_invoice_id === null ? null : Number(r.original_invoice_id),
      customerId: r.customer_id === null ? null : Number(r.customer_id),
      supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
      cashboxId: r.cashbox_id === null ? null : Number(r.cashbox_id),
      warehouseId: Number(r.warehouse_id),
      currencyId: Number(r.currency_id),
      exchangeRate: money(r.exchange_rate),
      rateIsFallback: Number(r.rate_is_fallback) === 1,
      subtotal: money(r.subtotal),
      discountAmount: money(r.discount_amount),
      taxRate: money(r.tax_rate),
      taxAmount: money(r.tax_amount),
      total: money(r.total),
      totalBase: money(r.total_base),
      paidAmount: money(r.paid_amount),
      dueAmount: money(r.due_amount),
      costTotal: money(r.cost_total),
      notesInternal: r.notes_internal,
      notesPrinted: r.notes_printed,
      createdAt: r.created_at,
    },
    items: items.map((it) => ({
      id: Number(it.id),
      productId: it.product_id === null ? null : Number(it.product_id),
      productName: it.product_name,
      lineDesc: it.line_desc,
      qty: money(it.qty),
      unitPrice: money(it.unit_price),
      discountPercent: money(it.discount_percent ?? 0),
      discountAmount: money(it.discount_amount ?? 0),
      taxPercent: money(it.tax_percent ?? 0),
      lineTotal: money(it.line_total),
      lineCost: money(it.line_cost),
    })),
    customerName: p?.customer_name ?? null,
    supplierName: p?.supplier_name ?? null,
    cashboxName: p?.cashbox_name ?? null,
    warehouseName: p?.warehouse_name ?? null,
    currencyCode: p?.currency_code ?? '',
    currencyName: p?.currency_name ?? '',
    currencyDecimals: Number(p?.currency_decimals ?? 2),
    allocations: allocations.map((a) => ({
      cashTxId: Number(a.cash_tx_id),
      amount: money(a.allocated_amount),
      txType: a.tx_type,
      txDate: a.tx_date,
      isVoided: Number(a.is_voided) === 1,
    })),
  };
}

export interface ListInvoicesOpts {
  docType?: 'sale' | 'purchase' | 'sale_return' | 'purchase_return';
  status?: 'draft' | 'completed' | 'void';
  customerId?: number;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
  /** بحث برقم الفاتورة أو اسم الطرف. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface InvoiceListRow {
  id: number;
  invoiceNo: string | null;
  docType: string;
  status: string;
  payStatus: string;
  issuedAt: string;
  customerId: number | null;
  customerName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  currencyId: number;
  currencyCode: string;
  total: string;
  dueAmount: string;
}

/** قائمة الفواتير بفلاتر — تستخدمها شاشات البيع والشراء (4-a/4-b). */
export async function listInvoices(opts: ListInvoicesOpts): Promise<InvoiceListRow[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
  const offset = Math.max(0, opts.offset ?? 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.docType !== undefined) {
    where.push('i.doc_type = ?');
    params.push(opts.docType);
  }
  if (opts.status !== undefined) {
    where.push('i.status = ?');
    params.push(opts.status);
  }
  if (opts.customerId !== undefined) {
    where.push('i.customer_id = ?');
    params.push(opts.customerId);
  }
  if (opts.supplierId !== undefined) {
    where.push('i.supplier_id = ?');
    params.push(opts.supplierId);
  }
  if (opts.dateFrom !== undefined) {
    where.push('i.issued_at >= ?');
    params.push(opts.dateFrom);
  }
  if (opts.dateTo !== undefined) {
    where.push('i.issued_at <= ?');
    params.push(opts.dateTo);
  }
  const q = (opts.q ?? '').trim();
  if (q.length > 0) {
    const esc = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(i.invoice_no LIKE ? ESCAPE '\\' OR IFNULL(cu.name, '') LIKE ? ESCAPE '\\' OR IFNULL(su.name, '') LIKE ? ESCAPE '\\')");
    params.push(esc, esc, esc);
  }

  const rows = await db.all<{
    id: number; invoice_no: string | null; doc_type: string; status: string; pay_status: string; issued_at: string;
    customer_id: number | null; customer_name: string | null; supplier_id: number | null; supplier_name: string | null;
    currency_id: number; currency_code: string; total: string | number; due_amount: string | number;
  }>(
    `SELECT i.id, i.invoice_no, i.doc_type, i.status, i.pay_status, i.issued_at,
            i.customer_id, cu.name AS customer_name, i.supplier_id, su.name AS supplier_name,
            i.currency_id, c.code AS currency_code, i.total, i.due_amount
     FROM invoice i
     LEFT JOIN customer cu ON cu.id = i.customer_id
     LEFT JOIN supplier su ON su.id = i.supplier_id
     LEFT JOIN currency c ON c.id = i.currency_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.issued_at DESC, i.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map((r) => ({
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    docType: r.doc_type,
    status: r.status,
    payStatus: r.pay_status,
    issuedAt: r.issued_at,
    customerId: r.customer_id === null ? null : Number(r.customer_id),
    customerName: r.customer_name,
    supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
    supplierName: r.supplier_name,
    currencyId: Number(r.currency_id),
    currencyCode: r.currency_code ?? '',
    total: money(r.total),
    dueAmount: money(r.due_amount),
  }));
}

// ============ مساعدات شاشة البيع (البحث/الأكثر مبيعاً/الافتراضات) ============

/** صنف بأسعار شاشة البيع — سعر retail بعملة الفاتورة المختارة + الرصيد الكلي. */
export interface SaleProductRow {
  id: number;
  name: string;
  barcode: string | null;
  isService: boolean;
  totalQty: string;
  /** سعر البيع بالعملة المطلوبة أو null إن لم يُسجَّل لها سعر. */
  price: string | null;
}

const SALE_PRODUCT_SELECT = `
  SELECT p.id AS id, p.name AS name, p.barcode AS barcode, p.is_service AS is_service,
         COALESCE((SELECT SUM(sl.qty) FROM stock_level sl WHERE sl.product_id = p.id), 0) AS total_qty,
         (SELECT pp.price FROM product_price pp
           WHERE pp.product_id = p.id AND pp.price_level = 'retail' AND pp.currency_id = ?) AS price
  FROM product p`;

interface SaleProductSqlRow {
  id: number;
  name: string;
  barcode: string | null;
  is_service: number;
  total_qty: string | number | null;
  price: string | number | null;
}

function toSaleProduct(r: SaleProductSqlRow): SaleProductRow {
  return {
    id: Number(r.id),
    name: r.name,
    barcode: r.barcode,
    isService: Number(r.is_service) === 1,
    totalQty: money(r.total_qty ?? 0),
    price: r.price === null || r.price === undefined ? null : money(r.price),
  };
}

/** أشهر 20 صنفاً (الأكثر مبيعاً) — شبكة ItemPickerSheet الافتراضية (FR-02-02). */
export async function listBestSellers(currencyId: number, limit = 20): Promise<SaleProductRow[]> {
  const db = await getDb();
  const rows = await db.all<SaleProductSqlRow>(
    `${SALE_PRODUCT_SELECT}
     WHERE p.is_archived = 0
     ORDER BY COALESCE((SELECT SUM(-sm.qty) FROM stock_movement sm
                         WHERE sm.product_id = p.id AND sm.movement_type = 'sale'), 0) DESC,
              p.name COLLATE NOCASE ASC
     LIMIT ?`,
    [currencyId, Math.max(1, Math.min(limit, 100))],
  );
  return rows.map(toSaleProduct);
}

/** بحث أصناف البيع بالاسم أو الباركود مع سعر العملة المختارة. */
export async function searchSaleProducts(query: string, currencyId: number, limit = 50): Promise<SaleProductRow[]> {
  const db = await getDb();
  const q = (query ?? '').trim();
  if (q === '') return listBestSellers(currencyId, limit);
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db.all<SaleProductSqlRow>(
    `${SALE_PRODUCT_SELECT}
     WHERE p.is_archived = 0 AND (p.name LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESC '\\')
     ORDER BY p.name COLLATE NOCASE ASC
     LIMIT ?`,
    [currencyId, `%${esc}%`, `${esc}%`, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map(toSaleProduct);
}

/** مسح باركود في سياق البيع — مطابقة تامة + سعر العملة. */
export async function findSaleProductByBarcode(barcode: string, currencyId: number): Promise<SaleProductRow | null> {
  const db = await getDb();
  const code = (barcode ?? '').trim();
  if (code === '') return null;
  const rows = await db.all<SaleProductSqlRow>(
    `${SALE_PRODUCT_SELECT} WHERE p.is_archived = 0 AND p.barcode = ? LIMIT 1`,
    [currencyId, code],
  );
  return rows.length === 0 ? null : toSaleProduct(rows[0]!);
}

/** الرصيد المتاح لصنف في مستودع (لعرض «المتاح: N» لحظياً). */
export async function getStockInWarehouse(productId: number, warehouseId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ qty: string | number }>(
    'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId],
  );
  return money(rows[0]?.qty ?? 0);
}

export interface CashboxLite {
  id: number;
  name: string;
  currencyId: number;
  isDefault: boolean;
}

/** الصناديق الفاعلة — لاختيار الصندوق في شريط الأعلى. */
export async function listCashboxes(): Promise<CashboxLite[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string; currency_id: number; is_default: number }>(
    'SELECT id, name, currency_id, is_default FROM cashbox WHERE is_archived = 0 ORDER BY is_default DESC, name ASC',
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    currencyId: Number(r.currency_id),
    isDefault: Number(r.is_default) === 1,
  }));
}

export interface SaleDefaults {
  cashboxId: number | null;
  cashboxName: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  baseCurrencyId: number | null;
  taxMode: 'per_item' | 'on_total';
  taxRate: string;
  paymentSheetOn: boolean;
  printOnSave: 'print' | 'no' | 'ask';
  overAvailPolicy: 'warn' | 'add_available';
}

/** افتراضيات شاشة البيع: الصندوق/المستودع الافتراضيان + إعدادات الضريبة والدفع (تُستدعى عند الفتح). */
export async function getSaleDefaults(): Promise<SaleDefaults> {
  const db = await getDb();
  // الصندوق: افتراضي المستخدم أولاً ثم الافتراضي العام ثم أول صندوق
  const userBox = await db.all<{ default_cashbox_id: number | null }>(
    'SELECT default_cashbox_id FROM app_user ORDER BY id ASC LIMIT 1',
  );
  const boxes = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM cashbox WHERE is_archived = 0 ORDER BY is_default DESC, id ASC',
  );
  const wantedBox = userBox[0]?.default_cashbox_id ?? null;
  const box = boxes.find((b) => Number(b.id) === Number(wantedBox)) ?? boxes[0] ?? null;

  const warehouses = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM warehouse WHERE is_archived = 0 ORDER BY is_default DESC, id ASC',
  );
  const warehouse = warehouses[0] ?? null;

  let baseCurrencyId: number | null = null;
  try {
    baseCurrencyId = (await getBaseCurrency()).id;
  } catch {
    baseCurrencyId = null;
  }

  const taxModeRaw = await getSetting('invoicing.tax_mode');
  const companyRows = await db.all<{ tax_rate: string | number | null }>('SELECT tax_rate FROM company LIMIT 1');

  return {
    cashboxId: box === null ? null : Number(box.id),
    cashboxName: box?.name ?? null,
    warehouseId: warehouse === null ? null : Number(warehouse.id),
    warehouseName: warehouse?.name ?? null,
    baseCurrencyId,
    taxMode: taxModeRaw === 'per_item' ? 'per_item' : 'on_total',
    taxRate: money(companyRows[0]?.tax_rate ?? 0),
    paymentSheetOn: (await getSetting('invoicing.payment_sheet')) === 'on',
    printOnSave: (await getSetting('invoicing.print_on_save')) as 'print' | 'no' | 'ask',
    overAvailPolicy: (await getSetting('sale.over_avail_policy')) as 'warn' | 'add_available',
  };
}
