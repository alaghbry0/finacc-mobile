/**
 * بطاقة صنف + ملخص حركة المخزون (FR-09-03/04).
 *
 * productCard: كل حركات صنف بالباقي التراكمي لفترة/مخزن (اختياري كلٌّ منهما)
 * — الوارد موجب والصادر سالب في stock_movement أصلاً، فالرصيد التراكمي
 * مجموع بسيط للكميات، وunit_cost لقطة وقت الحركة (WAC يومها أو تكلفة الجرد).
 *
 * stockSummary: ملخص لكل صنف (وارد/صادر/مرتجع/تسوية) — خريطة الأعمدة الموثقة:
 *   in      = purchase + transfer_in + opening (وارد فعلي — الافتتاحية داخل
 *             الفترة تُعرض وارداً لأنها ملك حركة المخزون لا تسوية)
 *   out     = sale + purchase_return + transfer_out (صادر فعلي)
 *   returns = sale_return                  (مرتجع بيع عائد للمخزن — موجب)
 *   adjust  = stocktake_adjust + manual_adjust (موقّعة: زيادة+/عجز−)
 *   closing = opening + in + out + returns + adjust
 */
import { getDb } from '@/db/client';
import { dec, money } from '@/utils/money';

export interface StockCardOpts {
  dateFrom?: string;
  dateTo?: string;
  warehouseId?: number;
}

export interface StockCardLine {
  date: string;
  type: string;
  refNo: string | null;
  in: string;
  out: string;
  balance: string;
  unitCost: string;
}

export interface StockCard {
  opening: string;
  lines: StockCardLine[];
  closing: string;
}

// ============ بطاقة صنف (FR-09-03) ============

export async function productCard(productId: number, opts: StockCardOpts = {}): Promise<StockCard> {
  const db = await getDb();

  // الرصيد الافتتاحي = مجموع كل الحركات **قبل** dateFrom (بلا فترة → صفر: كل شيء داخل الكشف)
  const openParams: unknown[] = [productId];
  if (opts.warehouseId !== undefined) openParams.push(opts.warehouseId);
  if (opts.dateFrom !== undefined) openParams.push(opts.dateFrom);
  const openingRows =
    opts.dateFrom === undefined
      ? [{ s: '0' as string | number }]
      : await db.all<{ s: string | number }>(
          `SELECT SUM(qty) AS s FROM stock_movement WHERE product_id = ?` +
            (opts.warehouseId !== undefined ? ' AND warehouse_id = ?' : '') +
            ' AND substr(moved_at, 1, 10) < ?',
          openParams,
        );
  let balance = dec(openingRows[0]?.s ?? 0);
  const opening = money(balance);

  // حركات الفترة (مصدر الرقم: ref_type='invoice' → invoice_no وإلا فالوصف/لا شيء)
  const lineParams: unknown[] = [productId];
  if (opts.warehouseId !== undefined) lineParams.push(opts.warehouseId);
  if (opts.dateFrom !== undefined) lineParams.push(opts.dateFrom);
  if (opts.dateTo !== undefined) lineParams.push(opts.dateTo);
  const moves = await db.all<{
    moved_at: string; movement_type: string; qty: string | number; unit_cost: string | number;
    ref_type: string | null; ref_id: number | null; invoice_no: string | null;
  }>(
    `SELECT m.moved_at, m.movement_type, m.qty, m.unit_cost, m.ref_type, m.ref_id, i.invoice_no
     FROM stock_movement m
     LEFT JOIN invoice i ON m.ref_type = 'invoice' AND i.id = m.ref_id
     WHERE m.product_id = ?` +
      (opts.warehouseId !== undefined ? ' AND m.warehouse_id = ?' : '') +
      (opts.dateFrom !== undefined ? ' AND substr(m.moved_at, 1, 10) >= ?' : '') +
      (opts.dateTo !== undefined ? ' AND substr(m.moved_at, 1, 10) <= ?' : '') +
      ` ORDER BY m.moved_at ASC, m.id ASC`,
    lineParams,
  );

  const lines: StockCardLine[] = moves.map((m) => {
    const qty = dec(m.qty);
    balance = balance.plus(qty);
    return {
      date: String(m.moved_at).slice(0, 10),
      type: String(m.movement_type),
      refNo: (m.invoice_no as string | null) ?? null,
      in: qty.greaterThan(0) ? money(qty) : '0',
      out: qty.lessThan(0) ? money(qty.abs()) : '0',
      balance: money(balance),
      unitCost: money(dec(m.unit_cost)),
    };
  });

  return { opening, lines, closing: money(balance) };
}

// ============ ملخص حركة المخزون (FR-09-04) ============

export interface StockSummaryRow {
  id: number;
  name: string;
  opening: string;
  in: string;
  out: string;
  returns: string;
  adjust: string;
  closing: string;
}

const IN_TYPES = ['purchase', 'transfer_in', 'opening'];
const OUT_TYPES = ['sale', 'purchase_return', 'transfer_out'];
const RETURN_TYPES = ['sale_return'];
const ADJUST_TYPES = ['stocktake_adjust', 'manual_adjust'];

export async function stockSummary(
  opts: { dateFrom: string; dateTo: string },
): Promise<{ rows: StockSummaryRow[] }> {
  const db = await getDb();

  // الرصيد قبل بداية الفترة لكل صنف (بما فيه الخدمي؟ لا — الخدمي بلا مخزون أصلاً فحركاته معدومة)
  const openingRows = await db.all<{ product_id: number; s: string | number }>(
    `SELECT product_id, SUM(qty) AS s FROM stock_movement
     WHERE substr(moved_at, 1, 10) < ? GROUP BY product_id`,
    [opts.dateFrom],
  );
  const opening = new Map(openingRows.map((r) => [Number(r.product_id), dec(r.s)]));

  // مجاميع الفترة حسب الصنف والنوع
  const periodRows = await db.all<{ product_id: number; movement_type: string; s: string | number }>(
    `SELECT product_id, movement_type, SUM(qty) AS s FROM stock_movement
     WHERE substr(moved_at, 1, 10) >= ? AND substr(moved_at, 1, 10) <= ?
     GROUP BY product_id, movement_type`,
    [opts.dateFrom, opts.dateTo],
  );
  const perProduct = new Map<number, Map<string, ReturnType<typeof dec>>>();
  for (const r of periodRows) {
    const pid = Number(r.product_id);
    let m = perProduct.get(pid);
    if (m === undefined) {
      m = new Map();
      perProduct.set(pid, m);
    }
    const t = String(r.movement_type);
    m.set(t, (m.get(t) ?? dec(0)).plus(dec(r.s)));
  }

  // كل الأصناف غير المؤرشفة (حتى أصناف الفترة الخدمية تظهر بأصفار — لا: نستثني الخدمي)
  const products = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM product WHERE is_archived = 0 AND is_service = 0 ORDER BY name COLLATE NOCASE ASC LIMIT 500',
  );

  const sumOf = (pid: number, types: string[]): ReturnType<typeof dec> => {
    const m = perProduct.get(pid);
    if (m === undefined) return dec(0);
    return types.reduce((acc, t) => acc.plus(m.get(t) ?? 0), dec(0));
  };

  const rows: StockSummaryRow[] = products.map((p) => {
    const pid = Number(p.id);
    const open = dec(opening.get(pid) ?? 0);
    const inQ = sumOf(pid, IN_TYPES);
    const outQ = sumOf(pid, OUT_TYPES);
    const returnsQ = sumOf(pid, RETURN_TYPES);
    const adjustQ = sumOf(pid, ADJUST_TYPES);
    return {
      id: pid,
      name: String(p.name),
      opening: money(open),
      in: money(inQ),
      out: money(outQ),
      returns: money(returnsQ),
      adjust: money(adjustQ),
      closing: money(open.plus(inQ).plus(outQ).plus(returnsQ).plus(adjustQ)),
    };
  });

  return { rows };
}
