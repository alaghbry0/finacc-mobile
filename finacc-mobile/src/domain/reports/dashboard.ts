/**
 * الداشبورد الحقيقي (FR-09-01 — §6.5): كل الأرقام حية من SQL بلا قيم ميتة.
 *
 * - todaySales = مبيعات اليوم المكتملة بالأساس − مرتجعات اليوم بالأساس.
 * - todayProfit = صيغة الربح الملزمة (قرار 7) لنفس اليوم عبر profitLoss().
 * - netCashBase = Σ أرصدة الصناديق كلٍ بعملته محوّلاً بالأساس بآخر سعر معروف.
 * - monthSalesChangePct = مقارنة الشهر حتى اليوم مقابل الشهر السابق حتى اليوم
 *   المماثل (نفس رقم اليوم من الشهر) — null إن كان الشهر السابق صفر مبيعات.
 * - last30 = صافي مبيعات 30 يوماً (للرسم) تصاعدياً بالتاريخ.
 * - topProducts = أعلى 5 أصناف مبيعاً بالشهر (صافي بعد المرتجعات).
 */
import { getDb } from '@/db/client';
import { dec, money, roundTo } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { cashboxBalances } from '../cash';
import { getBaseCurrency, getLatestRate } from '../currency';
import { installmentsDue } from '../installments';
import { listBelowMinStock } from '../inventory';
import { dueSoonCheques } from '../cheques';
import { profitLoss } from './profit-loss';

export interface DashboardData {
  todaySales: string;
  todayProfit: string;
  todayInvoices: number;
  netCashBase: string;
  monthSales: string;
  monthSalesChangePct: string | null;
  last30: { date: string; sales: string }[];
  topProducts: { name: string; qty: string; sales: string }[];
  dueInstallmentsCount: number;
  minStockCount: number;
  dueChequesCount: number;
}

/** أول يوم من شهر تاريخ ISO. */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** إزاحة شهرية على ISO (سالب = للخلف) بلا مكتبة تواريخ. */
function shiftMonth(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate(); // آخر يوم في الشهر الجديد
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** إزاحة أيام على ISO. */
function shiftDay(iso: string, days: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** صافي مبيعات فترة بالأساس (بيع مكتمل − مرتجع بيع مكتمل). */
async function netSalesBase(dateFrom: string, dateTo: string): Promise<{ sales: ReturnType<typeof dec>; returns: ReturnType<typeof dec> }> {
  const db = await getDb();
  const rows = await db.all<{ doc_type: string; s: string | number }>(
    `SELECT doc_type, SUM(total_base) AS s FROM invoice
     WHERE status = 'completed' AND doc_type IN ('sale','sale_return')
       AND issued_at >= ? AND issued_at <= ?
     GROUP BY doc_type`,
    [dateFrom, dateTo],
  );
  return {
    sales: dec(rows.find((r) => r.doc_type === 'sale')?.s ?? 0),
    returns: dec(rows.find((r) => r.doc_type === 'sale_return')?.s ?? 0),
  };
}

export async function getDashboard(): Promise<DashboardData> {
  const today = todayISO();
  const base = await getBaseCurrency();
  const db = await getDb();

  // ===== مبيعات اليوم وعدد فواتيره =====
  const dayRow = await netSalesBase(today, today);
  const todaySales = dayRow.sales.minus(dayRow.returns);
  const invCountRows = await db.all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM invoice WHERE doc_type = 'sale' AND status = 'completed' AND issued_at = ?",
    [today],
  );
  const todayInvoices = Number(invCountRows[0]?.n ?? 0);

  // ===== أرباح اليوم — الصيغة الملزمة (قرار 7) ليوم واحد =====
  const todayPl = await profitLoss({ dateFrom: today, dateTo: today });

  // ===== صافي الصناديق بالأساس (آخر سعر معروف لكل عملة) =====
  const balances = await cashboxBalances();
  let netCash = dec(0);
  for (const b of balances) {
    if (b.currencyId === base.id) {
      netCash = netCash.plus(dec(b.balance));
    } else {
      const rate = await getLatestRate(b.currencyId);
      if (rate !== null) netCash = netCash.plus(dec(b.balance).times(dec(rate)));
    }
  }

  // ===== مبيعات الشهر + نسبة التغير مقابل الشهر السابق حتى اليوم المماثل =====
  const mStart = monthStart(today);
  const month = await netSalesBase(mStart, today);
  const monthSales = month.sales.minus(month.returns);
  const prevEnd = shiftMonth(today, -1);
  const prev = await netSalesBase(monthStart(prevEnd), prevEnd);
  const prevSales = prev.sales.minus(prev.returns);
  let monthSalesChangePct: string | null = null;
  if (prevSales.greaterThan(0)) {
    const pct = monthSales.minus(prevSales).div(prevSales).times(100);
    monthSalesChangePct = money(roundTo(pct, 1));
  }

  // ===== 30 يوماً أخيرة (للرسم) =====
  const from30 = shiftDay(today, -29);
  const rows30 = await db.all<{ d: string; sale: string | number; ret: string | number }>(
    `SELECT issued_at AS d,
            SUM(CASE WHEN doc_type = 'sale' THEN total_base ELSE 0 END) AS sale,
            SUM(CASE WHEN doc_type = 'sale_return' THEN total_base ELSE 0 END) AS ret
     FROM invoice
     WHERE status = 'completed' AND doc_type IN ('sale','sale_return') AND issued_at >= ?
     GROUP BY issued_at`,
    [from30],
  );
  const byDate = new Map(rows30.map((r) => [r.d, dec(r.sale).minus(dec(r.ret))]));
  const last30: { date: string; sales: string }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = shiftDay(today, -i);
    last30.push({ date: d, sales: money(byDate.get(d) ?? 0) });
  }

  // ===== أعلى 5 أصناف بالشهر (صافي بعد المرتجعات، بالأساس) =====
  const topRows = await db.all<{ product_id: number; name: string; qty: string | number; s: string | number }>(
    `SELECT it.product_id, COALESCE(p.name, it.line_desc, 'سطر حر') AS name,
            SUM(CASE WHEN i.doc_type = 'sale' THEN it.qty ELSE -it.qty END) AS qty,
            SUM(CASE WHEN i.doc_type = 'sale' THEN it.line_total ELSE -it.line_total END * i.exchange_rate) AS s
     FROM invoice_item it
     JOIN invoice i ON i.id = it.invoice_id
     LEFT JOIN product p ON p.id = it.product_id
     WHERE i.status = 'completed' AND i.doc_type IN ('sale','sale_return')
       AND i.issued_at >= ? AND i.issued_at <= ? AND it.product_id IS NOT NULL
     GROUP BY it.product_id
     ORDER BY s DESC
     LIMIT 5`,
    [mStart, today],
  );
  const topProducts = topRows.map((r) => ({
    name: String(r.name),
    qty: money(dec(r.qty)),
    sales: money(roundTo(dec(r.s), 4)),
  }));

  // ===== بطاقات التنبيه =====
  const [dueInstallments, minStock, dueCheques] = await Promise.all([
    installmentsDue({ withinDays: 0 }).catch(() => []),
    listBelowMinStock().catch(() => []),
    dueSoonCheques(7).catch(() => []),
  ]);

  return {
    todaySales: money(roundTo(todaySales, 4)),
    todayProfit: todayPl.netProfit,
    todayInvoices,
    netCashBase: money(roundTo(netCash, 4)),
    monthSales: money(roundTo(monthSales, 4)),
    monthSalesChangePct,
    last30,
    topProducts,
    dueInstallmentsCount: dueInstallments.length,
    minStockCount: minStock.length,
    dueChequesCount: dueCheques.length,
  };
}
