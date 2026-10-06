import { z } from 'zod';
import { getDb } from '@/db/client';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { distributeProRata } from './invoice-math';
import { nextDocNumber } from './docseq';
import { getSetting } from './settings';
import { assertPeriodOpen, assertBackdateAllowed } from './fiscal';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * المرتجعات المرتبطة (FR-02-07 بيع + FR-02-08 شراء + ReturnFlow §6.5) — Task 4-b:
 *
 * فحوصات قبل أي كتابة (برسائل عربية محددة — AC-21):
 *  - الأصل status='completed' فقط (مسودة/ملغاة → رفض صريح).
 *  - Σ مرتجعات الصنف (الموجودة + الجديدة) ≤ الكمية الأصلية، والرسالة تسمّي الصنف
 *    والمتبقي القابل للإرجاع.
 *
 * **قرار ربط موثق**: المخطط المجمّد v1.2 لا يملك original_item_id في invoice_item،
 * لذا يُحسب «المتبقي القابل للإرجاع» على مستوى الصنف داخل الفاتورة الواحدة (تجميع
 * كل بنود نفس الصنف في الأصل وكل بنوده في مرتجعاتها المرتبطة). البنود الحرة
 * (بلا صنف productId=null) تُعامل كمجموعة واحدة. أسعار البند تُنسخ من بند الأصل
 * الذي اختاره المستخدم فيُحافظ على سعر الإرجاع.
 *
 * مرتجع البيع (sale_return):
 *  - الكمية تعود للمخزون **بتكلفة line_cost الأصلية** (حركة موجبة unit_cost=الأصلية
 *    لكل وحدة — لا WAC الجاري، ولا يُحدَّث product.cost_price إطلاقاً — SRS 5.4-3
 *    يوجب إعادة حساب WAC لمرتجع الشراء فقط).
 *  - إرجاع المبلغ: cash → cash_tx 'payment' (خروج من الصندوق، ref_type='sale_return')؛
 *    account → due على فاتورة المرتجع (SRN) فينقص دين العميل بمعادلة parties تلقائياً.
 *  - أصناف الخدمة تُرجع بلا حركة مخزون.
 *  - المبلغ يُحتسب نسبياً من الأصل: حصة البند من خصم الفاتورة الأصلي تُخصم pro-rata
 *    (distributeProRata على شبات الأصل) والضريبة بنسبة الأصل — فالمرتجع يعيد ما دُفع
 *    فعلاً عن الكمية المرتجعة لا أكثر.
 *  - الرقم SRN-YYYY-NNNNN.
 *
 * مرتجع الشراء (purchase_return):
 *  - الكمية تخرج **بسعر حركة الشراء الأصلية (Snapshot)** من stock_movement الأصل
 *    (حركة سالبة بنفس unit_cost) + إعادة حساب WAC على المتبقي:
 *        new_cost = (qty_total×wac_current − qty_return×snapshot)/(qty_total − qty_return)
 *    (موثقة Decimal بتقريب 4 منازل؛ إن كان المتبقي صفراً تُبقى التكلفة الحالية —
 *    لا أساس كمي، وتُستبدل عند أول شراء قادم).
 *  - المبلغ: cash → receipt للصندوق؛ account → due على فاتورة المرتجع (PRN) فينقص
 *    رصيد المورد بمعادلة parties.
 *  - الرقم PRN-YYYY-NNNNN.
 *
 * كلاهما داخل transaction واحدة + logAudit + فحص الفترة/التأريخ (قاعدة 5.4-11).
 * **قرار عملة موثق**: فاتورة المرتجع ترث عملة الأصل ولقطة سعر صرفه (عكس مالي مباشر
 * له — لا لقطة جديدة قد تختلف وتكسر التسوية، FR-02-09 Snapshot).
 */

// ============ الأنواع والعقود ============

export interface SaleReturnLineInput {
  /** بند الفاتورة الأصلية */
  itemId: number;
  qty: string;
}

export interface CreateSaleReturnInput {
  originalInvoiceId: number;
  lines: SaleReturnLineInput[];
  direction: 'cash' | 'account';
  cashboxId?: number | null;
  reason?: string;
  issuedAt?: string;
}

export interface PurchaseReturnLineInput {
  itemId: number;
  qty: string;
}

export interface CreatePurchaseReturnInput {
  originalInvoiceId: number;
  lines: PurchaseReturnLineInput[];
  direction: 'cash' | 'account';
  cashboxId?: number | null;
  reason?: string;
  issuedAt?: string;
}

export interface CreateReturnResult {
  invoiceId: number;
  invoiceNo: string;
  total: string;
}

/** بند قابل للإرجاع كما تعرضه ReturnFlow §6.5. */
export interface ReturnableLineRow {
  itemId: number;
  productId: number | null;
  /** اسم الصنف أو وصف السطر الحر */
  name: string;
  isService: boolean;
  qtySold: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  /** صافي البند في الأصل (قبل خصم الفاتورة وقبل الضريبة) */
  lineTotal: string;
  /** التكلفة الأصلية للسطر (Snapshot — أساس عودة الكمية) */
  lineCost: string;
  /** التكلفة لكل وحدة (line_cost/qty) */
  unitCost: string;
  /** المرتجع سابقاً (على مستوى مجموعة الصنف) */
  qtyReturned: string;
  /** المتبقي القابل للإرجاع */
  returnable: string;
}

/** سياق الفاتورة الأصلية لشاشة المرتجع. */
export interface ReturnContextRow {
  id: number;
  invoiceNo: string | null;
  docType: 'sale' | 'purchase';
  status: string;
  payStatus: string;
  issuedAt: string;
  partyId: number | null;
  partyName: string | null;
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
  total: string;
  dueAmount: string;
  cashboxId: number | null;
  warehouseId: number;
}

/** صف قائمة «مرتجعات مرتبطة». */
export interface LinkedReturnRow {
  id: number;
  invoiceNo: string | null;
  issuedAt: string;
  total: string;
  status: string;
  payStatus: string;
}

// ============ مخططات zod ============

const POS_DEC = /^\d+(\.\d+)?$/;

const SaleReturnLinesSchema = z
  .array(
    z.object({
      itemId: z.number().int().positive('رقم بند غير صالح'),
      qty: z.string().regex(POS_DEC, 'كمية المرتجع يجب أن تكون رقماً أكبر من صفر'),
    }),
  )
  .min(1, 'اختر بنداً واحداً على الأقل بكمية أكبر من صفر');

const DirectionSchema = z.enum(['cash', 'account']);

const CreateSaleReturnSchema = z.object({
  originalInvoiceId: z.number().int().positive('رقم فاتورة غير صالح'),
  lines: SaleReturnLinesSchema,
  direction: DirectionSchema,
  cashboxId: z.number().int().positive('رقم صندوق غير صالح').nullable().optional(),
  reason: z.string().trim().max(300, 'سبب المرتجع طويل (300 حرف كحد أقصى)').optional(),
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ المرتجع يجب أن يكون بصيغة YYYY-MM-DD')
    .optional(),
});

const CreatePurchaseReturnSchema = CreateSaleReturnSchema;

// ============ أدوات داخلية ============

interface OriginalItemRow {
  id: number;
  product_id: number | null;
  product_name: string | null;
  is_service: number | null;
  line_desc: string | null;
  qty: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_percent: string | number;
  line_total: string | number;
  line_cost: string | number;
}

interface OriginalInvoiceRow {
  id: number;
  invoice_no: string | null;
  status: string;
  pay_status: string;
  issued_at: string;
  party_id: number | null;
  party_name: string | null;
  cashbox_id: number | null;
  warehouse_id: number;
  currency_id: number;
  currency_code: string;
  currency_decimals: number;
  exchange_rate: string | number;
  rate_is_fallback: number;
  discount_amount: string | number;
  tax_rate: string | number;
  subtotal: string | number;
  total: string | number;
}

async function loadOriginal(
  db: Awaited<ReturnType<typeof getDb>>,
  originalInvoiceId: number,
  docType: 'sale' | 'purchase',
): Promise<OriginalInvoiceRow> {
  const rows = await db.all<OriginalInvoiceRow & { doc_type: string }>(
    'SELECT i.id, i.invoice_no, i.doc_type, i.status, i.pay_status, i.issued_at, ' +
      'CASE WHEN i.doc_type = \'sale\' THEN i.customer_id ELSE i.supplier_id END AS party_id, ' +
      'CASE WHEN i.doc_type = \'sale\' THEN cu.name ELSE su.name END AS party_name, ' +
      'i.cashbox_id, i.warehouse_id, i.currency_id, c.code AS currency_code, c.decimals AS currency_decimals, ' +
      'i.exchange_rate, i.rate_is_fallback, i.discount_amount, i.tax_rate, i.subtotal, i.total ' +
      'FROM invoice i ' +
      'LEFT JOIN customer cu ON cu.id = i.customer_id ' +
      'LEFT JOIN supplier su ON su.id = i.supplier_id ' +
      'LEFT JOIN currency c ON c.id = i.currency_id ' +
      'WHERE i.id = ?',
    [originalInvoiceId],
  );
  if (rows.length === 0) {
    throw new Error(`الفاتورة الأصلية (رقم ${originalInvoiceId}) غير موجودة`);
  }
  const inv = rows[0]!;
  const expected = docType === 'sale' ? 'sale' : 'purchase';
  if (inv.doc_type !== expected) {
    throw new Error(
      docType === 'sale'
        ? 'هذا المستند ليس فاتورة بيع — مرتجع البيع يُنشأ من فاتورة بيع فقط'
        : 'هذا المستند ليس فاتورة شراء — مرتجع الشراء يُنشأ من فاتورة شراء فقط',
    );
  }
  if (inv.status === 'void') {
    throw new Error('لا يمكن إنشاء مرتجع على فاتورة ملغاة — الفاتورة الأصلية باطلة ولا يصح الارجاع عنها');
  }
  if (inv.status === 'draft') {
    throw new Error('لا يمكن إنشاء مرتجع على فاتورة مسودة — حوّل الفاتورة إلى مكتملة أولاً ثم أنشئ المرتجع');
  }
  if (inv.status !== 'completed') {
    throw new Error(`لا يمكن إنشاء مرتجع على فاتورة بحالة «${inv.status}» — الحالات المسموحة: مكتملة فقط`);
  }
  return inv;
}

async function loadOriginalItems(
  db: Awaited<ReturnType<typeof getDb>>,
  originalInvoiceId: number,
): Promise<OriginalItemRow[]> {
  return db.all<OriginalItemRow>(
    'SELECT ii.id, ii.product_id, p.name AS product_name, p.is_service, ii.line_desc, ii.qty, ii.unit_price, ' +
      'ii.discount_percent, ii.tax_percent, ii.line_total, ii.line_cost ' +
      'FROM invoice_item ii LEFT JOIN product p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id ASC',
    [originalInvoiceId],
  );
}

/** مفتاح تجميع البند لمجموعة الإرجاع (قرار الربط الموثق أعلاه). */
function poolKeyOf(item: OriginalItemRow): string {
  return item.product_id === null ? 'free' : `p:${item.product_id}`;
}

/** المرتجع سابقاً لكل مجموعة (صنف) من مرتجعات مكتملة مرتبطة بالأصل. */
async function priorReturnedByPool(
  db: Awaited<ReturnType<typeof getDb>>,
  originalInvoiceId: number,
  returnDocType: 'sale_return' | 'purchase_return',
): Promise<Map<string, Decimal>> {
  const rows = await db.all<{ product_id: number | null; q: string | number }>(
    'SELECT ri.product_id, SUM(ri.qty) AS q FROM invoice_item ri ' +
      'JOIN invoice r ON r.id = ri.invoice_id ' +
      'WHERE r.original_invoice_id = ? AND r.doc_type = ? AND r.status = \'completed\' ' +
      'GROUP BY ri.product_id',
    [originalInvoiceId, returnDocType],
  );
  const out = new Map<string, Decimal>();
  for (const r of rows) {
    out.set(r.product_id === null ? 'free' : `p:${r.product_id}`, dec(r.q));
  }
  return out;
}

/**
 * تحقق الكميات والتقاط البنود الأصلية المطلوبة — قبل أي كتابة.
 * يعيد خريطة itemId → OriginalItemRow ورسائلها تسمّي الصنف والمتبقي.
 */
async function validateReturnLines(
  db: Awaited<ReturnType<typeof getDb>>,
  originalInvoiceId: number,
  docType: 'sale' | 'purchase',
  lines: { itemId: number; qty: string }[],
): Promise<{ items: OriginalItemRow[]; byPool: Map<string, Decimal>; originalByPool: Map<string, Decimal> }> {
  const returnDocType = docType === 'sale' ? 'sale_return' : 'purchase_return';
  const all = await loadOriginalItems(db, originalInvoiceId);
  const byId = new Map(all.map((it) => [it.id, it]));

  // الكميات المطلوبة لكل بند (البند قد يتكرر في الطلب)
  const wantedPerItem = new Map<number, Decimal>();
  for (const ln of lines) {
    const item = byId.get(ln.itemId);
    if (item === undefined) {
      throw new Error(`البند (رقم ${ln.itemId}) لا ينتمي إلى هذه الفاتورة — أعد فتح شاشة المرتجع`);
    }
    const qty = dec(ln.qty);
    if (qty.lte(0)) {
      throw new Error(
        `كمية المرتجع للصنف «${item.product_name ?? item.line_desc ?? 'بند حر'}» يجب أن تكون أكبر من صفر`,
      );
    }
    wantedPerItem.set(ln.itemId, (wantedPerItem.get(ln.itemId) ?? dec(0)).plus(qty));
  }

  // المجموعات: الأصل مقابل (المرتجع سابقاً + الجديد)
  const originalByPool = new Map<string, Decimal>();
  for (const it of all) {
    const k = poolKeyOf(it);
    originalByPool.set(k, (originalByPool.get(k) ?? dec(0)).plus(dec(it.qty)));
  }
  const priorByPool = await priorReturnedByPool(db, originalInvoiceId, returnDocType);
  const newByPool = new Map<string, Decimal>();
  for (const [itemId, qty] of wantedPerItem) {
    const item = byId.get(itemId)!;
    const k = poolKeyOf(item);
    newByPool.set(k, (newByPool.get(k) ?? dec(0)).plus(qty));
  }

  const nameByPool = new Map<string, string>();
  for (const it of all) {
    const k = poolKeyOf(it);
    if (!nameByPool.has(k)) nameByPool.set(k, it.product_name ?? it.line_desc ?? 'بند حر');
  }

  for (const [k, newQty] of newByPool) {
    const origQty = originalByPool.get(k) ?? dec(0);
    const prior = priorByPool.get(k) ?? dec(0);
    const remaining = origQty.minus(prior);
    if (newQty.greaterThan(remaining)) {
      throw new Error(
        `الكمية المرتجعة للصنف «${nameByPool.get(k) ?? k}» (${money(newQty)}) تتجاوز المتبقي القابل للإرجاع (${money(remaining)}) — ` +
          'راجع الكمية أو راجع المرتجعات السابقة لهذه الفاتورة',
      );
    }
  }

  return { items: all, byPool: newByPool, originalByPool };
}

/** حصة البند من خصم رأس الفاتورة الأصلية (pro-rata على شبات الأصل). */
function originalAllocations(inv: OriginalInvoiceRow, items: OriginalItemRow[]): string[] {
  return distributeProRata(
    money(inv.discount_amount),
    items.map((it) => money(dec(it.qty).times(dec(it.unit_price)).times(dec(1).minus(dec(it.discount_percent).div(100))))),
  );
}

function nowISO(): string {
  return new Date().toISOString();
}

/** إدراج فاتورة المرتجع + بنودها (مشترك بين الاتجاهين) داخل المعاملة. */
async function insertReturnInvoice(
  db: Awaited<ReturnType<typeof getDb>>,
  opts: {
    docType: 'sale_return' | 'purchase_return';
    invoiceNo: string;
    issuedAt: string;
    original: OriginalInvoiceRow;
    payStatus: 'cash' | 'credit';
    cashboxId: number | null;
    total: string;
    subtotal: string;
    discountAmount: string;
    taxRate: string;
    taxAmount: string;
    costTotal: string;
    reason?: string;
    partyId: number | null;
    lines: {
      item: OriginalItemRow;
      qty: Decimal;
      lineTotal: string;
      lineCost: string;
    }[];
  },
): Promise<number> {
  const now = nowISO();
  const userId = getCurrentUserId() ?? null;
  const totalD = dec(opts.total);
  const paid = opts.payStatus === 'cash' ? totalD : dec(0);
  const totalBase = roundTo(totalD.times(dec(opts.original.exchange_rate)), 4);

  const res = await db.run(
    'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, original_invoice_id, ' +
      'customer_id, supplier_id, cashbox_id, warehouse_id, currency_id, exchange_rate, rate_is_fallback, ' +
      'subtotal, discount_amount, tax_rate, tax_amount, total, total_base, paid_amount, due_amount, cost_total, ' +
      'notes_printed, notes_internal, created_at, updated_at, created_by) ' +
      'VALUES(?, ?, ?, \'completed\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      opts.invoiceNo,
      opts.docType,
      opts.payStatus,
      opts.issuedAt,
      opts.original.id,
      opts.docType === 'sale_return' ? opts.partyId : null,
      opts.docType === 'purchase_return' ? opts.partyId : null,
      opts.cashboxId,
      opts.original.warehouse_id,
      opts.original.currency_id,
      money(opts.original.exchange_rate),
      Number(opts.original.rate_is_fallback) === 1 ? 1 : 0,
      opts.subtotal,
      opts.discountAmount,
      opts.taxRate,
      opts.taxAmount,
      opts.total,
      money(totalBase),
      money(roundTo(paid, 4)),
      money(roundTo(totalD.minus(paid), 4)),
      opts.costTotal,
      opts.reason ?? null,
      `مرتجع على الفاتورة ${opts.original.invoice_no ?? opts.original.id}`,
      now,
      now,
      userId,
    ],
  );
  const invoiceId = Number(res.lastInsertRowId);

  for (const ln of opts.lines) {
    const unitId = await productUnitIdOf(db, ln.item.product_id);
    await db.run(
      'INSERT INTO invoice_item(invoice_id, product_id, line_desc, qty, unit_id, unit_factor, unit_price, ' +
        'discount_percent, discount_amount, tax_percent, line_total, line_cost, notes, created_at) ' +
        'VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        invoiceId,
        ln.item.product_id,
        ln.item.line_desc,
        money(ln.qty),
        unitId,
        money(ln.item.unit_price),
        money(ln.item.discount_percent),
        // خصم البند للكمية المرتجعة (معلوماتياً — خصم الفاتورة الأصلي في رأس المرتجع)
        money(
          roundTo(
            dec(ln.qty)
              .times(dec(ln.item.unit_price))
              .times(dec(ln.item.discount_percent))
              .div(100),
            4,
          ),
        ),
        money(ln.item.tax_percent),
        ln.lineTotal,
        ln.lineCost,
        now,
      ],
    );
  }
  return invoiceId;
}

async function productUnitIdOf(
  db: Awaited<ReturnType<typeof getDb>>,
  productId: number | null,
): Promise<number | null> {
  if (productId === null) return null;
  const rows = await db.all<{ unit_id: number | null }>('SELECT unit_id FROM product WHERE id = ?', [productId]);
  return rows[0]?.unit_id ?? null;
}

/** تحديث رصيد مستودع (زيادة/إنقاص) داخل المعاملة. */
async function bumpStockLevel(
  db: Awaited<ReturnType<typeof getDb>>,
  productId: number,
  warehouseId: number,
  delta: Decimal,
): Promise<void> {
  const rows = await db.all<{ qty: string | number }>(
    'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId],
  );
  const next = (rows.length > 0 ? dec(rows[0]!.qty) : dec(0)).plus(delta);
  if (next.isNegative()) {
    throw new Error('خطأ داخلي: محاولة إنقاص المخزون تحت الصفر — راجع كمية البنود');
  }
  await db.run(
    'INSERT INTO stock_level(product_id, warehouse_id, qty) VALUES(?, ?, ?) ' +
      'ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty',
    [productId, warehouseId, money(next)],
  );
}

/** إجمالي كمية صنف عبر المخازن (أساس WAC). */
async function totalStockOf(db: Awaited<ReturnType<typeof getDb>>, productId: number): Promise<Decimal> {
  const rows = await db.all<{ q: string | number }>(
    'SELECT COALESCE(SUM(qty), 0) AS q FROM stock_level WHERE product_id = ?',
    [productId],
  );
  return dec(rows[0]?.q ?? 0);
}

// ============ مرتجع البيع (FR-02-07) ============

export async function createSaleReturn(input: CreateSaleReturnInput): Promise<CreateReturnResult> {
  const v = CreateSaleReturnSchema.parse({
    ...input,
    cashboxId: input.cashboxId ?? null,
    reason: input.reason?.trim() === '' ? undefined : input.reason?.trim(),
  });

  const issuedAt = v.issuedAt ?? todayISO();
  const db = await getDb();
  let result: CreateReturnResult = { invoiceId: 0, invoiceNo: '', total: '0' };

  await db.transaction(async () => {
    // الفحوصات قبل أي كتابة
    await assertPeriodOpen(issuedAt);
    await assertBackdateAllowed(issuedAt);
    const original = await loadOriginal(db, v.originalInvoiceId, 'sale');
    const { items } = await validateReturnLines(db, v.originalInvoiceId, 'sale', v.lines);
    const byId = new Map(items.map((it) => [it.id, it]));
    // حصة كل بند من خصم الفاتورة الأصلي (distributeProRata على شبات الأصل — بالفهرس)
    const allocs = originalAllocations(original, items);
    const allocById = new Map<number, string>();
    items.forEach((it, i) => allocById.set(it.id, allocs[i]!));

    const taxMode = (await getSetting('invoicing.tax_mode')) === 'per_item' ? 'per_item' : 'on_total';
    const taxRate = money(original.tax_rate);

    // حساب مبالغ المرتجع نسبياً من الأصل
    let subtotal = dec(0);
    let discountShare = dec(0);
    let taxAmount = dec(0);
    let costTotal = dec(0);
    const returnLines: { item: OriginalItemRow; qty: Decimal; lineTotal: string; lineCost: string }[] = [];

    for (const ln of v.lines) {
      const item = byId.get(ln.itemId)!;
      const qty = dec(ln.qty);
      const origQty = dec(item.qty);
      const unitPrice = dec(item.unit_price);
      const lineDiscount = roundTo(qty.times(unitPrice).times(dec(item.discount_percent)).div(100), 4);
      const lineNet = roundTo(qty.times(unitPrice).minus(lineDiscount), 4);
      // حصة خصم الفاتورة الأصلي لهذا البند (pro-rata على كمية الإرجاع)
      const allocOfLine = dec(allocById.get(item.id) ?? '0');
      const allocShare = origQty.greaterThan(0) ? allocOfLine.times(qty).div(origQty) : dec(0);
      const charged = roundTo(lineNet.minus(roundTo(allocShare, 4)), 4);
      // الضريبة بنمط الأصل: on_total على الصافي المُحمَّل، per_item على صافي البند
      const lineTax =
        taxMode === 'on_total'
          ? roundTo(charged.times(dec(taxRate)).div(100), 4)
          : roundTo(lineNet.times(dec(item.tax_percent)).div(100), 4);
      const lineTotal = roundTo(charged.plus(lineTax), 4);
      const unitCost = origQty.greaterThan(0) ? dec(item.line_cost).div(origQty) : dec(0);
      const lineCost = roundTo(unitCost.times(qty), 4);

      subtotal = subtotal.plus(lineNet);
      discountShare = discountShare.plus(roundTo(allocShare, 4));
      taxAmount = taxAmount.plus(lineTax);
      costTotal = costTotal.plus(lineCost);
      returnLines.push({ item, qty, lineTotal: money(lineTotal), lineCost: money(lineCost) });
    }

    const total = roundTo(subtotal.minus(roundTo(discountShare, 4)).plus(taxAmount), 4);
    if (total.lte(0)) {
      throw new Error('صافي المرتجع صفر أو سالب — لا يمكن الحفظ. راجع الكميات أو خصومات الفاتورة الأصلية');
    }

    // الصندوق لاتجاه النقدي
    let cashboxId: number | null = null;
    if (v.direction === 'cash') {
      cashboxId = v.cashboxId ?? original.cashbox_id ?? null;
      if (cashboxId === null) {
        throw new Error('مرتجع النقد يتطلب صندوقاً — اختر الصندوق الذي سيُرد منه المبلغ للعميل');
      }
      const box = await db.all<{ id: number; currency_id: number }>(
        'SELECT id, currency_id FROM cashbox WHERE id = ?',
        [cashboxId],
      );
      if (box.length === 0) {
        throw new Error(`الصندوق (رقم ${cashboxId}) غير موجود — أعد اختيار الصندوق`);
      }
      if (Number(box[0]!.currency_id) !== Number(original.currency_id)) {
        throw new Error('عملة الصندوق تختلف عن عملة الفاتورة الأصلية — اختر صندوقاً بعملة الفاتورة (قرار 8)');
      }
    }

    const { docNo } = await nextDocNumber('SRN', { date: issuedAt });

    const invoiceId = await insertReturnInvoice(db, {
      docType: 'sale_return',
      invoiceNo: docNo,
      issuedAt,
      original,
      payStatus: v.direction === 'cash' ? 'cash' : 'credit',
      cashboxId,
      total: money(total),
      subtotal: money(roundTo(subtotal, 4)),
      discountAmount: money(roundTo(discountShare, 4)),
      taxRate,
      taxAmount: money(roundTo(taxAmount, 4)),
      costTotal: money(roundTo(costTotal, 4)),
      reason: v.reason,
      partyId: original.party_id,
      lines: returnLines,
    });

    // المخزون: الكمية تعود بالتكلفة الأصلية (لا WAC الجاري — FR-02-07)
    const now = nowISO();
    for (const ln of returnLines) {
      const isService = Number(ln.item.is_service ?? 0) === 1 || ln.item.product_id === null;
      if (isService) continue; // أصناف الخدمة تُرجع بلا حركة مخزون
      const origQty = dec(ln.item.qty);
      const unitCost = origQty.greaterThan(0) ? dec(ln.item.line_cost).div(origQty) : dec(0);
      await db.run(
        'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
          'VALUES(?, ?, \'sale_return\', ?, ?, \'invoice\', ?, ?, ?, ?, ?)',
        [
          ln.item.product_id!,
          original.warehouse_id,
          money(ln.qty),
          money(roundTo(unitCost, 4)),
          invoiceId,
          issuedAt,
          v.reason ?? null,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      await bumpStockLevel(db, ln.item.product_id!, original.warehouse_id, ln.qty);
    }

    // إرجاع المبلغ نقداً: خروج من الصندوق (cash_tx payment)
    if (v.direction === 'cash') {
      await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
          'customer_id, description, created_at, created_by) ' +
          'VALUES(\'payment\', ?, ?, ?, ?, ?, \'sale_return\', ?, ?, ?, ?, ?)',
        [
          cashboxId!,
          original.currency_id,
          money(total),
          money(original.exchange_rate),
          issuedAt,
          invoiceId,
          original.party_id,
          `رد نقدي لعميل — مرتجع بيع ${docNo} على ${original.invoice_no ?? original.id}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
    }

    await logAudit('sale_return', {
      entity: 'invoice',
      entityId: invoiceId,
      details: {
        invoiceNo: docNo,
        originalInvoiceId: original.id,
        originalInvoiceNo: original.invoice_no,
        direction: v.direction,
        total: money(total),
        reason: v.reason ?? null,
      },
    });

    result = { invoiceId, invoiceNo: docNo, total: money(total) };
  });

  return result;
}

// ============ مرتجع الشراء (FR-02-08) ============

export async function createPurchaseReturn(input: CreatePurchaseReturnInput): Promise<CreateReturnResult> {
  const v = CreatePurchaseReturnSchema.parse({
    ...input,
    cashboxId: input.cashboxId ?? null,
    reason: input.reason?.trim() === '' ? undefined : input.reason?.trim(),
  });

  const issuedAt = v.issuedAt ?? todayISO();
  const db = await getDb();
  let result: CreateReturnResult = { invoiceId: 0, invoiceNo: '', total: '0' };

  await db.transaction(async () => {
    // الفحوصات قبل أي كتابة
    await assertPeriodOpen(issuedAt);
    await assertBackdateAllowed(issuedAt);
    const original = await loadOriginal(db, v.originalInvoiceId, 'purchase');
    const { items } = await validateReturnLines(db, v.originalInvoiceId, 'purchase', v.lines);
    const byId = new Map(items.map((it) => [it.id, it]));
    // حصة كل بند من خصم الفاتورة الأصلي (distributeProRata على شبات الأصل — بالفهرس)
    const allocs = originalAllocations(original, items);
    const allocById = new Map<number, string>();
    items.forEach((it, i) => allocById.set(it.id, allocs[i]!));

    const taxMode = (await getSetting('invoicing.tax_mode')) === 'per_item' ? 'per_item' : 'on_total';
    const taxRate = money(original.tax_rate);

    // Snapshot تكلفة الشراء الأصلية لكل مجموعة (من حركات الشراء المرتبطة بالأصل)
    const snapshotRows = await db.all<{ product_id: number; q: string | number; v: string | number }>(
      'SELECT product_id, SUM(qty) AS q, SUM(qty * unit_cost) AS v FROM stock_movement ' +
        'WHERE ref_type = \'invoice\' AND ref_id = ? AND movement_type = \'purchase\' GROUP BY product_id',
      [original.id],
    );
    const snapshotByProduct = new Map<number, Decimal>();
    for (const s of snapshotRows) {
      const q = dec(s.q);
      snapshotByProduct.set(Number(s.product_id), q.greaterThan(0) ? dec(s.v).div(q) : dec(0));
    }

    // فحص توفر المخزون في مستودع الأصل + حساب snapshot عند غياب الحركة (فتحة دفاعية)
    for (const ln of v.lines) {
      const item = byId.get(ln.itemId)!;
      const isService = Number(item.is_service ?? 0) === 1 || item.product_id === null;
      if (isService) continue;
      const lv = await db.all<{ qty: string | number }>(
        'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
        [item.product_id, original.warehouse_id],
      );
      const current = lv.length > 0 ? dec(lv[0]!.qty) : dec(0);
      if (dec(ln.qty).greaterThan(current)) {
        throw new Error(
          `لا يمكن إرجاع الصنف «${item.product_name ?? 'بند'}»: الرصيد الحالي في المخزن (${money(current)}) أقل من الكمية المطلوب إرجاعها (${ln.qty}) — راجع الكمية`,
        );
      }
      if (!snapshotByProduct.has(item.product_id!)) {
        snapshotByProduct.set(item.product_id!, dec(item.line_cost).div(dec(item.qty).greaterThan(0) ? dec(item.qty) : dec(1)));
      }
    }

    // مبالغ المرتجع (نفس منطق البيع)
    let subtotal = dec(0);
    let discountShare = dec(0);
    let taxAmount = dec(0);
    let costTotal = dec(0);
    const returnLines: { item: OriginalItemRow; qty: Decimal; lineTotal: string; lineCost: string }[] = [];

    for (const ln of v.lines) {
      const item = byId.get(ln.itemId)!;
      const qty = dec(ln.qty);
      const origQty = dec(item.qty);
      const unitPrice = dec(item.unit_price);
      const lineDiscount = roundTo(qty.times(unitPrice).times(dec(item.discount_percent)).div(100), 4);
      const lineNet = roundTo(qty.times(unitPrice).minus(lineDiscount), 4);
      const allocOfLine = dec(allocById.get(item.id) ?? '0');
      const allocShare = origQty.greaterThan(0) ? allocOfLine.times(qty).div(origQty) : dec(0);
      const charged = roundTo(lineNet.minus(roundTo(allocShare, 4)), 4);
      const lineTax =
        taxMode === 'on_total'
          ? roundTo(charged.times(dec(taxRate)).div(100), 4)
          : roundTo(lineNet.times(dec(item.tax_percent)).div(100), 4);
      const lineTotal = roundTo(charged.plus(lineTax), 4);
      // التكلفة عند الإخراج = Snapshot حركة الشراء الأصلية (لا line_cost المُخزَّن الذي قد يتضمن تقريباً مختلفاً)
      const snapshot = item.product_id === null ? dec(0) : (snapshotByProduct.get(item.product_id) ?? dec(0));
      const lineCost = roundTo(snapshot.times(qty), 4);

      subtotal = subtotal.plus(lineNet);
      discountShare = discountShare.plus(roundTo(allocShare, 4));
      taxAmount = taxAmount.plus(lineTax);
      costTotal = costTotal.plus(lineCost);
      returnLines.push({ item, qty, lineTotal: money(lineTotal), lineCost: money(lineCost) });
    }

    const total = roundTo(subtotal.minus(roundTo(discountShare, 4)).plus(taxAmount), 4);
    if (total.lte(0)) {
      throw new Error('صافي المرتجع صفر أو سالب — لا يمكن الحفظ. راجع الكميات أو خصومات الفاتورة الأصلية');
    }

    let cashboxId: number | null = null;
    if (v.direction === 'cash') {
      cashboxId = v.cashboxId ?? original.cashbox_id ?? null;
      if (cashboxId === null) {
        throw new Error('مرتجع النقد يتطلب صندوقاً — اختر الصندوق الذي سيستلم فيه المبلغ من المورد');
      }
      const box = await db.all<{ id: number; currency_id: number }>(
        'SELECT id, currency_id FROM cashbox WHERE id = ?',
        [cashboxId],
      );
      if (box.length === 0) {
        throw new Error(`الصندوق (رقم ${cashboxId}) غير موجود — أعد اختيار الصندوق`);
      }
      if (Number(box[0]!.currency_id) !== Number(original.currency_id)) {
        throw new Error('عملة الصندوق تختلف عن عملة الفاتورة الأصلية — اختر صندوقاً بعملة الفاتورة (قرار 8)');
      }
    }

    const { docNo } = await nextDocNumber('PRN', { date: issuedAt });

    const invoiceId = await insertReturnInvoice(db, {
      docType: 'purchase_return',
      invoiceNo: docNo,
      issuedAt,
      original,
      payStatus: v.direction === 'cash' ? 'cash' : 'credit',
      cashboxId,
      total: money(total),
      subtotal: money(roundTo(subtotal, 4)),
      discountAmount: money(roundTo(discountShare, 4)),
      taxRate,
      taxAmount: money(roundTo(taxAmount, 4)),
      costTotal: money(roundTo(costTotal, 4)),
      reason: v.reason,
      partyId: original.party_id,
      lines: returnLines,
    });

    // المخزون: الكمية تخرج بسعر حركة الشراء الأصلية + إعادة حساب WAC على المتبقي
    const now = nowISO();
    const wacTouched = new Set<number>();
    for (const ln of returnLines) {
      const isService = Number(ln.item.is_service ?? 0) === 1 || ln.item.product_id === null;
      if (isService) continue;
      const pid = ln.item.product_id!;
      const snapshot = snapshotByProduct.get(pid) ?? dec(0);

      await db.run(
        'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
          'VALUES(?, ?, \'purchase_return\', ?, ?, \'invoice\', ?, ?, ?, ?, ?)',
        [
          pid,
          original.warehouse_id,
          money(ln.qty.neg()),
          money(roundTo(snapshot, 4)),
          invoiceId,
          issuedAt,
          v.reason ?? null,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      await bumpStockLevel(db, pid, original.warehouse_id, ln.qty.neg());

      // إعادة حساب WAC مرة واحدة لكل صنف (بعد خصم كل كميات الإرجاع له)
      if (!wacTouched.has(pid)) {
        wacTouched.add(pid);
        const qtyTotal = await totalStockOf(db, pid); // بعد الإخراج
        const prod = await db.all<{ name: string; cost_price: string | number }>(
          'SELECT name, cost_price FROM product WHERE id = ?',
          [pid],
        );
        const costNow = dec(prod[0]?.cost_price ?? 0);
        const returnedHere = returnLines
          .filter((x) => x.item.product_id === pid)
          .reduce((acc, x) => acc.plus(x.qty), dec(0));
        const snapshotHere = snapshotByProduct.get(pid) ?? dec(0);
        if (qtyTotal.greaterThan(0)) {
          // (qty_total + qty_return)×wac − qty_return×snapshot) / qty_total — موثقة أعلاه
          const before = qtyTotal.plus(returnedHere);
          const newCost = roundTo(before.times(costNow).minus(returnedHere.times(snapshotHere)).div(qtyTotal), 4);
          await db.run('UPDATE product SET cost_price = ?, updated_at = ? WHERE id = ?', [money(newCost), now, pid]);
        }
        // qty_total = 0 → تُبقى التكلفة الحالية (قرار موثق)
      }
    }

    // إرجاع المبلغ نقداً: دخول للصندوق (cash_tx receipt من المورد)
    if (v.direction === 'cash') {
      await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
          'supplier_id, description, created_at, created_by) ' +
          'VALUES(\'receipt\', ?, ?, ?, ?, ?, \'purchase_return\', ?, ?, ?, ?, ?)',
        [
          cashboxId!,
          original.currency_id,
          money(total),
          money(original.exchange_rate),
          issuedAt,
          invoiceId,
          original.party_id,
          `استلام من مورّد — مرتجع شراء ${docNo} على ${original.invoice_no ?? original.id}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
    }

    await logAudit('purchase_return', {
      entity: 'invoice',
      entityId: invoiceId,
      details: {
        invoiceNo: docNo,
        originalInvoiceId: original.id,
        originalInvoiceNo: original.invoice_no,
        direction: v.direction,
        total: money(total),
        reason: v.reason ?? null,
      },
    });

    result = { invoiceId, invoiceNo: docNo, total: money(total) };
  });

  return result;
}

// ============ القراءة (ReturnFlow §6.5) ============

/** بنود الفاتورة الأصلية مع القيم القابلة للإرجاع (المباع − المرتجع سابقاً). */
export async function returnableLines(originalInvoiceId: number): Promise<ReturnableLineRow[]> {
  const db = await getDb();
  const rows = await db.all<{
    doc_type: string;
    status: string;
  }>('SELECT doc_type, status FROM invoice WHERE id = ?', [originalInvoiceId]);
  if (rows.length === 0) return [];
  const docType = rows[0]!.doc_type === 'purchase' ? 'purchase' : 'sale';
  const returnDocType = docType === 'sale' ? 'sale_return' : 'purchase_return';

  const items = await loadOriginalItems(db, originalInvoiceId);
  const originalByPool = new Map<string, Decimal>();
  for (const it of items) {
    const k = poolKeyOf(it);
    originalByPool.set(k, (originalByPool.get(k) ?? dec(0)).plus(dec(it.qty)));
  }
  const prior = await priorReturnedByPool(db, originalInvoiceId, returnDocType);

  return items.map((it) => {
    const k = poolKeyOf(it);
    const origQty = originalByPool.get(k) ?? dec(0);
    const priorQty = prior.get(k) ?? dec(0);
    const remaining = Decimal.max(origQty.minus(priorQty), dec(0));
    const qty = dec(it.qty);
    return {
      itemId: Number(it.id),
      productId: it.product_id === null ? null : Number(it.product_id),
      name: it.product_name ?? it.line_desc ?? 'بند حر',
      isService: Number(it.is_service ?? 0) === 1 || it.product_id === null,
      qtySold: money(qty),
      unitPrice: money(it.unit_price),
      discountPercent: money(it.discount_percent),
      taxPercent: money(it.tax_percent),
      lineTotal: money(it.line_total),
      lineCost: money(it.line_cost),
      unitCost: money(qty.greaterThan(0) ? roundTo(dec(it.line_cost).div(qty), 4) : dec(0)),
      qtyReturned: money(Decimal.min(priorQty, origQty)),
      returnable: money(remaining),
    };
  });
}

/** سياق الفاتورة الأصلية لشاشة المرتجع (رقم/طرف/عملة/إجمالي). */
export async function getReturnContext(originalInvoiceId: number): Promise<ReturnContextRow | null> {
  const db = await getDb();
  const rows = await db.all<
    OriginalInvoiceRow & {
      doc_type: string;
      party_id: number | null;
      party_name: string | null;
      due_amount: string | number;
      party_phone: string | null;
    }
  >(
    'SELECT i.id, i.invoice_no, i.doc_type, i.status, i.pay_status, i.issued_at, i.due_amount, ' +
      'CASE WHEN i.doc_type = \'sale\' THEN i.customer_id ELSE i.supplier_id END AS party_id, ' +
      'CASE WHEN i.doc_type = \'sale\' THEN cu.name ELSE su.name END AS party_name, ' +
      'CASE WHEN i.doc_type = \'sale\' THEN cu.phone ELSE su.phone END AS party_phone, ' +
      'i.cashbox_id, i.warehouse_id, i.currency_id, c.code AS currency_code, c.decimals AS currency_decimals, ' +
      'i.exchange_rate, i.rate_is_fallback, i.discount_amount, i.tax_rate, i.subtotal, i.total ' +
      'FROM invoice i ' +
      'LEFT JOIN customer cu ON cu.id = i.customer_id ' +
      'LEFT JOIN supplier su ON su.id = i.supplier_id ' +
      'LEFT JOIN currency c ON c.id = i.currency_id ' +
      'WHERE i.id = ? AND i.doc_type IN (\'sale\', \'purchase\')',
    [originalInvoiceId],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    docType: r.doc_type === 'purchase' ? 'purchase' : 'sale',
    status: r.status,
    payStatus: r.pay_status,
    issuedAt: r.issued_at,
    partyId: r.party_id === null ? null : Number(r.party_id),
    partyName: r.party_name,
    currencyId: Number(r.currency_id),
    currencyCode: r.currency_code,
    currencyDecimals: Number(r.currency_decimals ?? 2),
    total: money(r.total),
    dueAmount: money(r.due_amount),
    cashboxId: r.cashbox_id === null ? null : Number(r.cashbox_id),
    warehouseId: Number(r.warehouse_id),
  };
}

/** مرتجعات مرتبطة بفاتورة (بيع أو شراء حسب نوعها). */
export async function listReturnsFor(originalInvoiceId: number): Promise<LinkedReturnRow[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: number;
    invoice_no: string | null;
    issued_at: string;
    total: string | number;
    status: string;
    pay_status: string;
  }>(
    'SELECT id, invoice_no, issued_at, total, status, pay_status FROM invoice ' +
      "WHERE original_invoice_id = ? AND doc_type IN ('sale_return', 'purchase_return') " +
      'ORDER BY issued_at DESC, id DESC',
    [originalInvoiceId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    issuedAt: r.issued_at,
    total: money(r.total),
    status: r.status,
    payStatus: r.pay_status,
  }));
}
