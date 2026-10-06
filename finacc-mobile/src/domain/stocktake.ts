/**
 * الجرد الفعلي (FR-01-08 + AC-04 + قرار 7): شاشة جرد للمخزن تعرض الرصيد الدفتري
 * وإدخال الرصيد الفعلي، وتولّد تسوية الفرق كحركة جرد موقّعة
 * **بتكلفة لقطة وقت الجرد (stocktake_line.unit_cost)** — لا تُعاد لاحقاً بـ WAC متغير.
 *
 * دورة الحياة: startStocktake (status='draft' — DDL بلا CHECK على status فيسمح بذلك
 * رغم أن الافتراضي 'completed') → عدّ الأصناف عبر setCountedLine (لقطة book_qty
 * وunit_cost عند أول عدّ) → applyStocktake (معاملة واحدة: حركة stocktake_adjust لكل
 * فرق ≠ 0 + تحديث stock_level + منع السالب برسالة تسمّي الصنف + status='completed'
 * + total_diff + logAudit('stocktake')).
 *
 * أثر الجرد في الربح (قرار 7): زيادة الجرد وارد في الصيغة وعجزه خسارة —
 * تُشتق تقارير الأرباح من حركات stocktake_adjust نفسها (posting-map: _gain/_loss).
 *
 * «الجرد يقفل الأرصدة» (AC-04): بعد الاعتماد status='completed' وأي محاولة عدّ
 * أو اعتماد لاحقة تُرفض — التعديل بعد القفل = جرد جديد.
 */
import { z } from 'zod';
import { getDb } from '@/db/client';
import type { DbEngine } from '@/db/types';
import { dec, money } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getCurrentUserId } from './session-user';
import { logAudit } from './audit';
import { assertPeriodOpen } from './fiscal';

// ============ التسلسل (نفس قرار invoicing — محرك sql.js بلا معاملات متوازية) ============

let writeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown, context: string): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error!.issues[0];
    throw new Error(
      `${context}: ${issue?.message ?? 'راجع الحقول المدخلة'} ` +
        `(الحقل: ${issue?.path?.join('.') ?? '?'})`,
    );
  }
  return parsed.data as z.output<T>;
}

const CountedQtySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'الكمية الفعلية رقم موجب — العدّ لا ينتج سالباً');

// ============ الصفوف والعقود ============

export interface StocktakeLineRow {
  productId: number;
  name: string;
  bookQty: string;
  countedQty: string | null;
  diffQty: string | null;
  unitCost: string;
}

export interface StocktakeRow {
  id: number;
  warehouseId: number;
  warehouseName: string;
  countedAt: string;
  status: string;
  totalDiff: string;
  notes: string | null;
  lines: number;
  adjustments: number;
}

// ============ بدء الجرد ============

export async function startStocktake(warehouseId: number, notes?: string): Promise<number> {
  return runSerialized(async () => {
    const db = await getDb();
    const wh = await db.all<{ id: number; name: string; is_archived: number }>(
      'SELECT id, name, is_archived FROM warehouse WHERE id = ?',
      [warehouseId],
    );
    const w = wh[0];
    if (w === undefined || Number(w.is_archived) === 1) {
      throw new Error(`المستودع (رقم ${warehouseId}) غير موجود أو مؤرشف — اختر مستودعاً صالحاً`);
    }
    const now = new Date().toISOString();
    const cleanNotes = (notes ?? '').trim();
    const res = await db.run(
      "INSERT INTO stocktake(warehouse_id, counted_at, total_diff, status, notes, created_at, created_by) " +
        "VALUES(?, ?, 0, 'draft', ?, ?, ?)",
      [warehouseId, now, cleanNotes !== '' ? cleanNotes : null, now, getCurrentUserId() ?? null],
    );
    await logAudit('stocktake_started', {
      entity: 'stocktake',
      entityId: Number(res.lastInsertRowId),
      details: { warehouseId, warehouseName: w.name },
    });
    return Number(res.lastInsertRowId);
  });
}

// ============ أصناف الجرد (الدفتري + الفعلي + الفرق) ============

/**
 * كل الأصناف المخزنية الفاعلة في مستودع الجرد: الدفتري من stock_level الحالي،
 * والفعلي/الفرق من stocktake_line (لقطة أول عدّ) — null = لم يُعدّ بعد.
 */
export async function stocktakeLines(stocktakeId: number): Promise<StocktakeLineRow[]> {
  const db = await getDb();
  const st = await loadDraftable(db, stocktakeId, false);
  const rows = await db.all<{
    product_id: number; name: string; book: string | number | null;
    counted: string | number | null; diff: string | number | null; unit_cost: string | number | null;
  }>(
    `SELECT p.id AS product_id, p.name,
            COALESCE(sl.book_qty, sl2.qty, 0) AS book,
            sl.counted_qty AS counted, sl.diff_qty AS diff,
            COALESCE(sl.unit_cost, p.cost_price, 0) AS unit_cost
     FROM product p
     LEFT JOIN stocktake_line sl ON sl.product_id = p.id AND sl.stocktake_id = ?
     LEFT JOIN stock_level sl2 ON sl2.product_id = p.id AND sl2.warehouse_id = ?
     WHERE p.is_archived = 0 AND p.is_service = 0
     ORDER BY (sl.counted_qty IS NULL) ASC, p.name COLLATE NOCASE ASC`,
    [stocktakeId, st.warehouseId],
  );
  return rows.map((r) => ({
    productId: Number(r.product_id),
    name: String(r.name),
    bookQty: money(dec(r.book)),
    countedQty: r.counted === null || r.counted === undefined ? null : money(dec(r.counted)),
    diffQty: r.diff === null || r.diff === undefined ? null : money(dec(r.diff)),
    unitCost: money(dec(r.unit_cost ?? 0)),
  }));
}

// ============ إدخال عدّ صنف ============

/** تسجيل الكمية الفعلية لصنف — لقطة book_qty وunit_cost عند أول عدّ فقط (لا تتغير بعدها). */
export async function setCountedLine(stocktakeId: number, productId: number, countedQty: string): Promise<void> {
  const qty = parseOrThrow(CountedQtySchema, countedQty, 'كمية العدّ غير صالحة');
  return runSerialized(async () => {
    const db = await getDb();
    await db.transaction(async () => {
      const st = await loadDraftable(db, stocktakeId, true);

      const prod = await db.all<{ name: string; is_service: number; is_archived: number; cost_price: string | number }>(
        'SELECT name, is_service, is_archived, cost_price FROM product WHERE id = ?',
        [productId],
      );
      const p = prod[0];
      if (p === undefined || Number(p.is_archived) === 1) {
        throw new Error(`صنف غير موجود أو مؤرشف (رقم ${productId}) — أعد فتح قائمة الجرد`);
      }
      if (Number(p.is_service) === 1) {
        throw new Error(`الصنف «${p.name}» خدمي وبلا مخزون — لا يُعدّ في الجرد`);
      }

      // منع الناقص مطلقاً (قرار 9): العدّ لا ينتج رصيداً سالباً — برسالة تسمّي الصنف
      const counted = dec(qty);
      if (counted.isNegative()) {
        throw new Error(
          `الرصيد الفعلي للصنف «${p.name}» لا يمكن أن يكون سالباً (${counted.toString()}) — راجع العدد المدخل`,
        );
      }

      const existing = await db.all<{ id: number; book_qty: string | number }>(
        'SELECT id, book_qty FROM stocktake_line WHERE stocktake_id = ? AND product_id = ?',
        [stocktakeId, productId],
      );
      const now = new Date().toISOString();
      if (existing.length > 0) {
        // تحديث لاحق: الدفتري لقطة أول عدّ لا تتغير — الفرق يعاد حسابه عليها
        const book = dec(existing[0]!.book_qty);
        await db.run('UPDATE stocktake_line SET counted_qty = ?, diff_qty = ? WHERE id = ?', [
          money(counted),
          money(counted.minus(book)),
          Number(existing[0]!.id),
        ]);
        return;
      }

      // أول عدّ: لقطة الدفتري من stock_level الحالي + لقطة التكلفة من cost_price (WAC الجاري)
      const lvl = await db.all<{ qty: string | number }>(
        'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
        [productId, st.warehouseId],
      );
      const book = dec(lvl[0]?.qty ?? 0);
      await db.run(
        'INSERT INTO stocktake_line(stocktake_id, product_id, book_qty, counted_qty, diff_qty, unit_cost, created_at, created_by) ' +
          'VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        [stocktakeId, productId, money(book), money(counted), money(counted.minus(book)), money(dec(p.cost_price ?? 0)), now, getCurrentUserId() ?? null],
      );
    });
  });
}

// ============ الاعتماد والتسوية ============

/**
 * اعتماد الجرد (معاملة واحدة): لكل فرق ≠ 0 حركة stocktake_adjust موقّعة بتكلفة
 * لقطة العدّ + تحديث stock_level + منع السالب برسالة تسمّي الصنف، ثم قفل الجرد
 * (status='completed' + total_diff) وlogAudit('stocktake').
 */
export async function applyStocktake(
  stocktakeId: number,
  opts: { managerConfirmed?: boolean } = {},
): Promise<{ adjustments: number }> {
  return runSerialized(async () => {
    const db = await getDb();
    return db.transaction(async () => {
      const st = await loadDraftable(db, stocktakeId, true);
      await assertPeriodOpen(todayISO());

      const lines = await db.all<{
        product_id: number; name: string; book_qty: string | number;
        counted_qty: string | number; diff_qty: string | number; unit_cost: string | number;
      }>(
        `SELECT sl.product_id, p.name, sl.book_qty, sl.counted_qty, sl.diff_qty, sl.unit_cost
         FROM stocktake_line sl JOIN product p ON p.id = sl.product_id
         WHERE sl.stocktake_id = ? AND sl.diff_qty <> 0
         ORDER BY p.name COLLATE NOCASE ASC`,
        [stocktakeId],
      );

      const now = st.countedAt;
      let totalDiff = dec(0);
      let adjustments = 0;

      for (const ln of lines) {
        const diff = dec(ln.diff_qty);
        const name = String(ln.name);
        const productId = Number(ln.product_id);

        // الرصيد الدفتري الحالي (قد يكون تغيّر بعد لقطة العدّ — التسوية تُطبق على الراهن)
        const lvl = await db.all<{ qty: string | number }>(
          'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
          [productId, st.warehouseId],
        );
        const current = dec(lvl[0]?.qty ?? 0);
        const newQty = current.plus(diff);

        // منع السالب المطلق (قرار 9) — برسالة تسمّي الصنف والكمية الناقصة
        if (newQty.isNegative()) {
          throw new Error(
            `رصيد الصنف «${name}» لا يمكن أن يكون سالباً — التسوية المطلوبة (${money(diff)}) ` +
              `تنقص عن الرصيد الحالي (${money(current)}) بمقدار ${money(newQty.abs())} وحدة. راجع العدّ أو سجّل الجرد بعد وقف البيع`,
          );
        }

        await db.run(
          'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
            "VALUES(?, ?, 'stocktake_adjust', ?, ?, 'stocktake', ?, ?, ?, ?, ?)",
          [
            productId,
            st.warehouseId,
            money(diff),
            money(dec(ln.unit_cost)),
            stocktakeId,
            now,
            'تسوية جرد فعلي',
            new Date().toISOString(),
            getCurrentUserId() ?? null,
          ],
        );

        if (lvl.length > 0) {
          await db.run(
            'UPDATE stock_level SET qty = ? WHERE product_id = ? AND warehouse_id = ?',
            [money(newQty), productId, st.warehouseId],
          );
        } else {
          await db.run(
            'INSERT INTO stock_level(product_id, warehouse_id, qty) VALUES(?, ?, ?)',
            [productId, st.warehouseId, money(newQty)],
          );
        }

        totalDiff = totalDiff.plus(diff);
        adjustments += 1;
      }

      await db.run("UPDATE stocktake SET status = 'completed', total_diff = ? WHERE id = ?", [
        money(totalDiff),
        stocktakeId,
      ]);

      await logAudit('stocktake', {
        entity: 'stocktake',
        entityId: stocktakeId,
        details: {
          warehouseId: st.warehouseId,
          warehouseName: st.warehouseName,
          adjustments,
          totalDiff: money(totalDiff),
          managerConfirmed: opts.managerConfirmed === true,
        },
      });

      return { adjustments };
    });
  });
}

// ============ سجل الجرد ============

export async function listStocktakes(limit = 50): Promise<StocktakeRow[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: number; warehouse_id: number; warehouse_name: string; counted_at: string;
    status: string; total_diff: string | number; notes: string | null;
    lines: number; adjustments: number;
  }>(
    `SELECT st.id, st.warehouse_id, w.name AS warehouse_name, st.counted_at, st.status, st.total_diff, st.notes,
            (SELECT COUNT(*) FROM stocktake_line sl WHERE sl.stocktake_id = st.id) AS lines,
            (SELECT COUNT(*) FROM stock_movement m WHERE m.ref_type = 'stocktake' AND m.ref_id = st.id) AS adjustments
     FROM stocktake st JOIN warehouse w ON w.id = st.warehouse_id
     ORDER BY st.counted_at DESC, st.id DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    warehouseId: Number(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    countedAt: String(r.counted_at),
    status: String(r.status),
    totalDiff: money(dec(r.total_diff)),
    notes: (r.notes as string | null) ?? null,
    lines: Number(r.lines),
    adjustments: Number(r.adjustments),
  }));
}

// ============ مساعد داخلي ============

interface StocktakeHead {
  id: number;
  warehouseId: number;
  warehouseName: string;
  countedAt: string;
  status: string;
}

/** رأس صف الجرد + فحص أنه ما يزال مفتوحاً (status='draft') عند الطلب. */
async function loadDraftable(db: DbEngine, stocktakeId: number, mustBeDraft: boolean): Promise<StocktakeHead> {
  const rows = await db.all<{
    id: number; warehouse_id: number; warehouse_name: string; counted_at: string; status: string;
  }>(
    'SELECT st.id, st.warehouse_id, w.name AS warehouse_name, st.counted_at, st.status ' +
      'FROM stocktake st JOIN warehouse w ON w.id = st.warehouse_id WHERE st.id = ?',
    [stocktakeId],
  );
  const st = rows[0];
  if (st === undefined) {
    throw new Error(`جرد غير موجود (رقم ${stocktakeId}) — أعد فتح شاشة الجرد من البداية`);
  }
  if (mustBeDraft && String(st.status) !== 'draft') {
    throw new Error('هذا الجرد معتمد ومقفل بالفعل — أي تصحيح يتطلب جرداً جديداً (سجل الحركات لا يُعدَّل أبداً)');
  }
  return {
    id: Number(st.id),
    warehouseId: Number(st.warehouse_id),
    warehouseName: String(st.warehouse_name),
    countedAt: String(st.counted_at),
    status: String(st.status),
  };
}
