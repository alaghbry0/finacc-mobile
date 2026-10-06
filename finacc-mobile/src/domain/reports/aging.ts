/**
 * تقرير أعمار الديون (FR-09-05) — أساس تخصيص FIFO (قاعدة 5.4-6).
 *
 * المتبقي على كل فاتورة بيع آجلة مكتملة = due_amount − Σ تخصيصات سنداتها
 * التي تحمل العميل وغير الملغاة (نفس معادلة الدومين في cash.ts/invoiceRemainingDue
 * — سند لحظة البيع النقدي لا يحمل العميل فلا يُخصم مرتين).
 *
 * العمر = عدد الأيام من issued_at حتى تاريخ التقرير (الافتراضي اليوم):
 *   current: 0–30 يوماً • d30: 31–60 • d60: 61–90 • d90: +90.
 *
 * كل عملة على حدة (قرار 8): الصفوف مفاتيحها (عميل × عملة) والقيم بعملة
 * الفاتورة نفسها — لا تجميع بسعر اليوم. رمز العملة مرفق بكل صف.
 */
import { getDb } from '@/db/client';
import { dec, money, roundTo } from '@/utils/money';
import { todayISO } from '@/utils/format';

export interface AgingRow {
  customer: string;
  currencyCode: string;
  current: string;
  d30: string;
  d60: string;
  d90: string;
  total: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = new Date(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export async function debtAging(opts?: { dateTo?: string }): Promise<AgingRow[]> {
  const asOf = opts?.dateTo ?? todayISO();
  const db = await getDb();

  const rows = await db.all<{
    customer: string; currency_code: string; issued_at: string;
    due_amount: string | number; allocated: string | number;
  }>(
    `SELECT c.name AS customer, cur.code AS currency_code, i.issued_at, i.due_amount,
            COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocation pa
                      JOIN cash_tx t ON t.id = pa.cash_tx_id
                      WHERE pa.invoice_id = i.id AND t.customer_id IS NOT NULL AND t.is_voided = 0
                        AND t.tx_date <= ?), 0) AS allocated
     FROM invoice i
     JOIN customer c ON c.id = i.customer_id
     JOIN currency cur ON cur.id = i.currency_id
     WHERE i.doc_type = 'sale' AND i.status = 'completed' AND i.customer_id IS NOT NULL
       AND i.pay_status IN ('credit','mixed') AND i.issued_at <= ?
     ORDER BY i.issued_at ASC, i.id ASC`,
    [asOf, asOf],
  );

  type Bucket = { customer: string; currencyCode: string; current: ReturnType<typeof dec>; d30: ReturnType<typeof dec>; d60: ReturnType<typeof dec>; d90: ReturnType<typeof dec> };
  const byKey = new Map<string, Bucket>();
  const key = (customer: string, code: string) => `${customer}||${code}`;

  for (const r of rows) {
    const remaining = dec(r.due_amount).minus(dec(r.allocated));
    if (remaining.lessThanOrEqualTo(0)) continue;

    const k = key(r.customer, r.currency_code);
    let b = byKey.get(k);
    if (b === undefined) {
      b = { customer: r.customer, currencyCode: r.currency_code, current: dec(0), d30: dec(0), d60: dec(0), d90: dec(0) };
      byKey.set(k, b);
    }

    const age = daysBetween(String(r.issued_at).slice(0, 10), asOf);
    if (age <= 30) b.current = b.current.plus(remaining);
    else if (age <= 60) b.d30 = b.d30.plus(remaining);
    else if (age <= 90) b.d60 = b.d60.plus(remaining);
    else b.d90 = b.d90.plus(remaining);
  }

  const out: AgingRow[] = Array.from(byKey.values()).map((b) => {
    const total = b.current.plus(b.d30).plus(b.d60).plus(b.d90);
    return {
      customer: b.customer,
      currencyCode: b.currencyCode,
      current: money(roundTo(b.current, 4)),
      d30: money(roundTo(b.d30, 4)),
      d60: money(roundTo(b.d60, 4)),
      d90: money(roundTo(b.d90, 4)),
      total: money(roundTo(total, 4)),
    };
  });
  out.sort((a, b) => (a.currencyCode === b.currencyCode
    ? dec(b.total).comparedTo(dec(a.total))
    : a.currencyCode.localeCompare(b.currencyCode)));
  return out;
}
