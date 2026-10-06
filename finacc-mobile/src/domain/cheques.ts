import { z } from 'zod';
import { getDb } from '@/db/client';
import type { DbEngine } from '@/db/types';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getRateSnapshot } from './currency';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * الشيكات (الوحدة 14 — تتبع مصغّر):
 *
 * ── المبدأ المحاسبي (FR-14-02) ────────────────────────────────────────────
 * الشيك قبل `cleared` ذمّة «شيكات تحت التحصيل» فقط: لا يمس الصندوق ولا يخصم
 * رصيد الطرف. عند `cleared` فقط تُنشأ حركة الصندوق (قبض للوارد/صرف للصادر)
 * بعملة الشيك وسعر يوم التحصيل + تُسوّى الديون (تخصيصاً على الفاتورة
 * المرجعية أو FIFO على الأقدم بعملة الشيك) + تُحتسب فروق الصرف المحققة.
 *
 * ── قرارات موثقة داخل هذا الملف ───────────────────────────────────────────
 * 1) ربط حركة التحصيل بالطرف: cash_tx يحمل customer_id/supplier_id وref_type
 *    ∈ ('invoice','on_account') — نفس مصفوفة معادلة رصيد الطرف (3-b) — فيخصم
 *    الرصيد تلقائياً بلا كود إضافي. الربط بالشيك محفوظ عبر cheque.cleared_cash_tx_id.
 * 2) الفرق على القسط... لا — فروق الصرف (FR-08-10): تُحتسب فقط عند اختلاف
 *    عملة الشيك عن عملة الفاتورة المسدّاة: fx = قيمة الشيك بالأساس بسعر اليوم −
 *    المخصص على الفاتورة × سعر الفاتورة الأصلي. لا تُدفن في أي رصيد (قرار 8).
 * 3) الارتداد (FR-14-04): لا عكس تسوية — التسوية لا تُنشأ إلا عند cleared
 *    والارتداد مسموح من pending/deposited فقط، فبقاء الدين هو «العودة» نفسها.
 *    رسم الارتداد مصروف نقدي اختياري بعملة الشيك وسعر اليوم + فئة إلزامية.
 * 4) التسلسل (runSerialized): نفس مبرر invoicing.ts — معاملات sql.js المتوازية
 *    تتحول لـ SAVEPOINTs متداخلة.
 */

// ============ الأنواع والعقود ============

export interface ChequeInput {
  direction: 'in' | 'out';
  partyType: 'customer' | 'supplier';
  partyId: number;
  chequeNo: string;
  bankName?: string;
  amount: string;
  currencyId: number;
  issueDate?: string;
  dueDate: string;
  refInvoiceId?: number | null;
  notes?: string;
}

export type ChequeStatus = 'pending' | 'deposited' | 'cleared' | 'bounced' | 'void';
export type ChequeDirection = 'in' | 'out';

export interface ChequeRow {
  id: number;
  direction: ChequeDirection;
  partyType: 'customer' | 'supplier';
  partyId: number;
  partyName: string;
  chequeNo: string;
  bankName: string | null;
  amount: string;
  currencyId: number;
  currencyCode: string;
  decimals: number;
  exchangeRate: string;
  issueDate: string;
  dueDate: string;
  status: ChequeStatus;
  refInvoiceId: number | null;
  refInvoiceNo: string | null;
  notes: string | null;
}

export interface ChequeFull extends ChequeRow {
  bouncedAt: string | null;
  bounceFee: string;
  clearedCashTxId: number | null;
  createdAt: string | null;
  /** حركة الصندوق المنشأة عند التحصيل (إن وُجدت). */
  clearedTx: {
    id: number;
    txType: string;
    amount: string;
    txDate: string;
    cashboxName: string | null;
    fxGainLoss: string;
    settlementRate: string | null;
  } | null;
  /** حركة مصروف رسم الارتداد (إن وُجدت). */
  bounceFeeTxId: number | null;
}

export interface ListChequesOpts {
  status?: string;
  direction?: string;
  limit?: number;
}

// ============ التحقق (zod) ============

const POS_MONEY_RE = /^\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ChequeSchema = z.object({
  direction: z.enum(['in', 'out']),
  partyType: z.enum(['customer', 'supplier']),
  partyId: z.number().int().positive('رقم الطرف غير صالح'),
  chequeNo: z.string().trim().min(1, 'رقم الشيك مطلوب').max(60, 'رقم الشيك طويل جداً (الحد 60 حرفاً)'),
  bankName: z.string().trim().max(120, 'اسم البنك طويل جداً').optional(),
  amount: z
    .string()
    .regex(POS_MONEY_RE, 'مبلغ الشيك يجب أن يكون رقماً أكبر من صفر')
    .refine((s) => dec(s).greaterThan(0), { message: 'مبلغ الشيك يجب أن يكون أكبر من صفر' }),
  currencyId: z.number().int().positive('عملة الشيك مطلوبة'),
  issueDate: z.string().regex(ISO_DATE_RE, 'تاريخ الإصدار يجب أن يكون بصيغة YYYY-MM-DD').optional(),
  dueDate: z.string().regex(ISO_DATE_RE, 'تاريخ الاستحقاق يجب أن يكون بصيغة YYYY-MM-DD'),
  refInvoiceId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(500, 'الملاحظات طويلة (الحد 500 حرف)').optional(),
});

// ============ التسلسل (قرار 4 أعلاه) ============

let writeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

// ============ مساعدات داخلية ============

interface InvoiceLite {
  id: number;
  invoiceNo: string | null;
  docType: string;
  payStatus: string;
  status: string;
  currencyId: number;
  exchangeRate: string;
  dueAmount: string;
  issuedAt: string;
}

/** المتاح للتحصيل على فاتورة = due_amount − التخصيصات غير الملغاة. */
async function invoiceOpenAmount(db: DbEngine, invoiceId: number): Promise<Decimal> {
  const rows = await db.all<{ due_amount: string | number }>('SELECT due_amount FROM invoice WHERE id = ?', [invoiceId]);
  const allocs = await db.all<{ a: string | number | null }>(
    'SELECT COALESCE(SUM(pa.allocated_amount), 0) AS a FROM payment_allocation pa ' +
      'JOIN cash_tx t ON t.id = pa.cash_tx_id AND t.is_voided = 0 ' +
      'WHERE pa.invoice_id = ?',
    [invoiceId],
  );
  return dec(rows[0]?.due_amount ?? 0).minus(dec(allocs[0]?.a ?? 0));
}

async function loadInvoice(db: DbEngine, invoiceId: number): Promise<InvoiceLite | null> {
  const rows = await db.all<{
    id: number; invoice_no: string | null; doc_type: string; pay_status: string; status: string;
    customer_id: number | null; supplier_id: number | null; currency_id: number;
    exchange_rate: string | number; due_amount: string | number; issued_at: string;
  }>('SELECT * FROM invoice WHERE id = ?', [invoiceId]);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    docType: r.doc_type,
    payStatus: r.pay_status,
    status: r.status,
    currencyId: Number(r.currency_id),
    exchangeRate: money(r.exchange_rate),
    dueAmount: money(r.due_amount),
    issuedAt: r.issued_at,
  };
}

/** التحقق من الفاتورة المرجعية: ملكية الطرف + النوع + مكتملة + آجلة + مفتوحة. */
async function assertRefInvoice(
  db: DbEngine,
  input: { refInvoiceId: number; partyId: number; partyType: string; direction: string },
  chequeAmount: Decimal,
  chequeCurrencyId: number,
  today: string,
): Promise<void> {
  const inv = await loadInvoice(db, input.refInvoiceId);
  if (inv === null) {
    throw new Error('الفاتورة المرجعية غير موجودة — راجع الرابط أو أعد اختيار الفاتورة');
  }
  const expectedType = input.direction === 'in' ? 'sale' : 'purchase';
  const partyCol = input.partyType === 'customer' ? 'customer_id' : 'supplier_id';
  const rows = await db.all<{ pid: number | null }>(`SELECT ${partyCol} AS pid FROM invoice WHERE id = ?`, [
    input.refInvoiceId,
  ]);
  if (inv.docType !== expectedType || Number(rows[0]?.pid ?? 0) !== input.partyId) {
    throw new Error('الفاتورة المرجعية لا تعود لهذا الطرف — اختر فاتورة من فواتير الطرف نفسه');
  }
  if (inv.status !== 'completed') {
    throw new Error('لا يمكن ربط الشيك إلا بفاتورة مكتملة — الفاتورة المرجعية مسودة أو ملغاة');
  }
  if (inv.payStatus === 'cash') {
    throw new Error('الفاتورة المرجعية نقدية مسددة أصلاً — لا حاجة لربط شيك بها');
  }
  const open = await invoiceOpenAmount(db, input.refInvoiceId);
  if (open.lessThanOrEqualTo(0)) {
    throw new Error('الفاتورة المرجعية مسددة بالكامل — لا يمكن ربط شيك بها');
  }
  // قيمة الشيك بعملة الفاتورة (بأسعار اليوم — سياسة Snapshot الحركة)
  let amountInInvoiceCurrency = chequeAmount;
  if (inv.currencyId !== chequeCurrencyId) {
    const chequeRate = dec((await getRateSnapshot(chequeCurrencyId, today)).rate);
    const invRate = dec((await getRateSnapshot(inv.currencyId, today)).rate);
    amountInInvoiceCurrency = chequeAmount.times(chequeRate).div(invRate);
  }
  if (amountInInvoiceCurrency.greaterThan(open)) {
    throw new Error(
      `مبلغ الشيك يتجاوز المتاح على الفاتورة (المتاح ${money(open)} بعملة الفاتورة) — ` +
        'خفّض المبلغ أو احذف الفاتورة المرجعية ليوزَّع الشيك FIFO على حساب الطرف',
    );
  }
}

// ============ الإنشاء (FR-14-01) ============

export async function createCheque(input: ChequeInput): Promise<number> {
  const v = ChequeSchema.parse({
    ...input,
    bankName: input.bankName?.trim() || undefined,
    refInvoiceId: input.refInvoiceId ?? null,
  });
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const today = todayISO();
      const now = new Date().toISOString();

      // وجود الطرف
      const table = v.partyType === 'customer' ? 'customer' : 'supplier';
      const party = await db.all<{ id: number; name: string }>(
        `SELECT id, name FROM ${table} WHERE id = ?`,
        [v.partyId],
      );
      if (party.length === 0) {
        throw new Error(
          v.partyType === 'customer'
            ? `عميل غير موجود (رقم ${v.partyId}) — أعد اختيار العميل`
            : `مورّد غير موجود (رقم ${v.partyId}) — أعد اختيار المورّد`,
        );
      }

      // سعر يوم التسجيل (العملة الأساسية سعرها 1 دائماً)
      const snapshot = await getRateSnapshot(v.currencyId, today);

      if (v.refInvoiceId !== null && v.refInvoiceId !== undefined) {
        await assertRefInvoice(
          db,
          { refInvoiceId: v.refInvoiceId, partyId: v.partyId, partyType: v.partyType, direction: v.direction },
          dec(v.amount),
          v.currencyId,
          today,
        );
      }

      const res = await db.run(
        'INSERT INTO cheque(direction, party_type, party_id, cheque_no, bank_name, amount, currency_id, ' +
          'exchange_rate, issue_date, due_date, status, ref_invoice_id, notes, created_at, updated_at, created_by) ' +
          "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
        [
          v.direction,
          v.partyType,
          v.partyId,
          v.chequeNo,
          v.bankName ?? null,
          money(dec(v.amount)),
          v.currencyId,
          snapshot.rate,
          v.issueDate ?? today,
          v.dueDate,
          v.refInvoiceId ?? null,
          v.notes ?? null,
          now,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      const id = Number(res.lastInsertRowId);
      await logAudit('cheque_created', {
        entity: 'cheque',
        entityId: id,
        details: {
          direction: v.direction,
          partyType: v.partyType,
          partyId: v.partyId,
          chequeNo: v.chequeNo,
          amount: money(dec(v.amount)),
          currencyId: v.currencyId,
          rate: snapshot.rate,
          dueDate: v.dueDate,
          refInvoiceId: v.refInvoiceId ?? null,
        },
      });
      return id;
    });
  });
}

// ============ القوائم والقراءة ============

function mapChequeRow(r: Record<string, unknown>): ChequeRow {
  return {
    id: Number(r.id),
    direction: (r.direction as ChequeDirection) ?? 'in',
    partyType: (r.party_type as 'customer' | 'supplier') ?? 'customer',
    partyId: Number(r.party_id),
    partyName: String(r.party_name ?? ''),
    chequeNo: String(r.cheque_no ?? ''),
    bankName: (r.bank_name as string | null) ?? null,
    amount: money(r.amount as string | number),
    currencyId: Number(r.currency_id),
    currencyCode: String(r.currency_code ?? ''),
    decimals: Number(r.currency_decimals ?? 2),
    exchangeRate: money(r.exchange_rate as string | number),
    issueDate: String(r.issue_date ?? ''),
    dueDate: String(r.due_date ?? ''),
    status: (r.status as ChequeStatus) ?? 'pending',
    refInvoiceId: r.ref_invoice_id === null || r.ref_invoice_id === undefined ? null : Number(r.ref_invoice_id),
    refInvoiceNo: (r.invoice_no as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

const CHEQUE_LIST_SQL =
  'SELECT c.*, cur.code AS currency_code, cur.decimals AS currency_decimals, ' +
  'CASE WHEN c.party_type = \'customer\' THEN cu.name ELSE su.name END AS party_name, ' +
  'inv.invoice_no AS invoice_no ' +
  'FROM cheque c ' +
  'JOIN currency cur ON cur.id = c.currency_id ' +
  "LEFT JOIN customer cu ON c.party_type = 'customer' AND cu.id = c.party_id " +
  "LEFT JOIN supplier su ON c.party_type = 'supplier' AND su.id = c.party_id " +
  'LEFT JOIN invoice inv ON inv.id = c.ref_invoice_id ';

export async function listCheques(opts?: ListChequesOpts): Promise<ChequeRow[]> {
  const db = await getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status !== undefined && opts.status.length > 0 && opts.status !== 'all') {
    conds.push('c.status = ?');
    params.push(opts.status);
  }
  if (opts?.direction !== undefined && opts.direction.length > 0) {
    conds.push('c.direction = ?');
    params.push(opts.direction);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 200));
  const rows = await db.all<Record<string, unknown>>(
    `${CHEQUE_LIST_SQL} ${where} ORDER BY c.due_date ASC, c.id ASC LIMIT ?`,
    [...params, limit],
  );
  return rows.map(mapChequeRow);
}

export async function getCheque(id: number): Promise<ChequeFull | null> {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(`${CHEQUE_LIST_SQL} WHERE c.id = ?`, [id]);
  const r = rows[0];
  if (r === undefined) return null;
  const base = mapChequeRow(r);

  let clearedTx: ChequeFull['clearedTx'] = null;
  if (base.status === 'cleared' && r.cleared_cash_tx_id !== null && r.cleared_cash_tx_id !== undefined) {
    const tx = await db.all<{
      id: number; tx_type: string; amount: string | number; tx_date: string; fx_gain_loss: string | number;
      settlement_rate: string | number | null; cashbox_name: string | null;
    }>(
      'SELECT t.id, t.tx_type, t.amount, t.tx_date, t.fx_gain_loss, t.settlement_rate, cb.name AS cashbox_name ' +
        'FROM cash_tx t LEFT JOIN cashbox cb ON cb.id = t.cashbox_id WHERE t.id = ?',
      [Number(r.cleared_cash_tx_id)],
    );
    if (tx.length > 0) {
      clearedTx = {
        id: Number(tx[0].id),
        txType: tx[0].tx_type,
        amount: money(tx[0].amount),
        txDate: tx[0].tx_date,
        cashboxName: (tx[0].cashbox_name as string | null) ?? null,
        fxGainLoss: money(tx[0].fx_gain_loss),
        settlementRate:
          tx[0].settlement_rate === null || tx[0].settlement_rate === undefined
            ? null
            : money(tx[0].settlement_rate),
      };
    }
  }

  const fee = await db.all<{ id: number }>(
    "SELECT id FROM cash_tx WHERE ref_type = 'cheque' AND ref_id = ? AND tx_type = 'expense' AND is_voided = 0",
    [id],
  );

  return {
    ...base,
    bouncedAt: (r.bounced_at as string | null) ?? null,
    bounceFee: money((r.bounce_fee as string | number | null) ?? 0),
    clearedCashTxId:
      r.cleared_cash_tx_id === null || r.cleared_cash_tx_id === undefined ? null : Number(r.cleared_cash_tx_id),
    createdAt: (r.created_at as string | null) ?? null,
    clearedTx,
    bounceFeeTxId: fee[0] !== undefined ? Number(fee[0].id) : null,
  };
}

// ============ دورة الحياة (FR-14-02..06) ============

interface ChequeCore {
  id: number;
  direction: string;
  partyType: string;
  partyId: number;
  chequeNo: string;
  amount: string;
  currencyId: number;
  exchangeRate: string;
  status: string;
  refInvoiceId: number | null;
}

async function loadCheque(db: DbEngine, id: number): Promise<ChequeCore> {
  const rows = await db.all<{
    id: number; direction: string; party_type: string; party_id: number; cheque_no: string;
    amount: string | number; currency_id: number; exchange_rate: string | number; status: string;
    ref_invoice_id: number | null;
  }>('SELECT id, direction, party_type, party_id, cheque_no, amount, currency_id, exchange_rate, status, ref_invoice_id FROM cheque WHERE id = ?', [id]);
  const r = rows[0];
  if (r === undefined) {
    throw new Error(`شيك غير موجود (رقم ${id}) — ربما حُذف الرابط، عد لقائمة الشيكات`);
  }
  return {
    id: Number(r.id),
    direction: r.direction,
    partyType: r.party_type,
    partyId: Number(r.party_id),
    chequeNo: r.cheque_no,
    amount: money(r.amount),
    currencyId: Number(r.currency_id),
    exchangeRate: money(r.exchange_rate),
    status: r.status,
    refInvoiceId: r.ref_invoice_id === null ? null : Number(r.ref_invoice_id),
  };
}

function assertStatus(c: ChequeCore, allowed: string[], action: string): void {
  if (!allowed.includes(c.status)) {
    throw new Error(
      `لا يمكن ${action} شيك حالته «${c.status}» — الإجراء متاح للشيكات قيد التحصيل/المودَعة فقط`,
    );
  }
}

/** pending → deposited (إيداع بالبنك — بلا أي أثر مالي). */
export async function markDeposited(id: number): Promise<void> {
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const c = await loadCheque(db, id);
      assertStatus(c, ['pending'], 'إيداع');
      await db.run("UPDATE cheque SET status = 'deposited', updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
      await logAudit('cheque_deposited', { entity: 'cheque', entityId: id, details: { chequeNo: c.chequeNo } });
    });
  });
}

export interface MarkClearedOpts {
  cashboxId: number;
}

/**
 * cleared (FR-14-03): سند قبض/صرف بعملة الشيك وسعر اليوم + تسوية الدين
 * (تخصيص على الفاتورة المرجعية أو FIFO) + فروق الصرف + قيد تدقيق.
 */
export async function markCleared(id: number, opts?: MarkClearedOpts): Promise<{ cashTxId: number }> {
  if (opts === undefined || !Number.isFinite(opts.cashboxId) || opts.cashboxId <= 0) {
    throw new Error('التحصيل يتطلب اختيار صندوق — اختر الصندوق الذي ستُحصَّل فيه قيمة الشيك');
  }
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const today = todayISO();
      const now = new Date().toISOString();
      const c = await loadCheque(db, id);
      assertStatus(c, ['pending', 'deposited'], 'تحصيل');

      const box = await db.all<{ id: number; name: string }>('SELECT id, name FROM cashbox WHERE id = ?', [
        opts.cashboxId,
      ]);
      if (box.length === 0) {
        throw new Error('الصندوق المختار غير موجود — أعد اختيار الصندوق وحاول مجدداً');
      }

      const amount = dec(c.amount);
      const isCustomer = c.partyType === 'customer';
      const txType = c.direction === 'in' ? 'receipt' : 'payment';
      const desc =
        c.direction === 'in'
          ? `تحصيل شيك رقم ${c.chequeNo}${box[0].name !== undefined ? ` — ${box[0].name}` : ''}`
          : `سداد شيك رقم ${c.chequeNo}${box[0].name !== undefined ? ` — ${box[0].name}` : ''}`;

      // سعر يوم التحصيل (سياسة Snapshot)
      const txRateSnap = await getRateSnapshot(c.currencyId, today);
      const txRate = dec(txRateSnap.rate);

      // ── أهداف التسوية ──
      // 1) فاتورة مرجعية (قد تكون بعملة مختلفة → تحويل + فرق صرف)
      // 2) وإلا FIFO على فواتير الطرف الآجلة المفتوحة بعملة الشيك
      type Target = { invoiceId: number; invoiceRate: Decimal; invoiceCurrencyId: number; invoiceDecimals: number; open: Decimal };
      const targets: Target[] = [];
      let settlementRate: string | null = null;
      let fxGainLoss = dec(0);

      const currencyRow = await db.all<{ decimals: number }>('SELECT decimals FROM currency WHERE id = ?', [
        c.currencyId,
      ]);
      const txDecimals = Number(currencyRow[0]?.decimals ?? 2);

      if (c.refInvoiceId !== null) {
        const inv = await loadInvoice(db, c.refInvoiceId);
        if (inv === null) throw new Error('الفاتورة المرجعية غير موجودة — احذف المرجعية أو راجع البيانات');
        const open = await invoiceOpenAmount(db, c.refInvoiceId);
        if (open.greaterThan(0)) {
          if (inv.currencyId === c.currencyId) {
            targets.push({
              invoiceId: inv.id,
              invoiceRate: dec(inv.exchangeRate),
              invoiceCurrencyId: inv.currencyId,
              invoiceDecimals: await invoiceDecimals(db, inv.currencyId),
              open,
            });
          } else {
            // عملة مختلفة: التخصيص بعملة الفاتورة بسعر اليوم + فرق الصرف المحقق
            const invRateSnap = await getRateSnapshot(inv.currencyId, today);
            const invRate = dec(invRateSnap.rate);
            const convRate = txRate.div(invRate); // وحدة عملة الفاتورة لكل وحدة شيك
            const allocInv = Decimal.min(open, roundTo(amount.times(convRate), 4));
            settlementRate = money(roundTo(convRate, 6));
            targets.push({
              invoiceId: inv.id,
              invoiceRate: dec(inv.exchangeRate),
              invoiceCurrencyId: inv.currencyId,
              invoiceDecimals: await invoiceDecimals(db, inv.currencyId),
              open: allocInv,
            });
            // FR-08-10: القيمة بالأساس اليوم − الدين المُسدّى بسعره الأصلي
            fxGainLoss = amount.times(txRate).minus(allocInv.times(dec(inv.exchangeRate)));
          }
        }
      } else {
        // FIFO على فواتير الطرف المفتوحة بعملة الشيك (قرار 8: لا خلط عملات)
        const partyCol = isCustomer ? 'customer_id' : 'supplier_id';
        const docType = isCustomer ? 'sale' : 'purchase';
        const openInvoices = await db.all<{ id: number; currency_id: number; exchange_rate: string | number }>(
          `SELECT id, currency_id, exchange_rate FROM invoice
           WHERE ${partyCol} = ? AND doc_type = ? AND status = 'completed'
             AND pay_status IN ('credit', 'mixed') AND currency_id = ?
           ORDER BY issued_at ASC, id ASC`,
          [c.partyId, docType, c.currencyId],
        );
        for (const inv of openInvoices) {
          const open = await invoiceOpenAmount(db, Number(inv.id));
          if (open.greaterThan(0)) {
            targets.push({
              invoiceId: Number(inv.id),
              invoiceRate: dec(inv.exchange_rate),
              invoiceCurrencyId: Number(inv.currency_id),
              invoiceDecimals: txDecimals,
              open,
            });
          }
        }
      }

      // ── حركة الصندوق (بعملة الشيك وسعر اليوم) ──
      const txRes = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, settlement_rate, ' +
          'fx_gain_loss, tx_date, ref_type, ref_id, customer_id, supplier_id, is_voided, description, created_at, created_by) ' +
          'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
        [
          txType,
          opts.cashboxId,
          c.currencyId,
          money(amount),
          money(txRate),
          settlementRate,
          money(roundTo(fxGainLoss, 4)),
          today,
          c.refInvoiceId !== null ? 'invoice' : 'on_account',
          c.refInvoiceId,
          isCustomer ? c.partyId : null,
          isCustomer ? null : c.partyId,
          desc,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      const cashTxId = Number(txRes.lastInsertRowId);

      // ── التخصيص على الفواتير (بعملة كل فاتورة) ──
      let remaining = amount;
      const allocations: Array<{ invoiceId: number; amount: string }> = [];
      for (const t of targets) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const sameCurrency = t.invoiceCurrencyId === c.currencyId;
        const alloc = sameCurrency ? Decimal.min(remaining, t.open) : t.open;
        if (alloc.lessThanOrEqualTo(0)) continue;
        const allocRounded = roundTo(alloc, t.invoiceDecimals);
        if (allocRounded.lessThanOrEqualTo(0)) continue;
        await db.run(
          'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
          [cashTxId, t.invoiceId, money(allocRounded), now, getCurrentUserId() ?? null],
        );
        if (sameCurrency) remaining = remaining.minus(allocRounded);
        else remaining = dec(0); // التحويل عبر العملات يستهلك الشيك كله في المسار المرجعي
        allocations.push({ invoiceId: t.invoiceId, amount: money(allocRounded) });
      }

      await db.run("UPDATE cheque SET status = 'cleared', cleared_cash_tx_id = ?, updated_at = ? WHERE id = ?", [
        cashTxId,
        now,
        id,
      ]);
      await logAudit('cheque_cleared', {
        entity: 'cheque',
        entityId: id,
        details: {
          chequeNo: c.chequeNo,
          amount: money(amount),
          currencyId: c.currencyId,
          cashTxId,
          allocations,
          fxGainLoss: money(roundTo(fxGainLoss, 4)),
        },
      });
      return { cashTxId };
    });
  });
}

async function invoiceDecimals(db: DbEngine, currencyId: number): Promise<number> {
  const rows = await db.all<{ decimals: number }>('SELECT decimals FROM currency WHERE id = ?', [currencyId]);
  return Number(rows[0]?.decimals ?? 2);
}

export interface MarkBouncedOpts {
  bounceFee?: string;
  expenseCategoryId?: number;
  /** مطلوب عند وجود رسم ارتداد (المصروف يخرج من صندوق). */
  cashboxId?: number;
}

/**
 * bounced (FR-14-04): الدين يعود بقائه (لم يُخصم شيئ قبل التحصيل) +
 * مصروف رسم ارتداد اختياري + قيد تدقيق. مسموح من pending/deposited فقط.
 */
export async function markBounced(id: number, opts?: MarkBouncedOpts): Promise<void> {
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const now = new Date().toISOString();
      const c = await loadCheque(db, id);
      assertStatus(c, ['pending', 'deposited'], 'تسجيل ارتداد');

      const fee = dec(opts?.bounceFee ?? '0');
      let feeTxId: number | null = null;
      if (fee.greaterThan(0)) {
        if (opts?.cashboxId === undefined || !Number.isFinite(opts.cashboxId)) {
          throw new Error('رسم الارتداد يتطلب اختيار صندوق يُخصم منه — اختر الصندوق أو اترك الرسم صفراً');
        }
        if (opts.expenseCategoryId === undefined || !Number.isFinite(opts.expenseCategoryId)) {
          throw new Error('رسم الارتداد يتطلب فئة مصروف — اختر الفئة من قائمة الفئات');
        }
        const box = await db.all<{ id: number }>('SELECT id FROM cashbox WHERE id = ?', [opts.cashboxId]);
        if (box.length === 0) {
          throw new Error('الصندوق المختار غير موجود — أعد اختيار الصندوق وحاول مجدداً');
        }
        const cat = await db.all<{ id: number }>('SELECT id FROM expense_category WHERE id = ?', [
          opts.expenseCategoryId,
        ]);
        if (cat.length === 0) {
          throw new Error('فئة المصروف غير موجودة — أعد اختيار الفئة');
        }
        const rateSnap = await getRateSnapshot(c.currencyId, todayISO());
        const res = await db.run(
          'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
            'expense_category_id, is_voided, description, created_at, created_by) ' +
            "VALUES('expense', ?, ?, ?, ?, ?, 'cheque', ?, ?, 0, ?, ?, ?)",
          [
            opts.cashboxId,
            c.currencyId,
            money(fee),
            rateSnap.rate,
            todayISO(),
            id,
            opts.expenseCategoryId,
            `رسم ارتداد شيك رقم ${c.chequeNo}`,
            now,
            getCurrentUserId() ?? null,
          ],
        );
        feeTxId = Number(res.lastInsertRowId);
      }

      await db.run('UPDATE cheque SET status = ?, bounced_at = ?, bounce_fee = ?, updated_at = ? WHERE id = ?', [
        'bounced',
        now,
        money(fee),
        now,
        id,
      ]);
      await logAudit('cheque_bounced', {
        entity: 'cheque',
        entityId: id,
        details: {
          chequeNo: c.chequeNo,
          amount: c.amount,
          bounceFee: money(fee),
          feeTxId,
        },
      });
    });
  });
}

/** void (FR-14-06): مدير فقط + قيد تدقيق (لا حذف فيزيائي). */
export async function voidCheque(id: number, opts: { managerConfirmed: boolean }): Promise<void> {
  if (opts.managerConfirmed !== true) {
    throw new Error('إلغاء الشيك يتطلب تأكيد المدير — فعّل تأكيد المدير ثم أعد المحاولة');
  }
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const c = await loadCheque(db, id);
      assertStatus(c, ['pending', 'deposited'], 'إلغاء');
      await db.run("UPDATE cheque SET status = 'void', updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
      await logAudit('cheque_void', {
        entity: 'cheque',
        entityId: id,
        details: { chequeNo: c.chequeNo, amount: c.amount },
      });
    });
  });
}

/** الشيكات المستحقة خلال N يوماً (للداشبورد — تتضمن المتأخر ما زال معلقاً). */
export async function dueSoonCheques(days: number): Promise<ChequeRow[]> {
  const db = await getDb();
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, days));
  const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rows = await db.all<Record<string, unknown>>(
    `${CHEQUE_LIST_SQL} WHERE c.status IN ('pending', 'deposited') AND c.due_date <= ? ORDER BY c.due_date ASC, c.id ASC LIMIT 100`,
    [until],
  );
  return rows.map(mapChequeRow);
}
