/**
 * تقارير المبيعات (FR-09-06): حسب العميل / الصنف / اليوم — بفترة زمنية.
 *
 * كل الأرقام بالعملة الأساس (total_base للفواتير، line_total×exchange_rate للبنود)
 * — قرار V1: عملة التقارير هي الأساس (التحويل بسعر يوم كل حدث → V1.1).
 *
 * salesByDay تقارن الفترة المطلوبة بالفترة السابقة بنفس الطول مباشرة قبلها
 * وتعيد نسبة التغير (null إذا كانت السابقة صفر مبيعات — لا قسمة على صفر).
 */
import { getDb } from '@/db/client';
import { dec, money, roundTo } from '@/utils/money';

export interface PeriodOpts {
  dateFrom: string;
  dateTo: string;
}

// ============ حسب العميل (FR-09-06) ============

export async function salesByCustomer(
  opts: PeriodOpts,
): Promise<{ rows: { name: string; sales: string; returns: string; net: string; invoices: number }[]; total: string }> {
  const db = await getDb();
  const rows = await db.all<{ name: string; sale: string | number; ret: string | number; n: number }>(
    `SELECT COALESCE(c.name, 'عميل نقدي') AS name,
            SUM(CASE WHEN i.doc_type = 'sale' THEN i.total_base ELSE 0 END) AS sale,
            SUM(CASE WHEN i.doc_type = 'sale_return' THEN i.total_base ELSE 0 END) AS ret,
            SUM(CASE WHEN i.doc_type = 'sale' THEN 1 ELSE 0 END) AS n
     FROM invoice i LEFT JOIN customer c ON c.id = i.customer_id
     WHERE i.status = 'completed' AND i.doc_type IN ('sale','sale_return')
       AND i.issued_at >= ? AND i.issued_at <= ?
     GROUP BY i.customer_id
     ORDER BY sale DESC`,
    [opts.dateFrom, opts.dateTo],
  );
  let total = dec(0);
  const out = rows.map((r) => {
    const sale = dec(r.sale);
    const ret = dec(r.ret);
    const net = sale.minus(ret);
    total = total.plus(net);
    return {
      name: String(r.name),
      sales: money(roundTo(sale, 4)),
      returns: money(roundTo(ret, 4)),
      net: money(roundTo(net, 4)),
      invoices: Number(r.n),
    };
  });
  return { rows: out, total: money(roundTo(total, 4)) };
}

// ============ حسب الصنف (FR-09-06) ============

export async function salesByProduct(
  opts: PeriodOpts,
): Promise<{ rows: { name: string; qtySold: string; sales: string; returns: string }[]; total: string }> {
  const db = await getDb();
  const rows = await db.all<{ name: string; qty_sold: string | number; sale: string | number; ret: string | number }>(
    `SELECT COALESCE(p.name, it.line_desc, 'سطر حر') AS name,
            SUM(CASE WHEN i.doc_type = 'sale' THEN it.qty ELSE 0 END) AS qty_sold,
            SUM(CASE WHEN i.doc_type = 'sale' THEN it.line_total ELSE 0 END * i.exchange_rate) AS sale,
            SUM(CASE WHEN i.doc_type = 'sale_return' THEN it.line_total ELSE 0 END * i.exchange_rate) AS ret
     FROM invoice_item it
     JOIN invoice i ON i.id = it.invoice_id
     LEFT JOIN product p ON p.id = it.product_id
     WHERE i.status = 'completed' AND i.doc_type IN ('sale','sale_return')
       AND i.issued_at >= ? AND i.issued_at <= ?
     GROUP BY it.product_id
     ORDER BY sale DESC`,
    [opts.dateFrom, opts.dateTo],
  );
  let total = dec(0);
  const out = rows.map((r) => {
    const sale = dec(r.sale);
    const ret = dec(r.ret);
    total = total.plus(sale.minus(ret));
    return {
      name: String(r.name),
      qtySold: money(dec(r.qty_sold)),
      sales: money(roundTo(sale, 4)),
      returns: money(roundTo(ret, 4)),
    };
  });
  return { rows: out, total: money(roundTo(total, 4)) };
}

// ============ حسب اليوم + مقارنة الفترة السابقة (FR-09-06/09) ============

/** طول الفترة بالأيام (شامل الطرفين). */
function periodDays(dateFrom: string, dateTo: string): number {
  const a = new Date(Number(dateFrom.slice(0, 4)), Number(dateFrom.slice(5, 7)) - 1, Number(dateFrom.slice(8, 10)));
  const b = new Date(Number(dateTo.slice(0, 4)), Number(dateTo.slice(5, 7)) - 1, Number(dateTo.slice(8, 10)));
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function netSalesByDayRange(dateFrom: string, dateTo: string) {
  const db = await getDb();
  return db.all<{ d: string; sale: string | number; ret: string | number }>(
    `SELECT issued_at AS d,
            SUM(CASE WHEN doc_type = 'sale' THEN total_base ELSE 0 END) AS sale,
            SUM(CASE WHEN doc_type = 'sale_return' THEN total_base ELSE 0 END) AS ret
     FROM invoice
     WHERE status = 'completed' AND doc_type IN ('sale','sale_return')
       AND issued_at >= ? AND issued_at <= ?
     GROUP BY issued_at
     ORDER BY issued_at ASC`,
    [dateFrom, dateTo],
  );
}

export async function salesByDay(
  opts: PeriodOpts,
): Promise<{
  rows: { date: string; sales: string; net: string }[];
  /** صافي مبيعات الفترة السابقة بنفس الطول. */
  prevPeriodSales: string;
  /** نسبة التغير عن الفترة السابقة — null إن كانت السابقة صفراً. */
  changePct: string | null;
}> {
  // الفترة المطلوبة يوماً بيوم
  const current = await netSalesByDayRange(opts.dateFrom, opts.dateTo);
  const byDate = new Map(current.map((r) => [r.d, { sale: dec(r.sale), net: dec(r.sale).minus(dec(r.ret)) }]));

  const days = periodDays(opts.dateFrom, opts.dateTo);
  const rows: { date: string; sales: string; net: string }[] = [];
  for (let d = opts.dateFrom; rows.length < Math.min(days, 366); d = shiftDay(d, 1)) {
    const v = byDate.get(d);
    rows.push({
      date: d,
      sales: money(roundTo(v?.sale ?? 0, 4)),
      net: money(roundTo(v?.net ?? 0, 4)),
    });
    if (d >= opts.dateTo) break;
  }

  // الفترة السابقة بنفس الطول مباشرة قبل المطلوبة
  const prevTo = shiftDay(opts.dateFrom, -1);
  const prevFrom = shiftDay(prevTo, -(days - 1));
  const prev = await netSalesByDayRange(prevFrom, prevTo);
  const prevSales = prev.reduce((acc, r) => acc.plus(dec(r.sale)).minus(dec(r.ret)), dec(0));

  let changePct: string | null = null;
  const curNet = rows.reduce((acc, r) => acc.plus(dec(r.net)), dec(0));
  if (prevSales.greaterThan(0)) {
    changePct = money(roundTo(curNet.minus(prevSales).div(prevSales).times(100), 1));
  }

  return { rows, prevPeriodSales: money(roundTo(prevSales, 4)), changePct };
}
