import { z } from 'zod';
import { getDb } from '@/db/client';
import type { DbEngine } from '@/db/types';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getRateSnapshot } from './currency';
import { assertPeriodOpen, assertBackdateAllowed } from './fiscal';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';
import { nextDocNumber } from './docseq';

/**
 * النقدية — الصناديق والحركات والسندات والوردية (الوحدة 04 كاملة + قرارات 8/9):
 *
 * ── اصطلاح الإلغاء (متطابق حرفياً مع voidInvoice في invoicing.ts) ─────────────
 *   إلغاء حركة = الأصل is_voided=1 + حركة معاكسة reversal_of=<معرّف الأصل>.
 *   الزوج معاً يُستبعد من كل الأرصدة والوردية (is_voided=1 أو reversal_of NOT NULL)
 *   ويبقى في السجل للتدقيق — «أثرها زال من الرصيد» دون حذف فيزيائي (FR-04-08).
 *
 * ── دفتر الصندوق بعملته حصراً (قرار 8) ─────────────────────────────────────
 *   لكل صندوق عملة واحدة، ورصيده يُحسب بعملته: لا تدخل دفترَه إلا الحركات
 *   المسجَّلة بعملته. لهذا يُسجَّل التحويل بين صندوقين بعملتين مختلفتين
 *   بساقين تحملان نفس (cashbox_id=المصدر, to_cashbox_id=الوجهة) تختلفان في
 *   العملة والمبلغ: ساق صادرة بعملة المصدر ومبلغه، وساق واردة بعملة الوجهة
 *   ومبلغها المحوّل بسعر لحظة التحويل + settlement_rate + fx_gain_loss (FR-04-07).
 *   التحويل بعملة واحدة = ساق واحدة تكفي الطرفين.
 *
 * ── «opening» وارد ─────────────────────────────────────────────────────────
 *   قائمة الاتجاه في المهمة ذكرت الأنواع الجارية ونست «opening» — الرصيد
 *   الافتتاحي وارد بطبيعته (أموال موجودة في الصندوق) فأُدرج مع الوارد.
 *
 * ── قرار 9: السالب مسموح ────────────────────────────────────────────────────
 *   لا فحص سالب إطلاقاً في أي مسار نقدي؛ createCashTx يعيد newBalance ليحذّر
 *   الـ UI (شارة «سالب» + تأكيد قبل الحفظ). المنع يبقى للمخزون فقط.
 *
 * ── تخصيص FIFO للقبض الحر (قاعدة 5.4-6) ────────────────────────────────────
 *   المتبقي على فاتورة = due_amount − Σ(تخصيصات سنداتها التي تحمل الطرف) —
 *   سند القبض لحظة البيع النقدي لا يحمل customer_id (قرار invoicing الموثق)،
 *   فجزؤه النقدي محسوب أصلاً داخل due_amount ولا يُخصم مرتين.
 *
 * ── امتدادات موثقة على عقد المهمة (مجموعات عليا لا كسر) ────────────────────
 *   1) createCashTx يعيد newBalance إضافياً (لتحذير السالب في الواجهة).
 *   2) CashTxInput يقبل managerConfirmedBackdate (لا بد منه لقاعدة 5.4-11)
 *      و toAmount للتحويل بين عملتين (المبلغ المستلم فعلاً بعملة الوجهة —
 *      عند غيابه يُحسب نظرياً بسعر اليوم ويكون فرق الصرف صفراً؛ عند وجوده
 *      يظهر الفرق الحقيقي في fx_gain_loss).
 *   3) دوال عرض إضافية للشاشات: listCashboxOptions / customerOpenInvoices /
 *      lastShift.
 *   4) فرق الوردية = العد الفعلي − (الرصيد الافتتاحي + الوارد − الصادر):
 *      المستخدم يعدّ الدرج كاملاً، فلا يظهر له «زيادة» وهمية بقيمة العُدّة.
 */

// ============ الأنواع والعقود ============

export type CashTxType =
  | 'receipt'
  | 'payment'
  | 'expense'
  | 'owner_draw'
  | 'capital_in'
  | 'box_transfer'
  | 'bank_deposit'
  | 'bank_withdraw'
  | 'opening';

export interface CashTxInput {
  txType: CashTxType;
  cashboxId: number;
  /** صندوق الوجهة — إلزامي لـ box_transfer. */
  toCashboxId?: number | null;
  /** عملة الحركة = عملة الصندوق حصراً (يُتحقق منها). */
  currencyId: number;
  /** > 0 — الاتجاه من tx_type. */
  amount: string;
  /** للتحويل بين عملتين: المبلغ المستلم فعلاً بعملة الوجهة (اختياري — انظر الرأس). */
  toAmount?: string;
  /** افتراضي اليوم (YYYY-MM-DD). */
  txDate?: string;
  refType?: 'invoice' | 'installment' | 'on_account' | 'stocktake' | 'transfer' | null;
  refId?: number | null;
  /** إلزامي لـ expense. */
  expenseCategoryId?: number | null;
  customerId?: number | null;
  supplierId?: number | null;
  description?: string;
  /** تجاوز تحذير التأريخ الرجعي > 30 يوماً (قاعدة 5.4-11). */
  managerConfirmedBackdate?: boolean;
}

export interface CashTxResult {
  id: number;
  /** دائماً null وقت الإنشاء — الرقم يُستهلك عند أول طباعة (FR-04-10). */
  voucherNo: string | null;
  /** رصيد الصندوق بعد الحركة بعملته — لتحذير السالب في الواجهة (قرار 9). */
  newBalance: string;
}

export interface CashTxRow {
  id: number;
  txType: string;
  txDate: string;
  amount: string;
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
  cashboxId: number;
  cashboxName: string | null;
  toCashboxId: number | null;
  toCashboxName: string | null;
  customerId: number | null;
  customerName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  expenseCategoryId: number | null;
  expenseCategoryName: string | null;
  refType: string | null;
  refId: number | null;
  description: string | null;
  voucherNo: string | null;
  exchangeRate: string;
  settlementRate: string | null;
  fxGainLoss: string;
  isVoided: boolean;
  isReversal: boolean;
  /** فرق صرف ≠ 0 → شارة fx في القائمة. */
  hasFx: boolean;
  direction: 'in' | 'out' | 'transfer';
}

export interface CashboxBalanceRow {
  id: number;
  name: string;
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
  isDefault: boolean;
  /** الرصيد الحالي بعملة الصندوق — قد يكون سالباً (قرار 9). */
  balance: string;
}

export interface CashboxOptionRow {
  id: number;
  name: string;
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
  isDefault: boolean;
}

export interface ShiftSummary {
  cashboxId: number;
  openedAt: string;
  expectedIn: string;
  expectedOut: string;
  expected: string;
}

export interface ShiftRow {
  id: number;
  cashboxId: number;
  userId: number | null;
  openedAt: string;
  closedAt: string | null;
  openingCount: string | null;
  expected: string | null;
  counted: string | null;
  difference: string | null;
  notes: string | null;
}

export interface ExpenseCategoryRow {
  id: number;
  name: string;
}

/** شكل صف cash_tx كما يُقرأ في الإلغاء (أعمدة الساق). */
interface CashTxLegRow {
  id: number;
  tx_type: string;
  cashbox_id: number;
  to_cashbox_id: number | null;
  currency_id: number;
  amount: string | number;
  exchange_rate: string | number;
  tx_date: string;
  ref_type: string | null;
  ref_id: number | null;
  expense_category_id: number | null;
  customer_id: number | null;
  supplier_id: number | null;
  is_voided: number;
  reversal_of: number | null;
}

export interface OpenInvoiceRow {
  id: number;
  invoiceNo: string | null;
  issuedAt: string;
  total: string;
  /** المتبقي الفعلي بعد خصم التحصيلات (FIFO-aware). */
  due: string;
}

// ============ التحقق (zod) ============

const POS_MONEY_RE = /^\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TX_TYPES: [CashTxType, ...CashTxType[]] = [
  'receipt',
  'payment',
  'expense',
  'owner_draw',
  'capital_in',
  'box_transfer',
  'bank_deposit',
  'bank_withdraw',
  'opening',
];

const CashTxSchema = z.object({
  txType: z.enum(TX_TYPES),
  cashboxId: z.number().int().positive('رقم الصندوق غير صالح'),
  toCashboxId: z.number().int().positive('رقم صندوق الوجهة غير صالح').nullable().optional(),
  currencyId: z.number().int().positive('رقم العملة غير صالح'),
  amount: z
    .string()
    .regex(POS_MONEY_RE, 'المبلغ يجب أن يكون رقماً أكبر من صفر مثل «1500» أو «1500.50»')
    .refine((s) => dec(s).greaterThan(0), { message: 'المبلغ يجب أن يكون أكبر من صفر' }),
  toAmount: z
    .string()
    .regex(POS_MONEY_RE, 'المبلغ المستلم بعملة الوجهة يجب أن يكون رقماً أكبر من صفر')
    .optional(),
  txDate: z.string().regex(ISO_DATE_RE, 'تاريخ الحركة يجب أن يكون بصيغة YYYY-MM-DD').optional(),
  refType: z.enum(['invoice', 'installment', 'on_account', 'stocktake', 'transfer']).nullable().optional(),
  refId: z.number().int().positive('رقم المرجع غير صالح').nullable().optional(),
  expenseCategoryId: z.number().int().positive('رقم فئة المصروف غير صالح').nullable().optional(),
  customerId: z.number().int().positive('رقم العميل غير صالح').nullable().optional(),
  supplierId: z.number().int().positive('رقم المورّد غير صالح').nullable().optional(),
  description: z.string().trim().max(500, 'الوصف طويل (الحد 500 حرف)').optional(),
  managerConfirmedBackdate: z.boolean().optional(),
});

type CashTxParsed = z.output<typeof CashTxSchema>;

function parseOrThrow(input: CashTxInput): CashTxParsed {
  const parsed = CashTxSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error!.issues[0];
    throw new Error(
      `مدخلات حركة النقدية غير مكتملة: ${issue?.message ?? 'راجع الحقول'} (الحقل: ${issue?.path?.join('.') ?? '?'})`,
    );
  }
  return parsed.data;
}

// ============ التسلسل (نفس قرار invoicing: محرك sql.js والمعاملات المتوازية) ============

let writeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

// ============ الاتجاهات ============

const IN_TYPES = new Set(['receipt', 'capital_in', 'bank_deposit', 'opening']);
const OUT_TYPES = new Set(['payment', 'expense', 'owner_draw', 'bank_withdraw']);
/** أنواع مرجع مرتبطة بدورة حياة مستند آخر — إلغاؤها يتم من مستندها لا من هنا. */
const DOCUMENT_BOUND_REFS = new Set(['invoice', 'sale_return', 'purchase_return']);

/** سلب حركة → نوعها المعاكس (سجل معاكس فقط — مستبعد من كل الأرصدة، فالدلالة للقارئ). */
const REVERSAL_TYPE: Record<string, string> = {
  receipt: 'payment',
  payment: 'receipt',
  expense: 'receipt',
  owner_draw: 'capital_in',
  capital_in: 'owner_draw',
  bank_deposit: 'bank_withdraw',
  bank_withdraw: 'bank_deposit',
  opening: 'payment',
  box_transfer: 'box_transfer',
};

// ============ جمع دفتر صندوق (بعملته) ============

/**
 * Σ الوارد والصادر لصندوق بعملته خلال نافذة اختيارية — كل الجمع Decimal في JS
 * (SUM في SQLite يُرجع REAL وقد يفقد الدقة). المستبعد دائماً: is_voided=1
 * أو reversal_of NOT NULL (اصطلاح الإلغاء أعلاه).
 */
async function sumBoxFlows(
  db: DbEngine,
  cashboxId: number,
  filter: { dateFrom?: string; dateTo?: string } = {},
): Promise<{ in: Decimal; out: Decimal }> {
  const boxRows = await db.all<{ currency_id: number }>('SELECT currency_id FROM cashbox WHERE id = ?', [cashboxId]);
  if (boxRows.length === 0) {
    throw new Error(`صندوق غير موجود (رقم ${cashboxId}) — لا يمكن حساب رصيده`);
  }
  const currencyId = Number(boxRows[0].currency_id);

  const where: string[] = [
    't.is_voided = 0',
    't.reversal_of IS NULL',
    't.currency_id = ?',
    '(t.cashbox_id = ? OR (t.tx_type = \'box_transfer\' AND t.to_cashbox_id = ?))',
  ];
  const params: unknown[] = [currencyId, cashboxId, cashboxId];
  if (filter.dateFrom !== undefined) {
    where.push('t.tx_date >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo !== undefined) {
    where.push('t.tx_date <= ?');
    params.push(filter.dateTo);
  }

  const rows = await db.all<{ tx_type: string; cashbox_id: number; amount: string | number }>(
    `SELECT t.tx_type, t.cashbox_id, t.amount FROM cash_tx t WHERE ${where.join(' AND ')}`,
    params,
  );

  let inSum = dec(0);
  let outSum = dec(0);
  for (const r of rows) {
    const amount = dec(r.amount);
    if (r.tx_type === 'box_transfer') {
      // ساق صادرة (cashbox_id=هذا) أو واردة (to_cashbox_id=هذا) — بعملة هذا الصندوق حصراً
      if (Number(r.cashbox_id) === cashboxId) outSum = outSum.plus(amount);
      else inSum = inSum.plus(amount);
    } else if (IN_TYPES.has(r.tx_type)) {
      inSum = inSum.plus(amount);
    } else if (OUT_TYPES.has(r.tx_type)) {
      outSum = outSum.plus(amount);
    }
  }
  return { in: inSum, out: outSum };
}

// ============ رصيد الصناديق (FR-04-06/09) ============

/** أرصدة كل الصناديق الفاعلة بعملاتها — السالب مسموح ويعود كما هو (قرار 9). */
export async function cashboxBalances(): Promise<CashboxBalanceRow[]> {
  const db = await getDb();
  const boxes = await db.all<{
    id: number; name: string; currency_id: number; is_default: number; code: string; decimals: number;
  }>(
    'SELECT cb.id, cb.name, cb.currency_id, cb.is_default, c.code, c.decimals ' +
      'FROM cashbox cb JOIN currency c ON c.id = cb.currency_id WHERE cb.is_archived = 0 ' +
      'ORDER BY cb.is_default DESC, cb.name COLLATE NOCASE ASC',
  );
  const out: CashboxBalanceRow[] = [];
  for (const b of boxes) {
    const flows = await sumBoxFlows(db, Number(b.id), {});
    out.push({
      id: Number(b.id),
      name: b.name,
      currencyId: Number(b.currency_id),
      currencyCode: b.code,
      currencyDecimals: Number(b.decimals),
      isDefault: Number(b.is_default) === 1,
      balance: money(flows.in.minus(flows.out)),
    });
  }
  return out;
}

/** رصيد صندوق واحد بعملته (السالب مسموح — قرار 9). */
export async function cashboxBalance(cashboxId: number): Promise<string> {
  const db = await getDb();
  const flows = await sumBoxFlows(db, cashboxId, {});
  return money(flows.in.minus(flows.out));
}

/** الصناديق الفاعلة بعملاتها — لاختيار الصندوق في النماذج. */
export async function listCashboxOptions(): Promise<CashboxOptionRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string; currency_id: number; is_default: number; code: string; decimals: number }>(
    'SELECT cb.id, cb.name, cb.currency_id, cb.is_default, c.code, c.decimals ' +
      'FROM cashbox cb JOIN currency c ON c.id = cb.currency_id WHERE cb.is_archived = 0 ' +
      'ORDER BY cb.is_default DESC, cb.id ASC',
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    currencyId: Number(r.currency_id),
    currencyCode: r.code,
    currencyDecimals: Number(r.decimals),
    isDefault: Number(r.is_default) === 1,
  }));
}

// ============ المتبقي على فاتورة + FIFO (قاعدة 5.4-6) ============

/**
 * المتبقي على فاتورة = due_amount − Σ تخصيصات سنداتها التي تحمل الطرف
 * (customer_id لفواتير البيع / supplier_id لفواتير الشراء) وغير الملغاة.
 * سند لحظة البيع النقدي لا يحمل الطرف (قرار invoicing) فلا يُخصم مرتين.
 */
async function invoiceRemainingDue(
  db: DbEngine,
  invoiceId: number,
  partyCol: 'customer_id' | 'supplier_id',
): Promise<Decimal> {
  const inv = (await db.all<{ due_amount: string | number }>('SELECT due_amount FROM invoice WHERE id = ?', [invoiceId]))[0];
  if (inv === undefined) {
    throw new Error(`فاتورة غير موجودة (رقم ${invoiceId}) — ربما حُذف الرابط، أعد اختيار الفاتورة`);
  }
  const allocs = await db.all<{ a: string | number }>(
    `SELECT pa.allocated_amount AS a FROM payment_allocation pa JOIN cash_tx t ON t.id = pa.cash_tx_id ` +
      `WHERE pa.invoice_id = ? AND t.${partyCol} IS NOT NULL AND t.is_voided = 0`,
    [invoiceId],
  );
  let allocated = dec(0);
  for (const r of allocs) allocated = allocated.plus(dec(r.a));
  return dec(inv.due_amount).minus(allocated);
}

/**
 * تخصيص مبلغ قبض على الحساب FIFO: أقدم فواتير البيع المكتملة الآجلة ذات متبقٍ
 * للعميل ← payment_allocation حتى نفاد المبلغ. البقايا تبقى غير مخصصة = رصيد دائن.
 */
async function allocateReceiptFifo(
  db: DbEngine,
  cashTxId: number,
  customerId: number,
  amount: Decimal,
  now: string,
): Promise<void> {
  const existing = await db.all<{ a: string | number }>(
    'SELECT allocated_amount AS a FROM payment_allocation WHERE cash_tx_id = ?',
    [cashTxId],
  );
  let left = dec(amount);
  for (const r of existing) left = left.minus(dec(r.a));
  if (left.lessThanOrEqualTo(0)) return;

  const invoices = await db.all<{ id: number; due_amount: string | number }>(
    "SELECT id, due_amount FROM invoice WHERE customer_id = ? AND doc_type = 'sale' AND status = 'completed' " +
      "AND pay_status IN ('credit','mixed') AND due_amount > 0 ORDER BY issued_at ASC, id ASC",
    [customerId],
  );

  for (const inv of invoices) {
    if (left.lessThanOrEqualTo(0)) break;
    const remaining = (await invoiceRemainingDue(db, Number(inv.id), 'customer_id')).toDecimalPlaces(4);
    if (remaining.lessThanOrEqualTo(0)) continue;
    const alloc = Decimal.min(remaining, left.toDecimalPlaces(4));
    await db.run(
      'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
      [cashTxId, Number(inv.id), money(alloc), now, getCurrentUserId() ?? null],
    );
    left = left.minus(alloc);
  }
}

/** تخصيص سند قبض حر (on_account) على الأقدم — يُستدعى من الواجهة عند إعادة التخصيص. */
export async function allocateOnAccountReceipt(cashTxId: number): Promise<void> {
  const db = await getDb();
  await runSerialized(() =>
    db.transaction(async () => {
      const rows = await db.all<{
        id: number; tx_type: string; customer_id: number | null; ref_type: string | null; amount: string | number; is_voided: number;
      }>('SELECT id, tx_type, customer_id, ref_type, amount, is_voided FROM cash_tx WHERE id = ?', [cashTxId]);
      const t = rows[0];
      if (t === undefined) {
        throw new Error(`حركة نقدية غير موجودة (رقم ${cashTxId}) — لا يمكن تخصيصها`);
      }
      if (Number(t.is_voided) === 1) {
        throw new Error('هذه الحركة ملغاة — لا يمكن تخصيص قبض ملغى، أنشئ قبضاً جديداً');
      }
      if (t.tx_type !== 'receipt' || t.customer_id === null || t.ref_type !== 'on_account') {
        throw new Error('التخصيص FIFO متاح لسندات القبض الحرّة (على الحساب) المرتبطة بعميل فقط');
      }
      await allocateReceiptFifo(db, cashTxId, Number(t.customer_id), dec(t.amount), new Date().toISOString());
    }),
  );
}

/** فواتير العميل الآجلة المفتوحة (لخيار «على فاتورة محددة») بالمتبقي الفعلي. */
export async function customerOpenInvoices(customerId: number): Promise<OpenInvoiceRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; invoice_no: string | null; issued_at: string; due_amount: string | number; total: string | number }>(
    "SELECT id, invoice_no, issued_at, due_amount, total FROM invoice WHERE customer_id = ? AND doc_type = 'sale' " +
      "AND status = 'completed' AND pay_status IN ('credit','mixed') AND due_amount > 0 ORDER BY issued_at ASC, id ASC",
    [customerId],
  );
  const out: OpenInvoiceRow[] = [];
  for (const r of rows) {
    const due = (await invoiceRemainingDue(db, Number(r.id), 'customer_id')).toDecimalPlaces(4);
    if (due.greaterThan(0)) {
      out.push({
        id: Number(r.id),
        invoiceNo: r.invoice_no,
        issuedAt: r.issued_at,
        total: money(r.total),
        due: money(due),
      });
    }
  }
  return out;
}

// ============ إنشاء حركة (كل الكتابة داخل transaction واحدة) ============

export async function createCashTx(input: CashTxInput): Promise<CashTxResult> {
  const v = parseOrThrow(input);
  return runSerialized(() => persistCashTx(v));
}

async function persistCashTx(v: CashTxParsed): Promise<CashTxResult> {
  const db = await getDb();
  return db.transaction(async () => {
    const now = new Date().toISOString();
    const txDate = v.txDate ?? todayISO();

    // 1) الصندوق وعملته (+ الوجهة للتحويل)
    const boxRows = await db.all<{ id: number; name: string; currency_id: number; is_archived: number }>(
      'SELECT id, name, currency_id, is_archived FROM cashbox WHERE id = ?',
      [v.cashboxId],
    );
    const box = boxRows[0];
    if (box === undefined) {
      throw new Error(`صندوق غير موجود (رقم ${v.cashboxId}) — أعد اختيار الصندوق`);
    }
    if (Number(box.is_archived) === 1) {
      throw new Error(`الصندوق «${box.name}» مؤرشف — اختر صندوقاً فاعلاً`);
    }
    if (Number(box.currency_id) !== v.currencyId) {
      throw new Error(`عملة الحركة يجب أن تطابق عملة الصندوق «${box.name}» — الحركات تُسجَّل بعملة الصندوق حصراً`);
    }

    let destBox: { id: number; name: string; currency_id: number; is_archived: number; decimals: number } | null = null;
    if (v.txType === 'box_transfer') {
      if (v.toCashboxId === null || v.toCashboxId === undefined) {
        throw new Error('تحويل الصندوق يتطلب صندوق وجهة — اختر الصندوق الوجهة أولاً');
      }
      if (v.toCashboxId === v.cashboxId) {
        throw new Error('لا يمكن التحويل من الصندوق إلى نفسه — اختر صندوق وجهة مختلفاً');
      }
      const destRows = await db.all<{ id: number; name: string; currency_id: number; is_archived: number; decimals: number }>(
        'SELECT cb.id, cb.name, cb.currency_id, cb.is_archived, c.decimals FROM cashbox cb ' +
          'JOIN currency c ON c.id = cb.currency_id WHERE cb.id = ?',
        [v.toCashboxId],
      );
      destBox = destRows[0] ?? null;
      if (destBox === null) {
        throw new Error(`صندوق الوجهة غير موجود (رقم ${v.toCashboxId}) — أعد اختيار الصندوق الوجهة`);
      }
      if (Number(destBox.is_archived) === 1) {
        throw new Error(`صندوق الوجهة «${destBox.name}» مؤرشف — اختر صندوقاً فاعلاً`);
      }
    }

    // 2) الفترات والتأريخ (قاعدة 5.4-11)
    await assertPeriodOpen(txDate);
    await assertBackdateAllowed(txDate, { managerConfirmed: v.managerConfirmedBackdate === true });

    // 3) سعر الصرف لحظة الحركة (قرار 3: MissingRateError تمر كما هي قبل أي كتابة)
    const rateSrc = await getRateSnapshot(v.currencyId, txDate);
    const amount = dec(v.amount);

    // 4) قواعد الأطراف والمراجع حسب النوع
    let customerId = v.customerId ?? null;
    let supplierId = v.supplierId ?? null;
    let refType: string | null = v.refType ?? null;
    let refId = v.refId ?? null;
    const expenseCategoryId = v.expenseCategoryId ?? null;
    const description = v.description?.trim() || null;

    if (v.txType === 'expense') {
      if (expenseCategoryId === null) {
        throw new Error('المصروف يتطلب فئة مصروف — اختر الفئة من القائمة أو أنشئ فئة جديدة');
      }
      const catRows = await db.all<{ id: number; name: string; is_archived: number }>(
        'SELECT id, name, is_archived FROM expense_category WHERE id = ?',
        [expenseCategoryId],
      );
      const cat = catRows[0];
      if (cat === undefined) {
        throw new Error(`فئة مصروف غير موجودة (رقم ${expenseCategoryId}) — أعد اختيار الفئة`);
      }
      if (Number(cat.is_archived) === 1) {
        throw new Error(`فئة المصروف «${cat.name}» مؤرشفة — اختر فئة فاعلة`);
      }
    } else if (expenseCategoryId !== null) {
      throw new Error('فئة المصروف تُستخدم مع المصروفات فقط — أزل الفئة أو غيّر نوع الحركة إلى «مصروف»');
    }

    if (v.txType === 'receipt') {
      if (supplierId !== null) {
        throw new Error('سند القبض يخص تحصيلاً من عميل — أزل المورّد أو استخدم «صرف دفع لمورّد»');
      }
      if (customerId !== null) {
        const custRows = await db.all<{ id: number; name: string; is_archived: number }>(
          'SELECT id, name, is_archived FROM customer WHERE id = ?',
          [customerId],
        );
        const cust = custRows[0];
        if (cust === undefined) {
          throw new Error(`عميل غير موجود (رقم ${customerId}) — أعد اختيار العميل`);
        }
        if (Number(cust.is_archived) === 1) {
          throw new Error(`العميل «${cust.name}» مؤرشف — أعد تفعيله من شاشة الأطراف أولاً`);
        }
        if (refType === null || refType === undefined) refType = 'on_account'; // القبض الحر الافتراضي — FIFO
        if (refType !== 'on_account' && refType !== 'invoice') {
          throw new Error('مرجع القبض يجب أن يكون «فاتورة محددة» أو «على الحساب» — اختر أحد الخيارين');
        }
        if (refType === 'invoice') {
          if (refId === null || refId === undefined) {
            throw new Error('القبض على فاتورة محددة يتطلب اختيار الفاتورة من قائمة فواتير العميل الآجلة');
          }
          const invRows = await db.all<{
            id: number; invoice_no: string | null; doc_type: string; status: string; pay_status: string;
            currency_id: number; customer_id: number;
          }>('SELECT id, invoice_no, doc_type, status, pay_status, currency_id, customer_id FROM invoice WHERE id = ?', [refId]);
          const inv = invRows[0];
          if (
            inv === undefined ||
            inv.doc_type !== 'sale' ||
            inv.status !== 'completed' ||
            Number(inv.customer_id) !== customerId
          ) {
            throw new Error('الفاتورة المحددة ليست فاتورة بيع مكتملة لهذا العميل — أعد اختيار الفاتورة');
          }
          if (inv.pay_status === 'cash') {
            throw new Error('الفاتورة المحددة نقديّة مسددة بالكامل — لا يمكن تحصيلها مرتين');
          }
          if (Number(inv.currency_id) !== v.currencyId) {
            throw new Error('عملة الصندوق تختلف عن عملة الفاتورة — اختر صندوقاً بعملة الفاتورة نفسها');
          }
          const remaining = (await invoiceRemainingDue(db, refId, 'customer_id')).toDecimalPlaces(4);
          if (amount.greaterThan(remaining)) {
            throw new Error(
              `المبلغ يتجاوز المتبقي على الفاتورة (المتبقي ${money(remaining)}) — ` +
                'خفّض المبلغ أو استخدم «على الحساب» ليُخصم الفائض من الفواتير الأقدم أولاً',
            );
          }
        }
      } else if (refType === 'on_account' || refType === 'invoice') {
        throw new Error('القبض على الحساب أو على فاتورة محددة يتطلب اختيار العميل أولاً');
      }
    }

    if (v.txType === 'payment') {
      if (customerId !== null) {
        throw new Error('سند الصرف يخص دفعاً لمورّد — أزل العميل أو استخدم «قبض تحصيل من عميل»');
      }
      if (supplierId !== null) {
        const supRows = await db.all<{ id: number; name: string; is_archived: number }>(
          'SELECT id, name, is_archived FROM supplier WHERE id = ?',
          [supplierId],
        );
        const sup = supRows[0];
        if (sup === undefined) {
          throw new Error(`مورّد غير موجود (رقم ${supplierId}) — أعد اختيار المورّد`);
        }
        if (Number(sup.is_archived) === 1) {
          throw new Error(`المورّد «${sup.name}» مؤرشف — أعد تفعيله من شاشة الأطراف أولاً`);
        }
        if (refType === null || refType === undefined) refType = 'on_account';
        if (refType !== 'on_account' && refType !== 'invoice') {
          throw new Error('مرجع الصرف يجب أن يكون «فاتورة محددة» أو «على الحساب» — اختر أحد الخيارين');
        }
        if (refType === 'invoice') {
          if (refId === null || refId === undefined) {
            throw new Error('الدفع على فاتورة محددة يتطلب اختيار فاتورة الشراء من قائمة المورّد');
          }
          const invRows = await db.all<{
            id: number; doc_type: string; status: string; pay_status: string; currency_id: number; supplier_id: number;
          }>('SELECT id, doc_type, status, pay_status, currency_id, supplier_id FROM invoice WHERE id = ?', [refId]);
          const inv = invRows[0];
          if (
            inv === undefined ||
            inv.doc_type !== 'purchase' ||
            inv.status !== 'completed' ||
            Number(inv.supplier_id) !== supplierId
          ) {
            throw new Error('الفاتورة المحددة ليست فاتورة شراء مكتملة لهذا المورّد — أعد اختيار الفاتورة');
          }
          if (inv.pay_status === 'cash') {
            throw new Error('فاتورة الشراء المحددة نقديّة مسددة بالكامل — لا يمكن دفعها مرتين');
          }
          if (Number(inv.currency_id) !== v.currencyId) {
            throw new Error('عملة الصندوق تختلف عن عملة فاتورة الشراء — اختر صندوقاً بعملة الفاتورة نفسها');
          }
          const remaining = (await invoiceRemainingDue(db, refId, 'supplier_id')).toDecimalPlaces(4);
          if (amount.greaterThan(remaining)) {
            throw new Error(
              `المبلغ يتجاوز المتبقي على فاتورة الشراء (المتبقي ${money(remaining)}) — خفّض المبلغ أو ادفع الباقي على الحساب`,
            );
          }
        }
      } else if (refType === 'on_account' || refType === 'invoice') {
        throw new Error('الدفع على الحساب أو على فاتورة محددة يتطلب اختيار المورّد أولاً');
      }
    }

    if (v.txType === 'owner_draw' || v.txType === 'capital_in' || v.txType === 'bank_deposit' || v.txType === 'bank_withdraw' || v.txType === 'opening') {
      if (customerId !== null || supplierId !== null) {
        throw new Error('هذا النوع من الحركات لا يرتبط بعميل أو مورّد — أزل الطرف أو غيّر نوع الحركة');
      }
      customerId = null;
      supplierId = null;
      refType = null;
      refId = null;
    }

    // 5) حسابات التحويل بين عملتين (قرار 8 / FR-04-07)
    let toAmount: Decimal | null = null;
    let rateDst: string | null = null;
    let fx = dec(0);
    if (v.txType === 'box_transfer' && destBox !== null) {
      refType = 'transfer';
      refId = null; // يُربط بالساق الأولى بعد إدراجها (مفتاح الزوج)
      if (customerId !== null || supplierId !== null) {
        throw new Error('التحويل بين صندوقين لا يرتبط بأطراف — أزل العميل/المورّد');
      }
      const sameCurrency = Number(destBox.currency_id) === v.currencyId;
      rateDst = sameCurrency
        ? rateSrc.rate
        : (await getRateSnapshot(Number(destBox.currency_id), txDate)).rate;
      const amountBase = amount.times(dec(rateSrc.rate)); // قيمة المبلغ بالعملة الأساسية
      toAmount =
        v.toAmount !== undefined
          ? dec(v.toAmount)
          : roundTo(amountBase.div(dec(rateDst)), Number(destBox.decimals));
      if (toAmount.lessThanOrEqualTo(0)) {
        throw new Error('المبلغ المحوّل بعملة الوجهة يجب أن يكون أكبر من صفر — راجع سعر الصرف أو المبلغ المدخل');
      }
      // فرق الصرف المحقق (بقيمة الأساس): قيمة ما وصل − قيمة ما خرج (قرار 8)
      fx = roundTo(toAmount.times(dec(rateDst)).minus(amountBase), 4);
    }

    // 6) الإدراج
    const uid = getCurrentUserId() ?? null;
    const amountStr = money(amount);
    let sourceId: number;

    if (v.txType === 'box_transfer') {
      const destId = v.toCashboxId as number;
      // الساق الصادرة من المصدر بعملته
      const res = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, to_cashbox_id, currency_id, amount, exchange_rate, tx_date, ' +
          'ref_type, ref_id, customer_id, supplier_id, expense_category_id, description, created_at, created_by) ' +
          "VALUES('box_transfer', ?, ?, ?, ?, ?, ?, 'transfer', NULL, NULL, NULL, NULL, ?, ?, ?)",
        [v.cashboxId, destId, v.currencyId, amountStr, rateSrc.rate, txDate, description, now, uid],
      );
      sourceId = Number(res.lastInsertRowId);
      await db.run('UPDATE cash_tx SET ref_id = ? WHERE id = ?', [sourceId, sourceId]);

      if (toAmount !== null && rateDst !== null && Number(destBox!.currency_id) !== v.currencyId) {
        // الساق الواردة إلى الوجهة بعملتها + settlement_rate + fx_gain_loss (قرار 8)
        await db.run(
          'INSERT INTO cash_tx(tx_type, cashbox_id, to_cashbox_id, currency_id, amount, exchange_rate, settlement_rate, ' +
            'fx_gain_loss, tx_date, ref_type, ref_id, customer_id, supplier_id, description, created_at, created_by) ' +
          "VALUES('box_transfer', ?, ?, ?, ?, ?, ?, ?, ?, 'transfer', ?, NULL, NULL, ?, ?, ?)",
          [
            v.cashboxId,
            destId,
            Number(destBox!.currency_id),
            money(toAmount),
            rateDst,
            rateDst,
            money(fx),
            txDate,
            sourceId,
            description,
            now,
            uid,
          ],
        );
      }
    } else {
      const res = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, to_cashbox_id, currency_id, amount, exchange_rate, tx_date, ' +
          'ref_type, ref_id, expense_category_id, customer_id, supplier_id, description, created_at, created_by) ' +
          'VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          v.txType,
          v.cashboxId,
          v.currencyId,
          amountStr,
          rateSrc.rate,
          txDate,
          refType,
          refId,
          expenseCategoryId,
          customerId,
          supplierId,
          description,
          now,
          uid,
        ],
      );
      sourceId = Number(res.lastInsertRowId);
    }

    // 7) تخصيص FIFO للقبض الحر (نفس المعاملة — قاعدة 5.4-6)
    if (v.txType === 'receipt' && customerId !== null && refType === 'on_account') {
      await allocateReceiptFifo(db, sourceId, customerId, amount, now);
    }

    // 7-ب) القبض/الصرف على فاتورة محددة: تخصيص مباشر بنفس النمط الذي تتبعه
    // لحظة البيع (applyCashIn) — يربط السند بفاتورته لأعمار الديون والتقارير
    if ((v.txType === 'receipt' || v.txType === 'payment') && refType === 'invoice' && refId !== null) {
      await db.run(
        'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
        [sourceId, refId, amountStr, now, uid],
      );
    }

    // 8) الرصيد الجديد (قرار 9: بلا فحص — للتحذير في الواجهة)
    const flows = await sumBoxFlows(db, v.cashboxId, {});
    const newBalance = money(flows.in.minus(flows.out));

    // 9) تدقيق الحوافز (FR-12-04 يوصي بـ owner_draw تحديداً)
    if (v.txType === 'owner_draw') {
      await logAudit('owner_draw', {
        entity: 'cash_tx',
        entityId: sourceId,
        details: { amount: amountStr, cashboxId: v.cashboxId, description },
      });
    }

    return { id: sourceId, voucherNo: null, newBalance };
  });
}

// ============ الإلغاء — حركة معاكسة (FR-04-08) ============

export async function voidCashTx(id: number, opts: { managerConfirmed: boolean; reason?: string }): Promise<void> {
  if (opts.managerConfirmed !== true) {
    throw new Error('إلغاء حركة النقدية يتطلب صلاحية المدير — أكّد الإلغاء من نافذة التأكيد أولاً');
  }
  return runSerialized(() => voidCashTxCore(id, opts));
}

async function voidCashTxCore(id: number, opts: { managerConfirmed: boolean; reason?: string }): Promise<void> {
  const db = await getDb();
  await db.transaction(async () => {
    const rows = await db.all<CashTxLegRow>('SELECT * FROM cash_tx WHERE id = ?', [id]);
    const t = rows[0];
    if (t === undefined) {
      throw new Error(`حركة نقدية غير موجودة (رقم ${id}) — لا يمكن إلغاؤها`);
    }
    if (Number(t.is_voided) === 1) {
      throw new Error('هذه الحركة ملغاة مسبقاً — لا يمكن إلغاؤها مرتين');
    }
    if (t.reversal_of !== null) {
      throw new Error('هذه حركة معاكسة لإلغاء سابق — لا تُلغى، ألغِ الحركة الأصلية نفسها');
    }
    if (DOCUMENT_BOUND_REFS.has(String(t.ref_type))) {
      throw new Error(
        'هذه الحركة مرتبطة بمستند (فاتورة أو مرتجع) — إلغاؤها يتم من شاشة المستند نفسه ' +
          'ليُعكس كامل أثره (المخزون والصندوق والحسابات) معاً',
      );
    }

    // ساقا التحويل تُلغيان معاً ذرّياً (زوج ref_type='transfer' + ref_id واحد)
    const legs: CashTxLegRow[] =
      t.ref_type === 'transfer' && t.ref_id !== null
        ? await db.all<CashTxLegRow>(
            "SELECT * FROM cash_tx WHERE ref_type = 'transfer' AND ref_id = ? AND is_voided = 0",
            [Number(t.ref_id)],
          )
        : [t];

    const now = new Date().toISOString();
    const reversalIds: number[] = [];
    for (const leg of legs) {
      await db.run('UPDATE cash_tx SET is_voided = 1 WHERE id = ?', [Number(leg.id)]);
      const opposite = REVERSAL_TYPE[String(leg.tx_type)] ?? 'receipt';
      const swapBoxes = leg.tx_type === 'box_transfer';
      const res = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, to_cashbox_id, currency_id, amount, exchange_rate, tx_date, ' +
          'ref_type, ref_id, expense_category_id, customer_id, supplier_id, is_voided, reversal_of, description, created_at, created_by) ' +
          'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
        [
          opposite,
          swapBoxes ? Number(leg.to_cashbox_id ?? leg.cashbox_id) : Number(leg.cashbox_id),
          swapBoxes ? Number(leg.cashbox_id) : (leg.to_cashbox_id === null ? null : Number(leg.to_cashbox_id)),
          Number(leg.currency_id),
          money(leg.amount),
          money(leg.exchange_rate),
          todayISO(),
          leg.ref_type,
          leg.ref_id === null ? null : Number(leg.ref_id),
          leg.expense_category_id === null ? null : Number(leg.expense_category_id),
          leg.customer_id === null ? null : Number(leg.customer_id),
          leg.supplier_id === null ? null : Number(leg.supplier_id),
          Number(leg.id),
          `حركة معاكسة لإلغاء الحركة رقم ${Number(leg.id)}${opts.reason !== undefined && opts.reason.length > 0 ? ` — السبب: ${opts.reason}` : ''}`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      reversalIds.push(Number(res.lastInsertRowId));
    }

    await logAudit('void_cash_tx', {
      entity: 'cash_tx',
      entityId: Number(t.id),
      details: { reason: opts.reason ?? null, reversalIds, txType: String(t.tx_type) },
    });
  });
}

// ============ السند المرقّم (FR-04-10 — يُستهلك عند الطباعة الأولى فقط) ============

/**
 * استهلاك رقم سند RVT (قبض) / PMT (غير القبض) عبر doc_sequence — مرة واحدة.
 * الاستدعاء الثاني لنفس الحركة يعيد نفس الرقم دون استهلاك جديد (حارس idempotent).
 */
export async function consumeVoucherNo(cashTxId: number): Promise<string> {
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const rows = await db.all<{
        id: number; tx_type: string; tx_date: string; voucher_no: string | null; is_voided: number; reversal_of: number | null;
      }>('SELECT id, tx_type, tx_date, voucher_no, is_voided, reversal_of FROM cash_tx WHERE id = ?', [cashTxId]);
      const t = rows[0];
      if (t === undefined) {
        throw new Error(`حركة نقدية غير موجودة (رقم ${cashTxId}) — لا يمكن طباعة سندها`);
      }
      if (Number(t.is_voided) === 1) {
        throw new Error('لا يمكن طباعة سند لحركة ملغاة — الحركة ملغاة وأثرها معكوس');
      }
      if (t.reversal_of !== null) {
        throw new Error('لا يمكن طباعة سند لحركة معاكسة — اطبع سند الحركة الأصلية');
      }
      if (t.voucher_no !== null && t.voucher_no.length > 0) {
        return t.voucher_no; // استُهلك سابقاً — نفس الرقم دائماً
      }

      const docType = t.tx_type === 'receipt' ? ('RVT' as const) : ('PMT' as const);
      const { docNo } = await nextDocNumber(docType, { date: String(t.tx_date) });
      const res = await db.run('UPDATE cash_tx SET voucher_no = ? WHERE id = ? AND voucher_no IS NULL', [docNo, cashTxId]);
      if (res.changes === 0) {
        // سبق استهلاكه (تسابق نظري) — أعد قراءة الرقم القائم
        const again = await db.all<{ voucher_no: string | null }>('SELECT voucher_no FROM cash_tx WHERE id = ?', [cashTxId]);
        if (again[0]?.voucher_no !== null && again[0]?.voucher_no !== undefined) return again[0].voucher_no;
        throw new Error('تعذر ترقيم السند — أعد محاولة الطباعة');
      }
      await logAudit('voucher_print', {
        entity: 'cash_tx',
        entityId: cashTxId,
        details: { voucherNo: docNo, txType: String(t.tx_type) },
      });
      return docNo;
    });
  });
}

// ============ قائمة الحركات ============

export async function listCashTx(opts: {
  cashboxId?: number;
  dateFrom?: string;
  dateTo?: string;
  txType?: string;
  limit?: number;
}): Promise<CashTxRow[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.cashboxId !== undefined) {
    // «يلمس الصندوق»: صادرة منه أو واردة إليه (تحويل)
    where.push('(t.cashbox_id = ? OR (t.tx_type = \'box_transfer\' AND t.to_cashbox_id = ?))');
    params.push(opts.cashboxId, opts.cashboxId);
  }
  if (opts.dateFrom !== undefined) {
    where.push('t.tx_date >= ?');
    params.push(opts.dateFrom);
  }
  if (opts.dateTo !== undefined) {
    where.push('t.tx_date <= ?');
    params.push(opts.dateTo);
  }
  if (opts.txType !== undefined && opts.txType.length > 0) {
    where.push('t.tx_type = ?');
    params.push(opts.txType);
  }

  const rows = await db.all<{
    id: number; tx_type: string; tx_date: string; amount: string | number; currency_id: number;
    exchange_rate: string | number; settlement_rate: string | number | null; fx_gain_loss: string | number;
    voucher_no: string | null; ref_type: string | null; ref_id: number | null; is_voided: number;
    reversal_of: number | null; description: string | null; cashbox_id: number; cashbox_name: string | null;
    to_cashbox_id: number | null; to_cashbox_name: string | null; customer_id: number | null; customer_name: string | null;
    supplier_id: number | null; supplier_name: string | null; expense_category_id: number | null;
    expense_category_name: string | null; currency_code: string; currency_decimals: number;
  }>(
    `SELECT t.id, t.tx_type, t.tx_date, t.amount, t.currency_id, t.exchange_rate, t.settlement_rate, t.fx_gain_loss,
            t.voucher_no, t.ref_type, t.ref_id, t.is_voided, t.reversal_of, t.description,
            t.cashbox_id, cb.name AS cashbox_name, t.to_cashbox_id, tcb.name AS to_cashbox_name,
            t.customer_id, cu.name AS customer_name, t.supplier_id, su.name AS supplier_name,
            t.expense_category_id, ec.name AS expense_category_name,
            c.code AS currency_code, c.decimals AS currency_decimals
     FROM cash_tx t
     LEFT JOIN cashbox cb ON cb.id = t.cashbox_id
     LEFT JOIN cashbox tcb ON tcb.id = t.to_cashbox_id
     LEFT JOIN customer cu ON cu.id = t.customer_id
     LEFT JOIN supplier su ON su.id = t.supplier_id
     LEFT JOIN expense_category ec ON ec.id = t.expense_category_id
     LEFT JOIN currency c ON c.id = t.currency_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.tx_date DESC, t.id DESC
     LIMIT ?`,
    [...params, limit],
  );

  return rows.map((r) => {
    const fx = dec(r.fx_gain_loss);
    const direction: CashTxRow['direction'] =
      r.tx_type === 'box_transfer' ? 'transfer' : IN_TYPES.has(r.tx_type) ? 'in' : 'out';
    return {
      id: Number(r.id),
      txType: String(r.tx_type),
      txDate: String(r.tx_date),
      amount: money(r.amount),
      currencyId: Number(r.currency_id),
      currencyCode: r.currency_code ?? '',
      currencyDecimals: Number(r.currency_decimals ?? 2),
      cashboxId: Number(r.cashbox_id),
      cashboxName: r.cashbox_name,
      toCashboxId: r.to_cashbox_id === null ? null : Number(r.to_cashbox_id),
      toCashboxName: r.to_cashbox_name,
      customerId: r.customer_id === null ? null : Number(r.customer_id),
      customerName: r.customer_name,
      supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
      supplierName: r.supplier_name,
      expenseCategoryId: r.expense_category_id === null ? null : Number(r.expense_category_id),
      expenseCategoryName: r.expense_category_name,
      refType: r.ref_type,
      refId: r.ref_id === null ? null : Number(r.ref_id),
      description: r.description,
      voucherNo: r.voucher_no,
      exchangeRate: money(r.exchange_rate),
      settlementRate: r.settlement_rate === null || r.settlement_rate === undefined ? null : money(r.settlement_rate),
      fxGainLoss: money(fx),
      isVoided: Number(r.is_voided) === 1,
      isReversal: r.reversal_of !== null,
      hasFx: !fx.isZero(),
      direction,
    };
  });
}

// ============ الوردية (قرار 9 — المعادلة الشاملة FR-04-04) ============

function mapShiftRow(r: {
  id: number; cashbox_id: number; user_id: number | null; opened_at: string; closed_at: string | null;
  opening_count: string | number | null; expected: string | number | null; counted: string | number | null;
  difference: string | number | null; notes: string | null;
}): ShiftRow {
  return {
    id: Number(r.id),
    cashboxId: Number(r.cashbox_id),
    userId: r.user_id === null ? null : Number(r.user_id),
    openedAt: String(r.opened_at),
    closedAt: r.closed_at,
    openingCount: r.opening_count === null ? null : money(r.opening_count),
    expected: r.expected === null ? null : money(r.expected),
    counted: r.counted === null ? null : money(r.counted),
    difference: r.difference === null ? null : money(r.difference),
    notes: r.notes,
  };
}

/** فتح وردية على صندوق — يرفض إن كانت هناك وردية مفتوحة عليه. */
export async function openShift(cashboxId: number, openingCount: string): Promise<number> {
  if (!/^\d+(\.\d+)?$/.test(openingCount ?? '')) {
    throw new Error('رصيد العد الافتتاحي يجب أن يكون رقماً غير سالب مثل «15000»');
  }
  const db = await getDb();
  return runSerialized(() =>
    db.transaction(async () => {
      const boxRows = await db.all<{ id: number; name: string; is_archived: number }>(
        'SELECT id, name, is_archived FROM cashbox WHERE id = ?',
        [cashboxId],
      );
      const box = boxRows[0];
      if (box === undefined) {
        throw new Error(`صندوق غير موجود (رقم ${cashboxId}) — لا يمكن فتح وردية عليه`);
      }
      if (Number(box.is_archived) === 1) {
        throw new Error(`الصندوق «${box.name}» مؤرشف — لا يمكن فتح وردية عليه`);
      }
      const open = await db.all<{ id: number }>(
        'SELECT id FROM shift WHERE cashbox_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1',
        [cashboxId],
      );
      if (open.length > 0) {
        throw new Error('هناك وردية مفتوحة بالفعل على هذا الصندوق — أقفلها أولاً ثم افتح وردية جديدة');
      }
      const now = new Date().toISOString();
      const res = await db.run(
        'INSERT INTO shift(cashbox_id, user_id, opened_at, opening_count, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
        [cashboxId, getCurrentUserId(), now, money(dec(openingCount)), now, now],
      );
      const shiftId = Number(res.lastInsertRowId);
      await logAudit('shift_open', {
        entity: 'shift',
        entityId: shiftId,
        details: { cashboxId, openingCount: money(dec(openingCount)) },
      });
      return shiftId;
    }),
  );
}

/**
 * المعادلة الشاملة الحية (قرار 9): كل حركة غير ملغاة/غير معاكسة في نافذة الوردية
 * بعملة الصندوق: موجبة لـ (receipt/capital_in/bank_deposit/opening أو تحويل وارد إلى الصندوق)
 * وسالبة لـ (payment/expense/owner_draw/bank_withdraw أو تحويل صادر من الصندوق).
 * (دقة tx_date يومية — النافذة من تاريخ الفتح حتى اليوم.)
 */
export async function shiftExpected(cashboxId: number, openedAt: string): Promise<ShiftSummary> {
  const db = await getDb();
  const flows = await sumBoxFlows(db, cashboxId, { dateFrom: openedAt.slice(0, 10), dateTo: todayISO() });
  return {
    cashboxId,
    openedAt,
    expectedIn: money(flows.in),
    expectedOut: money(flows.out),
    expected: money(flows.in.minus(flows.out)),
  };
}

/**
 * ملخص وارد/صادر نافذة وردية بنطاق صريح (حتى تاريخ الإقفال) — لتقرير طباعة
 * الوردية بعد إقفالها (الوحدة 10): نفس معادلة القرار 9 لكن بنهاية النافذة
 * الأصلية لا «اليوم». يعيد عملة الصندوق أيضاً لتنسيق التقرير.
 */
export async function shiftWindowSummary(
  cashboxId: number,
  dateFrom: string,
  dateTo: string,
): Promise<{
  expectedIn: string;
  expectedOut: string;
  expected: string;
  currencyCode: string;
  currencyDecimals: number;
}> {
  const db = await getDb();
  const [flows, box] = await Promise.all([
    sumBoxFlows(db, cashboxId, { dateFrom, dateTo }),
    db.all<{ code: string; decimals: number }>(
      'SELECT c.code, c.decimals FROM cashbox b JOIN currency c ON c.id = b.currency_id WHERE b.id = ?',
      [cashboxId],
    ),
  ]);
  return {
    expectedIn: money(flows.in),
    expectedOut: money(flows.out),
    expected: money(flows.in.minus(flows.out)),
    currencyCode: box.length > 0 ? String(box[0].code) : '',
    currencyDecimals: box.length > 0 ? Number(box[0].decimals) : 2,
  };
}

/**
 * إقفال الوردية: يسجل المتوقع (وارد − صادر خلال النافذة) والعد الفعلي والفرق
 * (الفرق = العد الفعلي − [الرصيد الافتتاحي + المتوقع] — العد يشمل الدرج كاملاً)
 * + قيد تدقيق. يعيد { expected, difference }.
 */
export async function closeShift(shiftId: number, counted: string, notes?: string): Promise<{ expected: string; difference: string }> {
  if (!/^\d+(\.\d+)?$/.test(counted ?? '')) {
    throw new Error('العد الفعلي يجب أن يكون رقماً غير سالب مثل «14500»');
  }
  const db = await getDb();
  return runSerialized(() =>
    db.transaction(async () => {
      const rows = await db.all<{
        id: number; cashbox_id: number; opened_at: string; closed_at: string | null; opening_count: string | number | null;
      }>('SELECT id, cashbox_id, opened_at, closed_at, opening_count FROM shift WHERE id = ?', [shiftId]);
      const sh = rows[0];
      if (sh === undefined) {
        throw new Error(`وردية غير موجودة (رقم ${shiftId}) — لا يمكن إقفالها`);
      }
      if (sh.closed_at !== null) {
        throw new Error('هذه الوردية مقفلة مسبقاً — لا يمكن إقفالها مرتين');
      }

      const summary = await shiftExpected(Number(sh.cashbox_id), String(sh.opened_at));
      const countedD = dec(counted);
      const drawerExpected = dec(sh.opening_count ?? 0).plus(dec(summary.expected));
      const difference = roundTo(countedD.minus(drawerExpected), 4);

      const now = new Date().toISOString();
      await db.run(
        'UPDATE shift SET closed_at = ?, expected = ?, counted = ?, difference = ?, notes = ?, updated_at = ? WHERE id = ?',
        [now, summary.expected, money(countedD), money(difference), notes?.trim() || null, now, shiftId],
      );
      await logAudit('shift_close', {
        entity: 'shift',
        entityId: shiftId,
        details: {
          cashboxId: Number(sh.cashbox_id),
          expected: summary.expected,
          counted: money(countedD),
          difference: money(difference),
        },
      });
      return { expected: summary.expected, difference: money(difference) };
    }),
  );
}

/** الوردية المفتوحة حالياً على صندوق (أو null). */
export async function currentShift(cashboxId: number): Promise<ShiftRow | null> {
  const db = await getDb();
  const rows = await db.all<{
    id: number; cashbox_id: number; user_id: number | null; opened_at: string; closed_at: string | null;
    opening_count: string | number | null; expected: string | number | null; counted: string | number | null;
    difference: string | number | null; notes: string | null;
  }>('SELECT * FROM shift WHERE cashbox_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', [cashboxId]);
  return rows.length === 0 ? null : mapShiftRow(rows[0]);
}

/** آخر وردية على صندوق (مفتوحة أو مقفلة) — لعرض سجل الإقفال مباشرة بعد الإغلاق. */
export async function lastShift(cashboxId: number): Promise<ShiftRow | null> {
  const db = await getDb();
  const rows = await db.all<{
    id: number; cashbox_id: number; user_id: number | null; opened_at: string; closed_at: string | null;
    opening_count: string | number | null; expected: string | number | null; counted: string | number | null;
    difference: string | number | null; notes: string | null;
  }>('SELECT * FROM shift WHERE cashbox_id = ? ORDER BY id DESC LIMIT 1', [cashboxId]);
  return rows.length === 0 ? null : mapShiftRow(rows[0]);
}

// ============ فئات المصاريف (FR-04-05) ============

export async function listExpenseCategories(): Promise<ExpenseCategoryRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM expense_category WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC',
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

export async function upsertExpenseCategory(id: number | null, name: string): Promise<number> {
  const clean = (name ?? '').trim();
  if (clean.length === 0) {
    throw new Error('اسم فئة المصروف مطلوب — أدخل اسماً مثل «نظافة»');
  }
  if (clean.length > 60) {
    throw new Error('اسم فئة المصروف طويل (الحد 60 حرفاً)');
  }
  const db = await getDb();
  const dupRows = await db.all<{ id: number }>(
    'SELECT id FROM expense_category WHERE is_archived = 0 AND name = ? COLLATE NOCASE',
    [clean],
  );
  const dup = dupRows.find((r) => id === null || Number(r.id) !== id);
  if (dup !== undefined) {
    throw new Error(`فئة المصروف «${clean}» موجودة مسبقاً — استخدم الفئة القائمة`);
  }
  if (id === null) {
    const res = await db.run('INSERT INTO expense_category(name, is_archived, created_at, created_by) VALUES(?, 0, ?, ?)', [
      clean,
      new Date().toISOString(),
      getCurrentUserId() ?? null,
    ]);
    return Number(res.lastInsertRowId);
  }
  const exists = await db.all<{ id: number }>('SELECT id FROM expense_category WHERE id = ?', [id]);
  if (exists.length === 0) {
    throw new Error(`فئة مصروف غير موجودة (رقم ${id}) — لا يمكن تعديلها`);
  }
  await db.run('UPDATE expense_category SET name = ?, updated_at = ? WHERE id = ?', [
    clean,
    new Date().toISOString(),
    id,
  ]);
  return id;
}
