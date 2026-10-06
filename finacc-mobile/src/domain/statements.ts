import { getDb } from '@/db/client';
import { dec, money, Decimal } from '@/utils/money';

/**
 * كشف حساب الطرف (FR-03-04 + AC-18 + قرار 8):
 *
 * ── البنية ────────────────────────────────────────────────────────────────
 * رصيد افتتاحي (حتى dateFrom) + سطور بترتيب التاريخ (مدين/دائن/رصيد متحرك)
 * + رصيد إغلاق. العملة تُختار عند الطلب والكشف **يعرض أحداث عملته فقط** —
 * لا تُجمع عملات في رقم واحد، وأحداث العملات الأخرى تُشار إليها ببطاقة
 * معلومات فقط (hasOtherCurrencyEvents).
 *
 * ── التطابق المحاسبي ───────────────────────────────────────────────────────
 * السطور تُبنى من نفس مصفوفة معادلة رصيد الطرف (3-b):
 *   رصيد العميل = افتتاحي + Σ فواتير بيع آجلة (مدين) − Σ سندات قبض (دائن)
 *                 − Σ مرتجعات بيع (دائن)
 *   رصيد المورّد = افتتاحي + Σ فواتير شراء آجلة (دائن) − Σ سندات صرف (مدين)
 *                 − Σ مرتجعات شراء (مدين)
 * لذا إغلاق الكشف بلا فلاتر = رصيد الطرف بعملة الكشف حرفياً، وبعد تسوية
 * كاملة **بنفس العملة** = صفر («الكشف بالعملة الواحدة يتوازن دائماً»).
 *
 * ── الشيكات ────────────────────────────────────────────────────────────────
 * الشيك قبل cleared ذمّة CHQ فقط ولا يظهر في الكشف؛ عند cleared تنشأ حركة
 * القبض/الصرف بعملة الشيك فتظهر (دائن للعميل بقيمة الشيك بعملته — FR-03-04).
 */

// ============ الأنواع والعقود ============

export interface StatementLine {
  date: string;
  docNo: string;
  docType: 'sale' | 'sale_return' | 'receipt' | 'purchase' | 'purchase_return' | 'payment' | 'cheque';
  debit: string;
  credit: string;
  balance: string;
  /** مسار شاشة المستند للتنقل (sales | purchases | cash | cheque). */
  refScreen?: string;
  refId?: number;
}

export interface StatementResult {
  opening: string;
  lines: StatementLine[];
  closing: string;
  currencyCode: string;
  /** true إن وُجدت أحداث للطرف بعملات أخرى غير معروضة في هذا الكشف (قرار 8). */
  hasOtherCurrencyEvents: boolean;
  partyName: string;
}

export interface StatementOpts {
  currencyId: number;
  dateFrom?: string;
  dateTo?: string;
}

// ============ المحرك المشترك ============

interface RawEvent {
  date: string;
  docType: StatementLine['docType'];
  docNo: string;
  amount: Decimal;
  /** اتجاه السطر: doc = مستند دين (فاتورة/مرتجع)، cash = سند. */
  side: 'doc' | 'cash';
  refScreen: string;
  refId: number;
  seq: number;
}

async function buildStatement(
  kind: 'customer' | 'supplier',
  partyId: number,
  opts: StatementOpts,
): Promise<StatementResult> {
  const db = await getDb();
  const table = kind === 'customer' ? 'customer' : 'supplier';
  const idCol = kind === 'customer' ? 'customer_id' : 'supplier_id';
  const invoiceDocType = kind === 'customer' ? 'sale' : 'purchase';
  const returnDocType = kind === 'customer' ? 'sale_return' : 'purchase_return';
  const cashTxType = kind === 'customer' ? 'receipt' : 'payment';

  // الطرف + رمز العملة
  const partyRows = await db.all<{
    name: string; opening_balance: string | number | null; opening_balance_currency_id: number | null;
  }>(`SELECT name, opening_balance, opening_balance_currency_id FROM ${table} WHERE id = ?`, [partyId]);
  const party = partyRows[0];
  if (party === undefined) {
    throw new Error(
      kind === 'customer' ? `عميل غير موجود (رقم ${partyId})` : `مورّد غير موجود (رقم ${partyId})`,
    );
  }
  const curRows = await db.all<{ code: string }>('SELECT code FROM currency WHERE id = ?', [opts.currencyId]);
  if (curRows.length === 0) {
    throw new Error(`عملة غير موجودة (رقم ${opts.currencyId}) — راجع شاشة العملات`);
  }
  const currencyCode = curRows[0].code;

  // ── جمع الأحداث الخام (بعملة الكشف فقط — قرار 8) ──
  const events: RawEvent[] = [];

  // 1) الفواتير الآجلة (credit/mixed → الجزء غير المسدد فور البيع) والمرتجعات
  const invRows = await db.all<{
    id: number; invoice_no: string | null; issued_at: string; doc_type: string; pay_status: string;
    due_amount: string | number;
  }>(
    `SELECT id, invoice_no, issued_at, doc_type, pay_status, due_amount FROM invoice
     WHERE ${idCol} = ? AND status = 'completed' AND doc_type IN (?, ?) AND currency_id = ?`,
    [partyId, invoiceDocType, returnDocType, opts.currencyId],
  );
  for (const r of invRows) {
    if (r.doc_type === invoiceDocType && r.pay_status !== 'cash') {
      const amount = dec(r.due_amount);
      if (amount.greaterThan(0)) {
        events.push({
          date: r.issued_at,
          docType: invoiceDocType as StatementLine['docType'],
          docNo: r.invoice_no ?? `#${r.id}`,
          amount,
          side: 'doc',
          refScreen: 'sales',
          refId: Number(r.id),
          seq: Number(r.id),
        });
      }
    } else if (r.doc_type === returnDocType) {
      const amount = dec(r.due_amount);
      if (amount.greaterThan(0)) {
        events.push({
          date: r.issued_at,
          docType: returnDocType as StatementLine['docType'],
          docNo: r.invoice_no ?? `#${r.id}`,
          amount,
          side: 'doc',
          refScreen: 'sales',
          refId: Number(r.id),
          seq: Number(r.id),
        });
      }
    }
  }

  // 2) السندات المرتبطة بالطرف (قبض للعميل / صرف للمورّد) — نفس مصفوفة معادلة الرصيد
  const cashRows = await db.all<{
    id: number; amount: string | number; tx_date: string; voucher_no: string | null; cheque_no: string | null;
    cheque_id: number | null; invoice_no: string | null;
  }>(
    `SELECT t.id, t.amount, t.tx_date, t.voucher_no, q.cheque_no, q.id AS cheque_id, i.invoice_no
     FROM cash_tx t
     LEFT JOIN cheque q ON q.cleared_cash_tx_id = t.id
     LEFT JOIN invoice i ON i.id = t.ref_id AND t.ref_type = 'invoice'
     WHERE t.${idCol} = ? AND t.tx_type = ? AND t.is_voided = 0
       AND t.ref_type IN ('invoice', 'installment', 'on_account') AND t.currency_id = ?`,
    [partyId, cashTxType, opts.currencyId],
  );
  for (const r of cashRows) {
    events.push({
      date: r.tx_date,
      docType: r.cheque_id !== null ? 'cheque' : (cashTxType as StatementLine['docType']),
      docNo:
        r.cheque_no !== null && r.cheque_no !== undefined
          ? `شيك ${r.cheque_no}`
          : (r.voucher_no ?? (kind === 'customer' ? `سند قبض #${r.id}` : `سند صرف #${r.id}`)),
      amount: dec(r.amount),
      side: 'cash',
      refScreen: r.cheque_id !== null ? 'cheque' : 'cash',
      refId: r.cheque_id !== null ? Number(r.cheque_id) : Number(r.id),
      seq: Number(r.id),
    });
  }

  // ترتيب: التاريخ ثم المستندات قبل السندات ثم المعرّف
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.side !== b.side) return a.side === 'doc' ? -1 : 1;
    return a.seq - b.seq;
  });

  // ── الافتتاحي (رصيد الطرف الافتتاحي بعملته + أحداث ما قبل dateFrom) ──
  let opening = dec(0);
  if (party.opening_balance_currency_id !== null && Number(party.opening_balance_currency_id) === opts.currencyId) {
    opening = dec(party.opening_balance ?? 0);
  }
  const from = opts.dateFrom;
  const to = opts.dateTo;
  const lines: StatementLine[] = [];

  /** مدين/دائن حسب نوع الحدث: عميل — فاتورة بيع مدين، مرتجع/قبض دائن؛ مورّد — فاتورة شراء دائن، مرتجع/صرف مدين. */
  const splitEvent = (e: RawEvent): { debit: Decimal; credit: Decimal } => {
    const isInvoiceDoc = e.docType === 'sale' || e.docType === 'purchase';
    const isReturnDoc = e.docType === 'sale_return' || e.docType === 'purchase_return';
    if (kind === 'customer') {
      return {
        debit: isInvoiceDoc ? e.amount : dec(0),
        credit: isReturnDoc || e.side === 'cash' ? e.amount : dec(0),
      };
    }
    return {
      credit: isInvoiceDoc ? e.amount : dec(0),
      debit: isReturnDoc || e.side === 'cash' ? e.amount : dec(0),
    };
  };

  // ── المرحلة 1: طي أحداث ما قبل dateFrom في الرصيد الافتتاحي ──
  let running = opening;
  if (from !== undefined) {
    for (const e of events) {
      if (e.date >= from) break;
      const { debit, credit } = splitEvent(e);
      running = running.plus(debit).minus(credit);
    }
  }
  const openingTotal = running; // رصيد ما قبل بداية الفترة (المعروض كافتتاحي)

  // ── المرحلة 2: سطور الفترة (dateFrom..dateTo) برصيد متحرك ──
  for (const e of events) {
    if (from !== undefined && e.date < from) continue;
    if (to !== undefined && e.date > to) continue;
    const { debit, credit } = splitEvent(e);
    running = running.plus(debit).minus(credit);
    lines.push({
      date: e.date,
      docNo: e.docNo,
      docType: e.docType,
      debit: money(debit),
      credit: money(credit),
      balance: money(running),
      refScreen: e.refScreen,
      refId: e.refId,
    });
  }

  // ── أحداث بعملات أخرى؟ (بطاقة معلومات فقط — لا تجميع أبداً) ──
  const otherCur = await db.all<{ c: number }>(
    `SELECT (SELECT count(*) FROM invoice i
               WHERE i.${idCol} = ? AND i.status = 'completed' AND i.currency_id <> ?
                 AND ((i.doc_type = ? AND i.pay_status IN ('credit', 'mixed')) OR i.doc_type = ?))
            + (SELECT count(*) FROM cash_tx t
               WHERE t.${idCol} = ? AND t.tx_type = ? AND t.is_voided = 0 AND t.currency_id <> ?
                 AND t.ref_type IN ('invoice', 'installment', 'on_account')) AS c`,
    [partyId, opts.currencyId, invoiceDocType, returnDocType, partyId, cashTxType, opts.currencyId],
  );
  const hasOtherCurrencyEvents = Number(otherCur[0]?.c ?? 0) > 0;

  return {
    opening: money(openingTotal),
    lines,
    closing: money(running),
    currencyCode,
    hasOtherCurrencyEvents,
    partyName: String(party.name),
  };
}

// ============ العقود العامة ============

/** كشف حساب العميل (FR-03-04) — بأحداث عملة الكشف فقط (قرار 8). */
export async function customerStatement(customerId: number, opts: StatementOpts): Promise<StatementResult> {
  return buildStatement('customer', customerId, opts);
}

/** كشف حساب المورّد (FR-03-04) — بأحداث عملة الكشف فقط (قرار 8). */
export async function supplierStatement(supplierId: number, opts: StatementOpts): Promise<StatementResult> {
  return buildStatement('supplier', supplierId, opts);
}
