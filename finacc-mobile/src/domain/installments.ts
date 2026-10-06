import { z } from 'zod';
import { getDb } from '@/db/client';
import type { DbEngine } from '@/db/types';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getRateSnapshot } from './currency';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * التقسيط (الوحدة 05 — نطاق مخفّض):
 *
 * ── القواعد الملزمة ────────────────────────────────────────────────────────
 * FR-05-01: خطة من فاتورة **بيع آجلة مكتملة** فقط («المبلغ المخصص» بلا فاتورة
 *   ممنوع في V1). المبلغ القابل للتقسيط = المتاح على الفاتورة (due − التخصيصات).
 *   الدفعة الأولى سند قبض مرتبط (down_payment_cash_tx_id) + تخصيص على الفاتورة.
 * قاعدة 5.4-9 (التقريب): أقساط متساوية مقربة لمنازل عملة الخطة (HALF_UP)
 *   **والفرق على القسط الأخير** — مجموع الجدول = القابل للتقسيط بالضبط.
 * FR-05-02: التحصيل سند قبض بعملة الخطة (ref_type='installment' مربوط بالخطة)
 *   + تخصيص على الفاتورة الأصل → يخصم رصيد العميل بمعادلة الأطراف تلقائياً.
 * FR-05-04: إعادة الجدولة = تعديل تاريخ القسط + قيد audit فقط (بلا إعادة توزيع).
 *   «متأخر» حالة عرض مشتقة من التاريخ (لا تُخزن — لا إزاحة تلقائية).
 *
 * ── قرارات موثقة داخل هذا الملف ───────────────────────────────────────────
 * 1) إلغاء الخطة يبقي الأقساط المسددة كما هي؛ والأقساط المتبقية تُستبعد من
 *    «المستحق» عبر حالة الخطة (قيد CHECK على installment لا يسمح بحالة ملغاة).
 * 2) cash_tx للقسط يربط ref_id=plan_id — عدة سندات لقسط جزئي واحد تُفصَّل
 *    عبر payment_allocation على الفاتورة الأصل؛ عمود cash_tx_id يُخزَّن آخر
 *    سند أكمل القسط (الكامل فقط).
 * 3) التسلسل (runSerialized): نفس مبرر invoicing.ts (SAVEPOINTs المتداخلة).
 */

// ============ الأنواع والعقود ============

export interface CreatePlanInput {
  invoiceId: number;
  months: number;
  downPayment?: string;
  firstDue: string;
  cycle?: 'monthly' | 'weekly';
  /** مطلوب عند وجود دفعة أولى (سند القبض يخرج من صندوق). */
  cashboxId?: number;
}

export type PlanStatus = 'active' | 'completed' | 'defaulted' | 'cancelled';
export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'late';

export interface PlanRow {
  id: number;
  customerId: number;
  customerName: string;
  invoiceId: number;
  invoiceNo: string | null;
  currencyId: number;
  currencyCode: string;
  decimals: number;
  principal: string;
  downPayment: string;
  /** سند قبض الدفعة الأولى (إن وُجد). */
  downPaymentCashTxId: number | null;
  /** Σ أقساط مسددة (بدون الدفعة الأولى). */
  totalPaid: string;
  /** إجمالي الخطة = الدفعة الأولى + أصل الأقساط. */
  totalAmount: string;
  /** المحصّل حتى الآن (دفعة أولى + أقساط مسددة). */
  paid: string;
  /** المتبقي من أصل الأقساط. */
  remaining: string;
  months: number;
  cycle: 'monthly' | 'weekly';
  firstDue: string;
  status: PlanStatus;
  /** أول استحقاق غير مسدد (إن وُجد). */
  nextDue: string | null;
  remainingCount: number;
}

export interface InstallmentRow {
  id: number;
  planId: number;
  seq: number;
  dueDate: string;
  amount: string;
  paidAmount: string;
  status: InstallmentStatus;
  paidAt: string | null;
  cashTxId: number | null;
}

export interface PlanFull {
  plan: Omit<PlanRow, 'remainingCount'>;
  installments: InstallmentRow[];
  customerPhone: string | null;
  customerWhatsapp: string | null;
  currencyDecimals: number;
}

export interface DueInstallmentRow extends InstallmentRow {
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  customerWhatsapp: string | null;
  invoiceId: number;
  invoiceNo: string | null;
  currencyId: number;
  currencyCode: string;
  decimals: number;
  planStatus: PlanStatus;
}

// ============ التحقق (zod) ============

const POS_MONEY_RE = /^\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PlanSchema = z.object({
  invoiceId: z.number().int().positive('رقم الفاتورة غير صالح'),
  months: z
    .number()
    .int()
    .min(1, 'عدد الأقساط يجب أن يكون قسطاً واحداً على الأقل')
    .max(120, 'عدد الأقساط كبير جداً (الحد 120)'),
  downPayment: z.string().regex(POS_MONEY_RE, 'الدفعة الأولى يجب أن تكون رقماً غير سالب').optional(),
  firstDue: z.string().regex(ISO_DATE_RE, 'أول استحقاق يجب أن يكون بصيغة YYYY-MM-DD'),
  cycle: z.enum(['monthly', 'weekly']).optional(),
  cashboxId: z.number().int().positive().optional(),
});

// ============ التسلسل ============

let writeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

// ============ مساعدات التواريخ ============

function addMonths(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** المتاح على الفاتورة = due_amount − التخصيصات غير الملغاة. */
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

async function currencyDecimals(db: DbEngine, currencyId: number): Promise<number> {
  const rows = await db.all<{ decimals: number }>('SELECT decimals FROM currency WHERE id = ?', [currencyId]);
  return Number(rows[0]?.decimals ?? 2);
}

// ============ إنشاء الخطة (FR-05-01) ============

export async function createInstallmentPlan(
  input: CreatePlanInput,
): Promise<{ planId: number; installmentIds: number[] }> {
  const v = PlanSchema.parse(input);
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const today = todayISO();
      const now = new Date().toISOString();

      // الفاتورة: بيع + آجلة + مكتملة + متاح > 0
      const rows = await db.all<{
        id: number; invoice_no: string | null; doc_type: string; pay_status: string; status: string;
        customer_id: number | null; currency_id: number;
      }>('SELECT id, invoice_no, doc_type, pay_status, status, customer_id, currency_id FROM invoice WHERE id = ?', [
        v.invoiceId,
      ]);
      const inv = rows[0];
      if (inv === undefined) {
        throw new Error('الفاتورة غير موجودة — ربما حُذف الرابط، عد للقائمة وأعد المحاولة');
      }
      if (inv.doc_type !== 'sale' || inv.status !== 'completed' || inv.pay_status !== 'credit') {
        throw new Error('التقسيط لفواتير البيع الآجلة فقط — هذه فاتورة نقدية أو مختلطة أو غير مكتملة');
      }
      if (inv.customer_id === null) {
        throw new Error('الفاتورة بلا عميل — لا يمكن تقسيطها');
      }
      const open = await invoiceOpenAmount(db, v.invoiceId);
      if (open.lessThanOrEqualTo(0)) {
        throw new Error('التقسيط لفواتير لها متاح آجل — هذه الفاتورة مسددة بالكامل');
      }

      // خطة نشطة/مكتملة قائمة؟
      const existing = await db.all<{ id: number; status: string }>(
        "SELECT id, status FROM installment_plan WHERE invoice_id = ? AND status IN ('active', 'completed')",
        [v.invoiceId],
      );
      if (existing.length > 0) {
        throw new Error('توجد خطة تقسيط نشطة لهذه الفاتورة بالفعل — راجع الخطة الحالية أو ألغِها أولاً');
      }

      // الدفعة الأولى ≤ المتاح
      const down = dec(v.downPayment ?? '0');
      if (down.lessThan(0)) {
        throw new Error('الدفعة الأولى يجب أن تكون رقماً غير سالب');
      }
      if (down.greaterThan(open)) {
        throw new Error(
          `الدفعة الأولى (${money(down)}) أكبر من المبلغ القابل للتقسيط (${money(open)}) — خفّض الدفعة الأولى`,
        );
      }
      const principal = open.minus(down);
      const n = v.months;
      if (principal.lessThanOrEqualTo(0)) {
        throw new Error('المبلغ القابل للتقسيط صفر — لا حاجة لخطة أقساط');
      }

      const decimals = await currencyDecimals(db, Number(inv.currency_id));
      const each = roundTo(principal.div(n), decimals);
      if (each.lessThanOrEqualTo(0)) {
        throw new Error(
          `المبلغ القابل للتقسيط (${money(principal)}) أصغر من أن يوزَّع على ${n} قسطاً — قلّل عدد الأقساط`,
        );
      }

      // سعر اليوم Snapshot لعملة الخطة
      const rateSnap = await getRateSnapshot(Number(inv.currency_id), today);

      // الخطة
      const planRes = await db.run(
        'INSERT INTO installment_plan(customer_id, invoice_id, currency_id, exchange_rate, principal, ' +
          'down_payment, down_payment_cash_tx_id, months, cycle, first_due, total_paid, status, created_at, updated_at, created_by) ' +
          "VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 'active', ?, ?, ?)",
        [
          inv.customer_id,
          v.invoiceId,
          Number(inv.currency_id),
          rateSnap.rate,
          money(principal),
          money(down),
          n,
          v.cycle ?? 'monthly',
          v.firstDue,
          now,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      const planId = Number(planRes.lastInsertRowId);

      // الدفعة الأولى: سند قبض مرتبط (FR-05-01) + تخصيص على الفاتورة
      if (down.greaterThan(0)) {
        if (v.cashboxId === undefined) {
          throw new Error('الدفعة الأولى تتطلب اختيار صندوق يُقبض فيه — اختر الصندوق ثم أعد الحفظ');
        }
        const box = await db.all<{ id: number }>('SELECT id FROM cashbox WHERE id = ?', [v.cashboxId]);
        if (box.length === 0) {
          throw new Error('الصندوق المختار غير موجود — أعد اختيار الصندوق وحاول مجدداً');
        }
        const txRes = await db.run(
          'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
            'customer_id, is_voided, description, created_at, created_by) ' +
          "VALUES('receipt', ?, ?, ?, ?, ?, 'installment', ?, ?, 0, ?, ?, ?)",
          [
            v.cashboxId,
            Number(inv.currency_id),
            money(down),
            rateSnap.rate,
            today,
            planId,
            inv.customer_id,
            'دفعة أولى لخطة تقسيط',
            now,
            getCurrentUserId() ?? null,
          ],
        );
        const dpTxId = Number(txRes.lastInsertRowId);
        await db.run(
          'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
          [dpTxId, v.invoiceId, money(down), now, getCurrentUserId() ?? null],
        );
        await db.run('UPDATE installment_plan SET down_payment_cash_tx_id = ? WHERE id = ?', [dpTxId, planId]);
      }

      // الجدول (قاعدة 5.4-9: الفرق على الأخير)
      const cycle = v.cycle ?? 'monthly';
      const installmentIds: number[] = [];
      for (let k = 0; k < n; k++) {
        const amount = k === n - 1 ? principal.minus(each.times(n - 1)) : each;
        const dueDate = cycle === 'weekly' ? addDays(v.firstDue, 7 * k) : addMonths(v.firstDue, k);
        const res = await db.run(
          'INSERT INTO installment(plan_id, seq, due_date, amount, paid_amount, status, created_at, updated_at) ' +
          "VALUES(?, ?, ?, ?, 0, 'pending', ?, ?)",
          [planId, k + 1, dueDate, money(amount), now, now],
        );
        installmentIds.push(Number(res.lastInsertRowId));
      }

      await logAudit('installment_plan_created', {
        entity: 'installment_plan',
        entityId: planId,
        details: {
          invoiceId: v.invoiceId,
          invoiceNo: inv.invoice_no,
          customerId: inv.customer_id,
          principal: money(principal),
          downPayment: money(down),
          months: n,
          cycle,
          firstDue: v.firstDue,
        },
      });

      return { planId, installmentIds };
    });
  });
}

// ============ القوائم والقراءة ============

const PLAN_SELECT =
  'SELECT p.*, c.name AS customer_name, i.invoice_no AS invoice_no, cur.code AS currency_code, cur.decimals AS currency_decimals, ' +
  'COALESCE((SELECT SUM(inst.amount) FROM installment inst WHERE inst.plan_id = p.id), 0) AS sched_total, ' +
  'COALESCE((SELECT SUM(inst.paid_amount) FROM installment inst WHERE inst.plan_id = p.id), 0) AS inst_paid, ' +
  'COALESCE((SELECT COUNT(*) FROM installment inst WHERE inst.plan_id = p.id AND inst.status IN (\'pending\', \'partial\')), 0) AS remaining_count, ' +
  '(SELECT MIN(inst.due_date) FROM installment inst WHERE inst.plan_id = p.id AND inst.status IN (\'pending\', \'partial\')) AS next_due ' +
  'FROM installment_plan p ' +
  'JOIN customer c ON c.id = p.customer_id ' +
  'LEFT JOIN invoice i ON i.id = p.invoice_id ' +
  'JOIN currency cur ON cur.id = p.currency_id ';

function mapPlanRow(r: Record<string, unknown>): PlanRow {
  const down = dec(r.down_payment as string | number);
  const principal = dec(r.principal as string | number);
  const instPaid = dec(r.inst_paid as string | number);
  return {
    id: Number(r.id),
    customerId: Number(r.customer_id),
    customerName: String(r.customer_name ?? ''),
    invoiceId: Number(r.invoice_id),
    invoiceNo: (r.invoice_no as string | null) ?? null,
    currencyId: Number(r.currency_id),
    currencyCode: String(r.currency_code ?? ''),
    decimals: Number(r.currency_decimals ?? 2),
    principal: money(principal),
    downPayment: money(down),
    downPaymentCashTxId:
      r.down_payment_cash_tx_id === null || r.down_payment_cash_tx_id === undefined
        ? null
        : Number(r.down_payment_cash_tx_id),
    totalPaid: money(instPaid),
    totalAmount: money(down.plus(principal)),
    paid: money(down.plus(instPaid)),
    remaining: money(principal.minus(instPaid)),
    months: Number(r.months),
    cycle: (r.cycle as 'monthly' | 'weekly') ?? 'monthly',
    firstDue: String(r.first_due ?? ''),
    status: (r.status as PlanStatus) ?? 'active',
    nextDue: (r.next_due as string | null) ?? null,
    remainingCount: Number(r.remaining_count ?? 0),
  };
}

export async function listPlans(opts?: { status?: string; customerId?: number }): Promise<PlanRow[]> {
  const db = await getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status !== undefined && opts.status.length > 0 && opts.status !== 'all') {
    conds.push('p.status = ?');
    params.push(opts.status);
  }
  if (opts?.customerId !== undefined && Number.isFinite(opts.customerId)) {
    conds.push('p.customer_id = ?');
    params.push(opts.customerId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await db.all<Record<string, unknown>>(
    `${PLAN_SELECT} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT 200`,
    params,
  );
  return rows.map(mapPlanRow);
}

export async function getPlan(id: number): Promise<PlanFull | null> {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(`${PLAN_SELECT} WHERE p.id = ?`, [id]);
  const r = rows[0];
  if (r === undefined) return null;
  const { remainingCount: _rc, ...planBase } = mapPlanRow(r);

  const cust = await db.all<{ phone: string | null; whatsapp: string | null }>(
    'SELECT phone, whatsapp FROM customer WHERE id = ?',
    [Number(r.customer_id)],
  );

  const inst = await db.all<Record<string, unknown>>(
    'SELECT * FROM installment WHERE plan_id = ? ORDER BY seq ASC',
    [id],
  );

  return {
    plan: planBase,
    customerPhone: (cust[0]?.phone as string | null) ?? null,
    customerWhatsapp: (cust[0]?.whatsapp as string | null) ?? null,
    currencyDecimals: Number(r.currency_decimals ?? 2),
    installments: inst.map((x) => ({
      id: Number(x.id),
      planId: Number(x.plan_id),
      seq: Number(x.seq),
      dueDate: String(x.due_date),
      amount: money(x.amount as string | number),
      paidAmount: money(x.paid_amount as string | number),
      status: (x.status as InstallmentStatus) ?? 'pending',
      paidAt: (x.paid_at as string | null) ?? null,
      cashTxId: x.cash_tx_id === null || x.cash_tx_id === undefined ? null : Number(x.cash_tx_id),
    })),
  };
}

/** الأقساط المستحقة اليوم/خلال نافذة + المتأخرة (FR-05-02/04) — الخطط النشطة فقط. */
export async function installmentsDue(opts?: { withinDays?: number }): Promise<DueInstallmentRow[]> {
  const db = await getDb();
  const days = Math.max(0, opts?.withinDays ?? 0);
  const until = addDays(todayISO(), days);
  const rows = await db.all<Record<string, unknown>>(
    'SELECT inst.*, p.customer_id, p.invoice_id, p.currency_id, p.status AS plan_status, c.name AS customer_name, ' +
      'c.phone AS customer_phone, c.whatsapp AS customer_whatsapp, i.invoice_no, cur.code AS currency_code, cur.decimals AS currency_decimals ' +
      'FROM installment inst ' +
      'JOIN installment_plan p ON p.id = inst.plan_id ' +
      'JOIN customer c ON c.id = p.customer_id ' +
      'LEFT JOIN invoice i ON i.id = p.invoice_id ' +
      'JOIN currency cur ON cur.id = p.currency_id ' +
      "WHERE p.status = 'active' AND inst.status IN ('pending', 'partial') AND inst.due_date <= ? " +
      'ORDER BY inst.due_date ASC, inst.id ASC LIMIT 300',
    [until],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    planId: Number(r.plan_id),
    seq: Number(r.seq),
    dueDate: String(r.due_date),
    amount: money(r.amount as string | number),
    paidAmount: money(r.paid_amount as string | number),
    status: (r.status as InstallmentStatus) ?? 'pending',
    paidAt: (r.paid_at as string | null) ?? null,
    cashTxId: r.cash_tx_id === null || r.cash_tx_id === undefined ? null : Number(r.cash_tx_id),
    customerId: Number(r.customer_id),
    customerName: String(r.customer_name ?? ''),
    customerPhone: (r.customer_phone as string | null) ?? null,
    customerWhatsapp: (r.customer_whatsapp as string | null) ?? null,
    invoiceId: Number(r.invoice_id),
    invoiceNo: (r.invoice_no as string | null) ?? null,
    currencyId: Number(r.currency_id),
    currencyCode: String(r.currency_code ?? ''),
    decimals: Number(r.currency_decimals ?? 2),
    planStatus: (r.plan_status as PlanStatus) ?? 'active',
  }));
}

// ============ التحصيل (FR-05-02) ============

export interface CollectOpts {
  cashboxId: number;
  /** افتراضي = المتبقي من القسط كاملاً (جزئي مسموح). */
  amount?: string;
}

export async function collectInstallment(
  installmentId: number,
  opts: CollectOpts,
): Promise<{ cashTxId: number }> {
  if (!Number.isFinite(opts.cashboxId) || opts.cashboxId <= 0) {
    throw new Error('التحصيل يتطلب اختيار صندوق — اختر الصندوق الذي سيُقبض فيه القسط');
  }
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const today = todayISO();
      const now = new Date().toISOString();

      const rows = await db.all<{
        id: number; plan_id: number; seq: number; due_date: string; amount: string | number;
        paid_amount: string | number; status: string;
      }>('SELECT id, plan_id, seq, due_date, amount, paid_amount, status FROM installment WHERE id = ?', [
        installmentId,
      ]);
      const inst = rows[0];
      if (inst === undefined) {
        throw new Error(`قسط غير موجود (رقم ${installmentId}) — ربما حُذف الرابط، أعد فتح الخطة`);
      }

      const planRows = await db.all<{
        id: number; customer_id: number; invoice_id: number; currency_id: number; status: string; months: number;
      }>('SELECT id, customer_id, invoice_id, currency_id, status, months FROM installment_plan WHERE id = ?', [
        Number(inst.plan_id),
      ]);
      const plan = planRows[0];
      if (plan === undefined) {
        throw new Error('خطة التقسيط غير موجودة — راجع قائمة الخطط');
      }
      if (plan.status !== 'active') {
        throw new Error('الخطة غير نشطة — لا يمكن تحصيل أقساط من خطة ملغاة أو مكتملة');
      }

      const remaining = dec(inst.amount).minus(dec(inst.paid_amount));
      if (remaining.lessThanOrEqualTo(0)) {
        throw new Error('القسط مسدد بالكامل — لا مبلغ متبقٍ لتحصيله');
      }
      const amount = dec(opts.amount ?? money(remaining));
      if (amount.lessThanOrEqualTo(0)) {
        throw new Error('مبلغ التحصيل يجب أن يكون أكبر من صفر');
      }
      if (amount.greaterThan(remaining)) {
        throw new Error(
          `مبلغ التحصيل (${money(amount)}) أكبر من المتبقي من القسط (${money(remaining)}) — خفّض المبلغ`,
        );
      }

      const box = await db.all<{ id: number }>('SELECT id FROM cashbox WHERE id = ?', [opts.cashboxId]);
      if (box.length === 0) {
        throw new Error('الصندوق المختار غير موجود — أعد اختيار الصندوق وحاول مجدداً');
      }

      // سند القبض بعملة الخطة وسعر اليوم
      const rateSnap = await getRateSnapshot(Number(plan.currency_id), today);
      const txRes = await db.run(
        'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
          'customer_id, is_voided, description, created_at, created_by) ' +
          "VALUES('receipt', ?, ?, ?, ?, ?, 'installment', ?, ?, 0, ?, ?, ?)",
        [
          opts.cashboxId,
          Number(plan.currency_id),
          money(amount),
          rateSnap.rate,
          today,
          plan.id,
          plan.customer_id,
          `تحصيل القسط ${Number(inst.seq)}/${Number(plan.months)} من خطة تقسيط`,
          now,
          getCurrentUserId() ?? null,
        ],
      );
      const cashTxId = Number(txRes.lastInsertRowId);

      // تخصيص على الفاتورة الأصل (بعملة الخطة — نفس عملة الفاتورة) حتى يستنفد المتاح
      const open = await invoiceOpenAmount(db, Number(plan.invoice_id));
      if (open.greaterThan(0)) {
        const alloc = Decimal.min(open, amount);
        const decimals = await currencyDecimals(db, Number(plan.currency_id));
        const allocRounded = roundTo(alloc, decimals);
        if (allocRounded.greaterThan(0)) {
          await db.run(
            'INSERT INTO payment_allocation(cash_tx_id, invoice_id, allocated_amount, allocated_at, created_by) VALUES(?, ?, ?, ?, ?)',
            [cashTxId, Number(plan.invoice_id), money(allocRounded), now, getCurrentUserId() ?? null],
          );
        }
      }

      // تحديث القسط
      const newPaid = dec(inst.paid_amount).plus(amount);
      const fullyPaid = newPaid.greaterThanOrEqualTo(dec(inst.amount));
      await db.run(
        'UPDATE installment SET paid_amount = ?, status = ?, paid_at = ?, cash_tx_id = ?, updated_at = ? WHERE id = ?',
        [
          money(newPaid),
          fullyPaid ? 'paid' : 'partial',
          fullyPaid ? today : null,
          fullyPaid ? cashTxId : null,
          now,
          installmentId,
        ],
      );

      // تحديث الخطة (اكتمال عند سداد الكل)
      await db.run('UPDATE installment_plan SET total_paid = total_paid + ?, updated_at = ? WHERE id = ?', [
        money(amount),
        now,
        plan.id,
      ]);
      const unpaid = await db.all<{ c: number }>(
        "SELECT count(*) AS c FROM installment WHERE plan_id = ? AND status IN ('pending', 'partial')",
        [plan.id],
      );
      if ((unpaid[0]?.c ?? 0) === 0) {
        await db.run("UPDATE installment_plan SET status = 'completed', updated_at = ? WHERE id = ?", [
          now,
          plan.id,
        ]);
      }

      await logAudit('installment_collected', {
        entity: 'installment',
        entityId: installmentId,
        details: {
          planId: plan.id,
          seq: Number(inst.seq),
          amount: money(amount),
          cashTxId,
          fullyPaid,
        },
      });
      return { cashTxId };
    });
  });
}

// ============ إعادة الجدولة (FR-05-04) ============

export async function rescheduleInstallment(installmentId: number, newDueDate: string): Promise<void> {
  if (!ISO_DATE_RE.test(newDueDate)) {
    throw new Error('تاريخ الاستحقاق الجديد يجب أن يكون بصيغة YYYY-MM-DD');
  }
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const rows = await db.all<{
        id: number; plan_id: number; seq: number; due_date: string; status: string;
      }>('SELECT id, plan_id, seq, due_date, status FROM installment WHERE id = ?', [installmentId]);
      const inst = rows[0];
      if (inst === undefined) {
        throw new Error(`قسط غير موجود (رقم ${installmentId}) — ربما حُذف الرابط`);
      }
      if (inst.status === 'paid') {
        throw new Error('لا يمكن إعادة جدولة قسط مسدد — اختر قسطاً معلقاً أو مدفوعاً جزئياً');
      }
      const plan = await db.all<{ id: number; status: string }>(
        'SELECT id, status FROM installment_plan WHERE id = ?',
        [Number(inst.plan_id)],
      );
      if (plan[0]?.status !== 'active') {
        throw new Error('لا يمكن إعادة جدولة أقساط خطة غير نشطة');
      }
      await db.run('UPDATE installment SET due_date = ?, updated_at = ? WHERE id = ?', [
        newDueDate,
        new Date().toISOString(),
        installmentId,
      ]);
      await logAudit('reschedule_installment', {
        entity: 'installment',
        entityId: installmentId,
        details: {
          planId: Number(inst.plan_id),
          seq: Number(inst.seq),
          oldDueDate: inst.due_date,
          newDueDate,
        },
      });
    });
  });
}

// ============ إلغاء الخطة ============

export async function cancelPlan(planId: number, opts: { managerConfirmed: boolean }): Promise<void> {
  if (opts.managerConfirmed !== true) {
    throw new Error('إلغاء خطة التقسيط يتطلب تأكيد المدير — فعّل تأكيد المدير ثم أعد المحاولة');
  }
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const rows = await db.all<{ id: number; status: string; customer_id: number }>(
        'SELECT id, status, customer_id FROM installment_plan WHERE id = ?',
        [planId],
      );
      const plan = rows[0];
      if (plan === undefined) {
        throw new Error(`خطة غير موجودة (رقم ${planId})`);
      }
      if (plan.status !== 'active') {
        throw new Error('لا يمكن إلغاء خطة غير نشطة');
      }
      await db.run("UPDATE installment_plan SET status = 'cancelled', updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        planId,
      ]);
      await logAudit('installment_plan_cancelled', {
        entity: 'installment_plan',
        entityId: planId,
        details: { customerId: plan.customer_id },
      });
    });
  });
}
