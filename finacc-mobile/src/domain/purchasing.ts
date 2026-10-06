import { z } from 'zod';
import { getDb } from '@/db/client';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { computeInvoiceTotals, distributeProRata, assertTotalsValid } from './invoice-math';
import { nextDocNumber } from './docseq';
import { getRateSnapshot } from './currency';
import { getSetting } from './settings';
import { assertPeriodOpen, assertBackdateAllowed } from './fiscal';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * وحدة الشراء (FR-02-08 + FR-02-15 + قاعدة WAC 5.4-3) — Task 4-b:
 *
 * الشراء = مرآة البيع باتجاه معاكس داخل transaction واحدة:
 *  - حركة مخزون 'purchase' كمية موجبة + زيادة stock_level.
 *  - خصم رأس الفاتورة يوزَّع pro-rata على البنود قبل تحديث WAC (قاعدة 5.4-3):
 *      distributeProRata(invoiceDiscount, lineNets) → unit_cost_net = (lineNet − allocated)/qty
 *  - WAC الجديد: new_cost = (qty_old×cost_old + qty_new×unit_cost_net)/(qty_old+qty_new)
 *      (qty_old ≤ 0 → unit_cost_net مباشرة) — qty_old هو الرصيد الكلي للصنف عبر كل
 *      المخازن (cost_price حقل واحد على مستوى الصنف — قرار موثق).
 *      كل الحسابات Decimal صريحة بتقريب 4 منازل (NUMERIC(14,4)).
 *  - الدفع: cash/mixed → cash_tx tx_type='payment' (خروج من الصندوق) + payment_allocation؛
 *      credit → due على المورد (رصيد المورد يزيد تلقائياً بمعادلة parties القرار 8 لأن
 *      invoice.due_amount بعملة الفاتورة).
 *      **قرار موثق**: cash_tx الجزء النقدي الفوري يُسجَّل بـ supplier_id=NULL — لقد دُفع
 *      المبلغ لحظة الشراء ولم يُقيَّد AP أصلاً، وإسناده للمورد سيُخصم مرتين في معادلة
 *      رصيد المورد (افتتاحي + Σ purchase.due − Σ payments − Σ purchase_return.due).
 *      payment_allocation يحفظ الربط بالفاتورة للتوثيق.
 *  - المسودة (draft): بلا رقم وبلا أثر مالي/مخزوني (قرار 2).
 *
 * voidPurchaseInvoice (FR-02-15): عكس كامل بلا حذف فيزيائي:
 *  - حركات شراء معاكسة سالبة بنفس unit_cost الأصلية + إنقاص stock_level.
 *  - **القرار الموثق لإرجاع WAC**: يُعاد حسابه رياضياً على الصافي المتبقي:
 *        new_cost = (qty_total×wac_current − qty_inv×unit_cost_net)/(qty_total − qty_inv)
 *    وهو يعيد تماماً قيمة ما قبل الشراء إن لم تدخل حركات أخرى، ويبقى صحيحاً رياضياً
 *    بعد مبيعات واجهت WAC ثابتاً. إن كان المتبقي صفراً (رُجعت كل الكمية) تُبقى
 *    التكلفة الحالية (لا أساس كمية لإعادة الحساب — ستُستبدل عند أول شراء قادم لأن
 *    qty_old=0 يعتمد التكلفة الجديدة مباشرة). التفاصيل تُقيَّد في audit.
 *  - عكس النقدية: UPDATE cash_tx SET is_voided=1 لكل سندات الصرف المرتبطة بالفاتورة
 *    (**قرار موثق**: إبطال الصف نفسه بدل صف عكسي جديد — لا أثر مزدوج في رصيد الصندوق
 *    ولا في معادلات الأطراف).
 *  - يُرفض لو على الفاتورة مرتجعات شراء مكتملة (تُلغى المرتجعات أولاً — AC-21)،
 *    أو لو كان المخزون الحالي أقل من كمية الفاتورة (سيخالف CHECK qty ≥ 0).
 *  - رصيد المورد يرجع تلقائياً (المعادلة تعُدّ status='completed' فقط).
 */

// ============ الأنواع والعقود ============

export interface PurchaseItemInput {
  /** null = سطر حر (خدمة/وصف) بلا صنف */
  productId: number | null;
  lineDesc?: string;
  qty: string;
  unitPrice: string;
  discountPercent?: string;
  taxPercent?: string;
}

export interface SavePurchaseInput {
  items: PurchaseItemInput[];
  payType: 'cash' | 'credit' | 'mixed';
  cashPart?: string;
  supplierId?: number | null;
  cashboxId?: number | null;
  warehouseId: number;
  currencyId: number;
  /** يوزَّع pro-rata على البنود قبل تحديث WAC (قاعدة 5.4-3) */
  invoiceDiscount?: string;
  notesInternal?: string;
  notesPrinted?: string;
  issuedAt?: string;
  saveAsDraft?: boolean;
  managerConfirmedBackdate?: boolean;
}

export interface SavePurchaseResult {
  invoiceId: number;
  invoiceNo: string | null;
  total: string;
  dueAmount: string;
}

/** صف قائمة فواتير الشراء (شاشة purchases/index). */
export interface PurchaseListRow {
  id: number;
  invoiceNo: string | null;
  issuedAt: string;
  status: string;
  payStatus: string;
  supplierId: number | null;
  supplierName: string | null;
  currencyCode: string;
  total: string;
  dueAmount: string;
  itemCount: number;
}

/** بند تفاصيل فاتورة شراء (purchase أو purchase_return — الشاشة type-aware). */
export interface PurchaseInvoiceItemRow {
  id: number;
  productId: number | null;
  /** اسم الصنف أو وصف السطر الحر */
  name: string;
  barcode: string | null;
  isService: boolean;
  qty: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxPercent: string;
  /** صافي البند بعد خصمه (قبل خصم الفاتورة وضريبته) */
  lineTotal: string;
  /** التكلفة الصافية للسطر بعد توزيع خصم الفاتورة (Snapshot) */
  lineCost: string;
  unitCost: string;
}

/** مرتجع مرتبط بفاتورة (قائمة «مرتجعات مرتبطة» في التفاصيل). */
export interface LinkedReturnRow {
  id: number;
  invoiceNo: string | null;
  issuedAt: string;
  total: string;
  status: string;
  payStatus: string;
}

export interface PurchaseInvoiceFull {
  id: number;
  invoiceNo: string | null;
  docType: 'purchase' | 'purchase_return';
  payStatus: string;
  status: string;
  issuedAt: string;
  originalInvoiceId: number | null;
  originalInvoiceNo: string | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierPhone: string | null;
  cashboxId: number | null;
  cashboxName: string | null;
  warehouseId: number;
  warehouseName: string | null;
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
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
  items: PurchaseInvoiceItemRow[];
  returns: LinkedReturnRow[];
}

// ============ مخطط zod ============

const POS_DEC = /^\d+(\.\d+)?$/;

const PurchaseItemSchema = z.object({
  productId: z.number().int().positive('رقم الصنف غير صالح').nullable(),
  lineDesc: z.string().trim().max(200, 'وصف البند طويل (200 حرف كحد أقصى)').optional(),
  qty: z.string().regex(POS_DEC, 'كمية البند يجب أن تكون رقماً أكبر من صفر مثل «10»'),
  unitPrice: z.string().regex(POS_DEC, 'سعر الشراء يجب أن يكون رقماً غير سالب مثل «800»'),
  discountPercent: z
    .string()
    .regex(POS_DEC, 'نسبة خصم البند يجب أن تكون رقماً بين 0 و100')
    .refine((s) => Number(s) <= 100, { message: 'نسبة خصم البند يجب أن تكون بين 0 و100' })
    .optional(),
  taxPercent: z.string().regex(POS_DEC, 'نسبة ضريبة البند يجب أن تكون رقماً بين 0 و100').optional(),
});

const SavePurchaseSchema = z.object({
  items: z.array(PurchaseItemSchema).min(1, 'أضف بنداً واحداً على الأقل إلى فاتورة الشراء'),
  payType: z.enum(['cash', 'credit', 'mixed']),
  cashPart: z.string().regex(POS_DEC, 'الجزء النقدي يجب أن يكون رقماً أكبر من صفر').optional(),
  supplierId: z.number().int().positive('رقم المورد غير صالح').nullable().optional(),
  cashboxId: z.number().int().positive('رقم الصندوق غير صالح').nullable().optional(),
  warehouseId: z.number().int().positive('رقم المستودع غير صالح'),
  currencyId: z.number().int().positive('رقم العملة غير صالح'),
  invoiceDiscount: z.string().regex(POS_DEC, 'خصم الفاتورة يجب أن يكون رقماً غير سالب').optional(),
  notesInternal: z.string().trim().max(1000, 'الملاحظات الداخلية طويلة (1000 حرف كحد أقصى)').optional(),
  notesPrinted: z.string().trim().max(500, 'ملاحظات الطباعة طويلة (500 حرف كحد أقصى)').optional(),
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ الفاتورة يجب أن يكون بصيغة YYYY-MM-DD')
    .optional(),
  saveAsDraft: z.boolean().optional(),
  managerConfirmedBackdate: z.boolean().optional(),
});

function nowISO(): string {
  return new Date().toISOString();
}

/** قيمة اختيارية مُطهّرة: '' → undefined. */
function normOpt(v: string | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
}

/** إجمالي الكمية المتاحة لصنف عبر كل المخازن (أساس WAC — cost_price على مستوى الصنف). */
async function totalStockOf(db: Awaited<ReturnType<typeof getDb>>, productId: number): Promise<Decimal> {
  const rows = await db.all<{ q: string | number }>(
    'SELECT COALESCE(SUM(qty), 0) AS q FROM stock_level WHERE product_id = ?',
    [productId],
  );
  return dec(rows[0]?.q ?? 0);
}

/** تحديث رصيد مستودع لصنف (زيادة/إنقاص) — يُنادى داخل معاملة الحفظ. */
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

// ============ حفظ فاتورة الشراء (FR-02-08) ============

export async function savePurchaseInvoice(input: SavePurchaseInput): Promise<SavePurchaseResult> {
  const v = SavePurchaseSchema.parse({
    ...input,
    supplierId: input.supplierId ?? null,
    cashboxId: input.cashboxId ?? null,
    cashPart: normOpt(input.cashPart),
    invoiceDiscount: normOpt(input.invoiceDiscount),
    notesInternal: normOpt(input.notesInternal),
    notesPrinted: normOpt(input.notesPrinted),
  });

  const isDraft = v.saveAsDraft === true;

  // متطلبات نوع الدفع (تتخفف للمسودة — لا أثر لها أصلاً)
  if (!isDraft) {
    if ((v.payType === 'credit' || v.payType === 'mixed') && (v.supplierId === null || v.supplierId === undefined)) {
      throw new Error('فاتورة الشراء الآجلة/المختلطة تتطلب اختيار مورّد — اختر المورّد من القائمة أو حوّلها نقدياً');
    }
    if ((v.payType === 'cash' || v.payType === 'mixed') && (v.cashboxId === null || v.cashboxId === undefined)) {
      throw new Error('الدفع النقدي يتطلب اختيار صندوق — اختر الصندوق الذي سيُصرف منه المبلغ');
    }
    if (v.payType === 'mixed' && v.cashPart === undefined) {
      throw new Error('الفاتورة المختلطة تتطلب تحديد مبلغ الجزء النقدي — أدخل المبلغ المدفوع نقداً الآن');
    }
  }

  const issuedAt = v.issuedAt ?? todayISO();
  const db = await getDb();
  const now = nowISO();
  const userId = getCurrentUserId() ?? null;

  let result: SavePurchaseResult = { invoiceId: 0, invoiceNo: null, total: '0', dueAmount: '0' };

  await db.transaction(async () => {
    // حجابا الفترات والتأريخ الرجعي (قاعدة 5.4-11) — قبل أي كتابة
    await assertPeriodOpen(issuedAt);
    await assertBackdateAllowed(issuedAt, { managerConfirmed: v.managerConfirmedBackdate === true });

    // مراجع
    const wh = await db.all<{ id: number }>('SELECT id FROM warehouse WHERE id = ?', [v.warehouseId]);
    if (wh.length === 0) {
      throw new Error(`المستودع (رقم ${v.warehouseId}) غير موجود — أعد اختيار المستودع`);
    }
    const cur = await db.all<{ id: number }>('SELECT id FROM currency WHERE id = ?', [v.currencyId]);
    if (cur.length === 0) {
      throw new Error(`العملة (رقم ${v.currencyId}) غير موجودة — أعد اختيار العملة`);
    }
    if (v.supplierId !== null && v.supplierId !== undefined) {
      const sup = await db.all<{ id: number }>('SELECT id FROM supplier WHERE id = ?', [v.supplierId]);
      if (sup.length === 0) {
        throw new Error(`المورّد (رقم ${v.supplierId}) غير موجود — أعد اختيار المورّد`);
      }
    }
    if (v.cashboxId !== null && v.cashboxId !== undefined) {
      const box = await db.all<{ id: number; currency_id: number }>(
        'SELECT id, currency_id FROM cashbox WHERE id = ?',
        [v.cashboxId],
      );
      if (box.length === 0) {
        throw new Error(`الصندوق (رقم ${v.cashboxId}) غير موجود — أعد اختيار الصندوق`);
      }
      if (Number(box[0]!.currency_id) !== v.currencyId) {
        throw new Error('عملة الصندوق تختلف عن عملة الفاتورة — اختر صندوقاً بعملة الفاتورة (قرار 8: لا تُجمع عملات مختلفة)');
      }
    }

    // الضريبة: نمط الإعدادات + نسبة الشركة
    const taxMode = (await getSetting('invoicing.tax_mode')) === 'per_item' ? 'per_item' : 'on_total';
    const companyRows = await db.all<{ tax_rate: string | number }>('SELECT tax_rate FROM company LIMIT 1');
    const taxRate = money(companyRows[0]?.tax_rate ?? '0');

    // الإجماليات عبر invoice-math (قاعدة إلزامية)
    const totals = computeInvoiceTotals(
      v.items.map((it) => ({
        productId: it.productId,
        lineDesc: it.lineDesc,
        qty: it.qty,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxPercent: it.taxPercent,
      })),
      { taxMode, taxRate, invoiceDiscount: v.invoiceDiscount ?? '0' },
    );
    assertTotalsValid(totals);

    // توزيع خصم رأس الفاتورة pro-rata قبل تحديث WAC (قاعدة 5.4-3)
    const allocs = distributeProRata(
      v.invoiceDiscount ?? '0',
      totals.lines.map((l) => l.lineNet),
    );

    const total = dec(totals.total);

    // المدفوع/المتبقي حسب نوع الدفع
    let paid = dec(0);
    if (!isDraft) {
      if (v.payType === 'cash') {
        paid = total;
      } else if (v.payType === 'mixed') {
        paid = dec(v.cashPart!);
        if (paid.greaterThan(total)) {
          throw new Error(
            `الجزء النقدي (${paid.toFixed(2)}) أكبر من إجمالي الفاتورة (${total.toFixed(2)}) — صحّح المبلغ`,
          );
        }
      }
    }
    const due = isDraft ? dec(0) : total.minus(paid); // المسودة بلا أثر — لا دين ولا مدفوع

    // لقطة سعر الصرف (قرار 3) — حتى للمسودة (عمود NOT NULL)
    const rate = await getRateSnapshot(v.currencyId, issuedAt);
    const totalBase = roundTo(total.times(dec(rate.rate)), 4);

    // الرقم يُستهلك للمكتملة فقط (قرار 2)
    const invoiceNo = isDraft ? null : (await nextDocNumber('PUR', { date: issuedAt })).docNo;

    const invRes = await db.run(
      'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, supplier_id, cashbox_id, warehouse_id, ' +
        'currency_id, exchange_rate, rate_is_fallback, subtotal, discount_amount, tax_rate, tax_amount, total, total_base, ' +
        'paid_amount, due_amount, cost_total, notes_internal, notes_printed, created_at, updated_at, created_by) ' +
        "VALUES(?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        invoiceNo,
        v.payType,
        isDraft ? 'draft' : 'completed',
        issuedAt,
        v.supplierId ?? null,
        !isDraft && (v.payType === 'cash' || v.payType === 'mixed') ? (v.cashboxId ?? null) : null,
        v.warehouseId,
        v.currencyId,
        rate.rate,
        rate.rateIsFallback ? 1 : 0,
        totals.subtotal,
        totals.invoiceDiscount,
        taxRate,
        totals.taxAmount,
        totals.total,
        money(totalBase),
        money(roundTo(paid, 4)),
        money(roundTo(due, 4)),
        totals.costTotal,
        v.notesInternal ?? null,
        v.notesPrinted ?? null,
        now,
        now,
        userId,
      ],
    );
    const invoiceId = Number(invRes.lastInsertRowId);

    // البنود + التكلفة الصافية (بعد التوزيع) + WAC + الحركات المخزونية
    let costTotal = dec(0);
    for (let i = 0; i < v.items.length; i++) {
      const it = v.items[i]!;
      const line = totals.lines[i]!;
      const qty = dec(it.qty);
      const allocated = dec(allocs[i]!);
      const netCost = roundTo(dec(line.lineNet).minus(allocated), 4); // التكلفة الصافية للسطر
      const unitCostNet = qty.greaterThan(0) ? netCost.div(qty) : dec(0);

      let unitId: number | null = null;
      if (it.productId !== null) {
        const prod = await db.all<{
          id: number;
          name: string;
          cost_price: string | number;
          is_service: number;
          unit_id: number | null;
        }>('SELECT id, name, cost_price, is_service, unit_id FROM product WHERE id = ?', [it.productId]);
        if (prod.length === 0) {
          throw new Error(`الصنف (رقم ${it.productId}) غير موجود في بند رقم ${i + 1} — أعد اختيار الصنف`);
        }
        unitId = prod[0]!.unit_id === null ? null : Number(prod[0]!.unit_id);

        if (!isDraft) {
          const isService = Number(prod[0]!.is_service) === 1;
          if (!isService) {
            // WAC الجديد (قاعدة 5.4-3) — Decimal صريح بتقريب 4 منازل
            const qtyOld = await totalStockOf(db, it.productId);
            const costOld = dec(prod[0]!.cost_price);
            let newCost: Decimal;
            if (qtyOld.lte(0)) {
              newCost = unitCostNet; // qty_old ≤ 0 → التكلفة الجديدة مباشرة
            } else {
              newCost = roundTo(qtyOld.times(costOld).plus(qty.times(unitCostNet)).div(qtyOld.plus(qty)), 4);
            }
            await db.run('UPDATE product SET cost_price = ?, updated_at = ? WHERE id = ?', [
              money(newCost),
              now,
              it.productId,
            ]);
            await bumpStockLevel(db, it.productId, v.warehouseId, qty);
            await db.run(
              'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
                "VALUES(?, ?, 'purchase', ?, ?, 'invoice', ?, ?, NULL, ?, ?)",
              [it.productId, v.warehouseId, money(qty), money(roundTo(unitCostNet, 4)), invoiceId, issuedAt, now, userId],
            );
          }
        }
      }

      await db.run(
        'INSERT INTO invoice_item(invoice_id, product_id, line_desc, qty, unit_id, unit_factor, unit_price, ' +
          'discount_percent, discount_amount, tax_percent, line_total, line_cost, notes, created_at) ' +
          'VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?)',
        [
          invoiceId,
          it.productId,
          it.lineDesc ?? null,
          money(qty),
          unitId,
          it.unitPrice,
          it.discountPercent ?? '0',
          line.lineDiscount,
          it.taxPercent ?? '0',
          line.lineTotal,
          money(netCost),
          now,
        ],
      );
      costTotal = costTotal.plus(netCost);
    }
    await db.run('UPDATE invoice SET cost_total = ? WHERE id = ?', [money(roundTo(costTotal, 4)), invoiceId]);

    // النقدية: صرف من الصندوق (cash/mixed) + ربط التخصيص — supplier_id=NULL (قرار موثق أعلاه)
    if (!isDraft && paid.greaterThan(0)) {
      const txRes = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
          'supplier_id, description, created_at, created_by) ' +
        "VALUES('payment', ?, ?, ?, ?, ?, 'invoice', ?, NULL, ?, ?, ?)",
        [
          v.cashboxId!,
          v.currencyId,
          money(roundTo(paid, 4)),
          rate.rate,
          issuedAt,
          invoiceId,
          `دفع فاتورة شراء ${invoiceNo ?? ''}`.trim(),
          now,
          userId,
        ],
      );
      await db.run(
        'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
        [Number(txRes.lastInsertRowId), invoiceId, money(roundTo(paid, 4)), issuedAt, userId],
      );
    }

    await logAudit(isDraft ? 'purchase_draft_saved' : 'purchase_saved', {
      entity: 'invoice',
      entityId: invoiceId,
      details: {
        invoiceNo,
        payType: v.payType,
        total: totals.total,
        paid: money(roundTo(paid, 4)),
        due: money(roundTo(due, 4)),
        supplierId: v.supplierId ?? null,
        items: v.items.length,
      },
    });

    result = {
      invoiceId,
      invoiceNo,
      total: money(totals.total),
      dueAmount: money(roundTo(due, 4)),
    };
  });

  return result;
}

// ============ إلغاء فاتورة شراء (FR-02-15) ============

export async function voidPurchaseInvoice(
  invoiceId: number,
  opts: { managerConfirmed: boolean; reason?: string },
): Promise<void> {
  if (opts.managerConfirmed !== true) {
    throw new Error('إلغاء فاتورة الشراء يتطلب تأكيد المدير — أكد الإلغاء من نافذة التأكيد أولاً');
  }
  const db = await getDb();
  const now = nowISO();

  await db.transaction(async () => {
    const rows = await db.all<{
      id: number;
      doc_type: string;
      invoice_no: string | null;
      status: string;
      issued_at: string;
      supplier_id: number | null;
      cashbox_id: number | null;
      currency_id: number;
    }>(
      'SELECT id, doc_type, invoice_no, status, issued_at, supplier_id, cashbox_id, currency_id FROM invoice WHERE id = ?',
      [invoiceId],
    );
    if (rows.length === 0) {
      throw new Error(`فاتورة الشراء (رقم ${invoiceId}) غير موجودة`);
    }
    const inv = rows[0]!;
    if (inv.doc_type !== 'purchase') {
      throw new Error('هذا المستند ليس فاتورة شراء — الإلغاء يُنفَّذ من شاشته الخاصة بنوعه');
    }
    if (inv.status === 'void') {
      throw new Error('الفاتورة ملغاة مسبقاً — لا يمكن تكرار الإلغاء');
    }
    if (inv.status === 'draft') {
      throw new Error('لا يمكن إلغاء مسودة — للمسودة أثر مالي أو مخزوني أصلاً؛ أنشئ فاتورة جديدة عند الحاجة');
    }

    // رفض لو عليها مرتجعات شراء مكتملة (FR-02-15)
    const linked = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM invoice WHERE original_invoice_id = ? AND doc_type = 'purchase_return' AND status = 'completed'",
      [invoiceId],
    );
    if (Number(linked[0]?.c ?? 0) > 0) {
      throw new Error(
        'لا يمكن إلغاء الفاتورة: عليها مرتجعات شراء مكتملة — راجع المرتجعات المرتبطة من شاشة التفاصيل أولاً',
      );
    }

    // عكس المخزون: حركات معاكسة سالبة بنفس unit_cost الأصلية (Snapshot)
    const movements = await db.all<{
      id: number;
      product_id: number;
      warehouse_id: number;
      qty: string | number;
      unit_cost: string | number;
    }>(
      "SELECT id, product_id, warehouse_id, qty, unit_cost FROM stock_movement " +
        "WHERE ref_type = 'invoice' AND ref_id = ? AND movement_type = 'purchase'",
      [invoiceId],
    );

    // تجميع أثر كل صنف لإعادة حساب WAC دفعة واحدة (منتج قد يرد في عدة بنود)
    const perProduct = new Map<
      number,
      { qtyInv: Decimal; valueInv: Decimal; warehouses: { warehouseId: number; qty: Decimal }[] }
    >();
    for (const m of movements) {
      const pid = Number(m.product_id);
      const qty = dec(m.qty);
      const unit = dec(m.unit_cost);
      const e = perProduct.get(pid) ?? { qtyInv: dec(0), valueInv: dec(0), warehouses: [] };
      e.qtyInv = e.qtyInv.plus(qty);
      e.valueInv = e.valueInv.plus(qty.times(unit));
      const wid = Number(m.warehouse_id);
      const existing = e.warehouses.find((w) => w.warehouseId === wid);
      if (existing) existing.qty = existing.qty.plus(qty);
      else e.warehouses.push({ warehouseId: wid, qty });
      perProduct.set(pid, e);
    }

    const today = todayISO();
    for (const [pid, agg] of perProduct) {
      const prod = await db.all<{ name: string; cost_price: string | number }>(
        'SELECT name, cost_price FROM product WHERE id = ?',
        [pid],
      );
      const productName = prod[0]?.name ?? `#${pid}`;

      for (const w of agg.warehouses) {
        const lv = await db.all<{ qty: string | number }>(
          'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
          [pid, w.warehouseId],
        );
        const current = lv.length > 0 ? dec(lv[0]!.qty) : dec(0);
        if (current.lessThan(w.qty)) {
          throw new Error(
            `لا يمكن الإلغاء: الصنف «${productName}» رصيده الحالي (${money(current)}) أقل من كمية الفاتورة (${money(w.qty)}) — ` +
              'راجع حركات البيع أو أنشئ تسوية جرد أولاً',
          );
        }
      }

      // القرار الموثق لإرجاع WAC: إعادة حساب رياضية على الصافي المتبقي
      const qtyTotal = await totalStockOf(db, pid);
      const costNow = dec(prod[0]?.cost_price ?? 0);
      const remaining = qtyTotal.minus(agg.qtyInv);
      let newCost = costNow;
      if (remaining.greaterThan(0)) {
        newCost = roundTo(qtyTotal.times(costNow).minus(agg.valueInv).div(remaining), 4);
      } // remaining = 0 → تُبقى التكلفة الحالية (لا أساس كمي — موثق في رأس الملف)

      await db.run('UPDATE product SET cost_price = ?, updated_at = ? WHERE id = ?', [money(newCost), now, pid]);
    }

    // سطور العكس المخزوني (حركة شراء سالبة بنفس التكلفة — القرار الموثق)
    for (const m of movements) {
      const qty = dec(m.qty).neg();
      await db.run(
        'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
          "VALUES(?, ?, 'purchase', ?, ?, 'invoice', ?, ?, ?, ?, ?)",
        [
          Number(m.product_id),
          Number(m.warehouse_id),
          money(qty),
          money(dec(m.unit_cost)),
          invoiceId,
          today,
          `عكس شراء بإلغاء الفاتورة ${inv.invoice_no ?? invoiceId}${opts.reason ? ` — ${opts.reason}` : ''}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      await bumpStockLevel(db, Number(m.product_id), Number(m.warehouse_id), qty);
    }

    // عكس النقدية: إبطال سندات الصرف المرتبطة (قرار موثق — لا صفوف عكسية جديدة)
    await db.run(
      "UPDATE cash_tx SET is_voided = 1 WHERE ref_type = 'invoice' AND ref_id = ? AND is_voided = 0",
      [invoiceId],
    );

    // الحالة → void (الرقم لا يُعاد أبداً — 5.4-1) ورصيد المورد يرجع تلقائياً بالمعادلة
    await db.run("UPDATE invoice SET status = 'void', updated_at = ? WHERE id = ?", [now, invoiceId]);

    await logAudit('void_purchase_invoice', {
      entity: 'invoice',
      entityId: invoiceId,
      details: {
        invoiceNo: inv.invoice_no,
        reason: opts.reason ?? null,
        reversedMovements: movements.length,
        wacRecalc: [...perProduct.entries()].map(([pid, agg]) => ({
          productId: pid,
          qtyInv: money(agg.qtyInv),
          valueInv: money(roundTo(agg.valueInv, 4)),
        })),
      },
    });
  });
}

// ============ القوائم والتفاصيل ============

/** قائمة فواتير الشراء بفلاتر (شاشة purchases/index). */
export async function listPurchaseInvoices(opts?: {
  status?: 'completed' | 'draft' | 'void' | 'all';
  supplierId?: number;
  q?: string;
  limit?: number;
}): Promise<PurchaseListRow[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 500));
  const params: unknown[] = [];
  let where = " WHERE i.doc_type = 'purchase'";
  if (opts?.status && opts.status !== 'all') {
    where += ' AND i.status = ?';
    params.push(opts.status);
  }
  if (opts?.supplierId && opts.supplierId > 0) {
    where += ' AND i.supplier_id = ?';
    params.push(opts.supplierId);
  }
  const q = (opts?.q ?? '').trim();
  if (q.length > 0) {
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where += " AND (IFNULL(i.invoice_no, '') LIKE ? ESCAPE '\\' OR IFNULL(s.name, '') LIKE ? ESCAPE '\\')";
    params.push(`%${esc}%`, `%${esc}%`);
  }
  params.push(limit);

  const rows = await db.all<{
    id: number;
    invoice_no: string | null;
    issued_at: string;
    status: string;
    pay_status: string;
    supplier_id: number | null;
    supplier_name: string | null;
    currency_code: string;
    total: string | number;
    due_amount: string | number;
    item_count: number;
  }>(
    'SELECT i.id, i.invoice_no, i.issued_at, i.status, i.pay_status, i.supplier_id, s.name AS supplier_name, ' +
      'c.code AS currency_code, i.total, i.due_amount, ' +
      '(SELECT count(*) FROM invoice_item ii WHERE ii.invoice_id = i.id) AS item_count ' +
      'FROM invoice i LEFT JOIN supplier s ON s.id = i.supplier_id LEFT JOIN currency c ON c.id = i.currency_id' +
      where +
      ' ORDER BY i.issued_at DESC, i.id DESC LIMIT ?',
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    issuedAt: r.issued_at,
    status: r.status,
    payStatus: r.pay_status,
    supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
    supplierName: r.supplier_name,
    currencyCode: r.currency_code,
    total: money(r.total),
    dueAmount: money(r.due_amount),
    itemCount: Number(r.item_count),
  }));
}

/** تفاصيل فاتورة شراء أو مرتجع شراء (type-aware) مع المرتجعات المرتبطة. */
export async function getPurchaseInvoice(id: number): Promise<PurchaseInvoiceFull | null> {
  const db = await getDb();
  const rows = await db.all<{
    id: number;
    invoice_no: string | null;
    doc_type: string;
    pay_status: string;
    status: string;
    issued_at: string;
    original_invoice_id: number | null;
    original_invoice_no: string | null;
    supplier_id: number | null;
    supplier_name: string | null;
    supplier_phone: string | null;
    cashbox_id: number | null;
    cashbox_name: string | null;
    warehouse_id: number;
    warehouse_name: string | null;
    currency_id: number;
    currency_code: string;
    currency_decimals: number;
    exchange_rate: string | number;
    rate_is_fallback: number;
    subtotal: string | number;
    discount_amount: string | number;
    tax_rate: string | number;
    tax_amount: string | number;
    total: string | number;
    total_base: string | number;
    paid_amount: string | number;
    due_amount: string | number;
    cost_total: string | number;
    notes_internal: string | null;
    notes_printed: string | null;
  }>(
    'SELECT i.id, i.invoice_no, i.doc_type, i.pay_status, i.status, i.issued_at, i.original_invoice_id, ' +
      'o.invoice_no AS original_invoice_no, i.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone, ' +
      'i.cashbox_id, b.name AS cashbox_name, i.warehouse_id, w.name AS warehouse_name, ' +
      'i.currency_id, c.code AS currency_code, c.decimals AS currency_decimals, i.exchange_rate, i.rate_is_fallback, ' +
      'i.subtotal, i.discount_amount, i.tax_rate, i.tax_amount, i.total, i.total_base, i.paid_amount, i.due_amount, ' +
      'i.cost_total, i.notes_internal, i.notes_printed ' +
      'FROM invoice i ' +
      'LEFT JOIN supplier s ON s.id = i.supplier_id ' +
      'LEFT JOIN cashbox b ON b.id = i.cashbox_id ' +
      'LEFT JOIN warehouse w ON w.id = i.warehouse_id ' +
      'LEFT JOIN currency c ON c.id = i.currency_id ' +
      'LEFT JOIN invoice o ON o.id = i.original_invoice_id ' +
      "WHERE i.id = ? AND i.doc_type IN ('purchase','purchase_return')",
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;

  const itemRows = await db.all<{
    id: number;
    product_id: number | null;
    product_name: string | null;
    barcode: string | null;
    is_service: number | null;
    line_desc: string | null;
    qty: string | number;
    unit_price: string | number;
    discount_percent: string | number;
    discount_amount: string | number;
    tax_percent: string | number;
    line_total: string | number;
    line_cost: string | number;
  }>(
    'SELECT ii.id, ii.product_id, p.name AS product_name, p.barcode, p.is_service, ii.line_desc, ii.qty, ' +
      'ii.unit_price, ii.discount_percent, ii.discount_amount, ii.tax_percent, ii.line_total, ii.line_cost ' +
      'FROM invoice_item ii LEFT JOIN product p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id ASC',
    [id],
  );

  const returnRows = await db.all<{
    id: number;
    invoice_no: string | null;
    issued_at: string;
    total: string | number;
    status: string;
    pay_status: string;
  }>(
    'SELECT id, invoice_no, issued_at, total, status, pay_status FROM invoice ' +
      "WHERE original_invoice_id = ? AND doc_type = 'purchase_return' ORDER BY issued_at DESC, id DESC",
    [id],
  );

  return {
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    docType: r.doc_type === 'purchase_return' ? 'purchase_return' : 'purchase',
    payStatus: r.pay_status,
    status: r.status,
    issuedAt: r.issued_at,
    originalInvoiceId: r.original_invoice_id === null ? null : Number(r.original_invoice_id),
    originalInvoiceNo: r.original_invoice_no,
    supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
    supplierName: r.supplier_name,
    supplierPhone: r.supplier_phone,
    cashboxId: r.cashbox_id === null ? null : Number(r.cashbox_id),
    cashboxName: r.cashbox_name,
    warehouseId: Number(r.warehouse_id),
    warehouseName: r.warehouse_name,
    currencyId: Number(r.currency_id),
    currencyCode: r.currency_code,
    currencyDecimals: Number(r.currency_decimals ?? 2),
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
    items: itemRows.map((it) => {
      const qty = dec(it.qty);
      const lineCost = dec(it.line_cost);
      return {
        id: Number(it.id),
        productId: it.product_id === null ? null : Number(it.product_id),
        name: it.product_name ?? it.line_desc ?? 'بند حر',
        barcode: it.barcode,
        isService: Number(it.is_service ?? 0) === 1,
        qty: money(qty),
        unitPrice: money(it.unit_price),
        discountPercent: money(it.discount_percent),
        discountAmount: money(it.discount_amount),
        taxPercent: money(it.tax_percent),
        lineTotal: money(it.line_total),
        lineCost: money(lineCost),
        unitCost: money(qty.greaterThan(0) ? roundTo(lineCost.div(qty), 4) : dec(0)),
      };
    }),
    returns: returnRows.map((x) => ({
      id: Number(x.id),
      invoiceNo: x.invoice_no,
      issuedAt: x.issued_at,
      total: money(x.total),
      status: x.status,
      payStatus: x.pay_status,
    })),
  };
}
