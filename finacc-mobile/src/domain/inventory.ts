import { z } from 'zod';
import { getDb } from '@/db/client';
import { dec, money, Decimal } from '@/utils/money';
import { generateEan13 } from '@/utils/barcode';
import { assertPeriodOpen } from './fiscal';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';
import { getBaseCurrency } from './currency';

/**
 * وحدة الأصناف والمخزون (الوحدة 01 — FR-01-01..09, 12, 15, 16):
 * - كل المبالغ Decimal نصية عبر dec/money (لا Float أبداً — قاعدة 5.2-3).
 * - كل كتابة بتاريخ تستدعي assertPeriodOpen (حجاب الفترات — قاعدة 5.4-11).
 * - الأحداث الحساسة (إنشاء/تعديل/أرشفة صنف، تعديل رصيد) تُقيَّد في audit_log.
 * - الباركود فريد ويبقى محجوزاً بعد الأرشفة (FR-01-01/15): التفرد عبر استعلام
 *   يشمل المؤرشف (وليس UNIQUE index فقط) لرسالة عربية واضحة.
 * - الصنف الخدمي بلا مخزون إطلاقاً (FR-01-16) — كمية افتتاحية له → خطأ.
 * - المؤجل إلى V1.1 (موثق في worklog): استيراد Excel (FR-01-13)، تحويل المخازن
 *   (FR-01-09)، الدفعات/FEFO (FR-01-10)، تحديث الأسعار بالصرف (FR-01-11).
 */

// ============ الأنواع العامة ============

export interface ProductPriceInput {
  currencyId: number;
  price: string;
}

export interface ProductInput {
  name: string;
  barcode?: string;
  categoryId?: number;
  unitId?: number;
  costPrice?: string;
  minStock?: string;
  isService?: boolean;
  notes?: string;
  /** أسعار البيع بمستوى retail فقط في V1 (قرار 5). */
  prices: ProductPriceInput[];
  /** الحركة الافتتاحية (غير الخدمي فقط) — تُنشأ مرة واحدة عند الإنشاء. */
  openingQty?: string;
  openingWarehouseId?: number;
  openingCost?: string;
}

export interface ProductPriceRow {
  currencyId: number;
  code: string;
  name: string;
  decimals: number;
  isBase: boolean;
  price: string;
}

export interface ProductStockRow {
  warehouseId: number;
  warehouseName: string;
  isDefault: boolean;
  qty: string;
}

export interface StockMovementRow {
  id: number;
  warehouseId: number;
  warehouseName: string | null;
  movementType: string;
  /** موجب/سالب نصاً — يُعرض مع إشارة عبر AmountText. */
  qty: string;
  unitCost: string;
  refType: string | null;
  refId: number | null;
  movedAt: string;
  notes: string | null;
}

export interface ProductRowFull {
  id: number;
  name: string;
  barcode: string | null;
  categoryId: number | null;
  categoryName: string | null;
  unitId: number | null;
  unitName: string | null;
  costPrice: string;
  minStock: string;
  isService: boolean;
  isArchived: boolean;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  totalQty: string;
  prices: ProductPriceRow[];
  stocks: ProductStockRow[];
  movements: StockMovementRow[];
}

export interface ProductListRow {
  id: number;
  name: string;
  barcode: string | null;
  categoryId: number | null;
  isService: boolean;
  isArchived: boolean;
  /** الرصيد الكلي عبر كل المخازن (FR-01-06). */
  totalQty: string;
  /** سعر retail بالعملة الأساسية أو null. */
  basePrice: string | null;
  costPrice: string;
  minStock: string;
  /** الرصيد الكلي تحت الحد الأدنى (FR-01-12). */
  belowMin: boolean;
}

export interface CategoryNode {
  id: number;
  name: string;
  children: CategoryNode[];
}

export interface UnitRow {
  id: number;
  name: string;
  baseUnitId: number | null;
  /** معامل التحويل للوحدة الأساس (1 كرتون = 24 قطعة — FR-01-05). */
  factor: string;
  isArchived: boolean;
}

export interface WarehouseRow {
  id: number;
  name: string;
  isDefault: boolean;
}

// ============ أدوات داخلية ============

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** قيمة اختيارية مُطهّرة: '' أو فراغات → undefined (لتطبيع مدخلات النماذج قبل zod). */
function normOpt(v: string | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** جزء التاريخ YYYY-MM-DD من الطابع الحالي — لحجاب الفترات (قاعدة 5.4-11). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** تهريب محارف LIKE الخاصة (% و _) أثناء بحث المستخدم الحر. */
function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** مطالبة صف SQL الخام لصف قائمة الأصناف. */
interface ProductListSqlRow {
  id: number;
  name: string;
  barcode: string | null;
  category_id: number | null;
  is_service: number;
  is_archived: number;
  cost_price: string | number | null;
  min_stock: string | number | null;
  total_qty: string | number | null;
  base_price: string | number | null;
}

function toListRow(r: ProductListSqlRow): ProductListRow {
  const isService = Number(r.is_service) === 1;
  const totalQty = money(r.total_qty ?? 0);
  const minStock = money(r.min_stock ?? 0);
  return {
    id: Number(r.id),
    name: r.name,
    barcode: r.barcode,
    categoryId: r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
    isService,
    isArchived: Number(r.is_archived) === 1,
    totalQty,
    basePrice: r.base_price === null || r.base_price === undefined ? null : money(r.base_price),
    costPrice: money(r.cost_price ?? 0),
    minStock,
    belowMin: !isService && dec(totalQty).lessThan(minStock),
  };
}

/** جملة SELECT الموحدة لصف قائمة صنف (الرصيد الكلي + سعر retail بالعملة الأساس). */
const PRODUCT_LIST_SELECT = `
  SELECT p.id AS id, p.name AS name, p.barcode AS barcode, p.category_id AS category_id,
         p.is_service AS is_service, p.is_archived AS is_archived,
         p.cost_price AS cost_price, p.min_stock AS min_stock,
         COALESCE((SELECT SUM(sl.qty) FROM stock_level sl WHERE sl.product_id = p.id), 0) AS total_qty,
         (SELECT pp.price FROM product_price pp
           WHERE pp.product_id = p.id AND pp.price_level = 'retail' AND pp.currency_id = ?) AS base_price
  FROM product p`;

// ============ مخطط zod ============

const decimalMsg = (field: string) =>
  `قيمة «${field}» يجب أن تكون رقماً عشرياً غير سالب مثل «12500.50»`;

const optionalDecimal = (field: string) =>
  z.string().regex(DECIMAL_RE, decimalMsg(field)).optional();

const ProductPriceSchema = z.object({
  currencyId: z.number().int().positive('رقم العملة غير صالح'),
  price: optionalDecimal('سعر البيع'),
});

const ProductInputSchema = z.object({
  name: z
    .string({ message: 'اسم الصنف مطلوب' })
    .trim()
    .min(1, 'اسم الصنف مطلوب — أدخل اسم الصنف كما يُنادى في المتجر')
    .max(200, 'اسم الصنف طويل جداً (الحد 200 حرف)'),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{3,32}$/, 'الباركود يجب أن يكون 3–32 خانة: أرقام أو حرفاً لاتينياً أو شرطة — أو اتركه فارغاً ليولَّد تلقائياً')
    .optional(),
  categoryId: z.number().int().positive('فئة غير صالحة').optional(),
  unitId: z.number().int().positive('وحدة غير صالحة').optional(),
  costPrice: optionalDecimal('سعر التكلفة'),
  minStock: optionalDecimal('الحد الأدنى'),
  isService: z.boolean().optional(),
  notes: z.string().trim().max(1000, 'الملاحظات طويلة جداً (الحد 1000 حرف)').optional(),
  prices: z.array(ProductPriceSchema).max(20, 'عدد أسعار كبير بشكل غير منطقي').default([]),
  openingQty: optionalDecimal('الكمية الافتتاحية'),
  openingWarehouseId: z.number().int().positive('مستودع غير صالح').optional(),
  openingCost: optionalDecimal('تكلفة الكمية الافتتاحية'),
});

const AdjustStockSchema = z.object({
  productId: z.number().int().positive('رقم الصنف غير صالح'),
  warehouseId: z.number().int().positive('رقم المستودع غير صالح'),
  newQty: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'الكمية الجديدة يجب أن تكون رقماً مثل «15» أو «2.5»'),
  reason: z.string().trim().max(200, 'سبب التعديل طويل جداً (الحد 200 حرف)').optional(),
});

/** تطبيع مدخلات النموذج (فراغات → undefined، أسعار فارغة تُستبعد) قبل zod. */
function normalizeInput(input: ProductInput) {
  return {
    name: input.name ?? '',
    barcode: normOpt(input.barcode),
    categoryId: input.categoryId && input.categoryId > 0 ? input.categoryId : undefined,
    unitId: input.unitId && input.unitId > 0 ? input.unitId : undefined,
    costPrice: normOpt(input.costPrice),
    minStock: normOpt(input.minStock),
    isService: input.isService === true,
    notes: normOpt(input.notes),
    prices: (input.prices ?? [])
      .map((p) => ({ currencyId: p.currencyId, price: normOpt(p.price) }))
      .filter((p): p is { currencyId: number; price: string } => p.price !== undefined),
    openingQty: normOpt(input.openingQty),
    openingWarehouseId:
      input.openingWarehouseId && input.openingWarehouseId > 0 ? input.openingWarehouseId : undefined,
    openingCost: normOpt(input.openingCost),
  };
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

/** التحقق من وجود صف مرجعي (فئة/وحدة/عملة/مستودع) برسالة عربية موحدة. */
async function assertRefExists(table: string, id: number, labelAr: string): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{ id: number }>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (rows.length === 0) {
    throw new Error(`${labelAr} (رقم ${id}) غير موجود — راجع قوائم الإدارة ثم أعد المحاولة`);
  }
}

/** الباركود محجوز حتى بعد الأرشفة (FR-01-01): الفحص باستعلام يشمل المؤرشف. */
async function assertBarcodeFree(
  barcode: string,
  labelAr: string,
  excludeProductId?: number,
): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{ id: number }>('SELECT id FROM product WHERE barcode = ?', [barcode]);
  const other = rows.find((r) => excludeProductId === undefined || Number(r.id) !== excludeProductId);
  if (other !== undefined) {
    throw new Error(
      `الباركود «${barcode}» مستخدم بالفعل ${labelAr} (رقم ${Number(other.id)}) — ` +
        'الباركود يبقى محجوزاً حتى بعد أرشفة صنفه، أدخل باركوداً آخر أو اترك الحقل فارغاً ليولَّد تلقائياً',
    );
  }
}

// ============ إنشاء صنف (FR-01-01) ============

export async function createProduct(input: ProductInput): Promise<number> {
  const v = parseOrThrow(ProductInputSchema, normalizeInput(input), 'مدخلات الصنف غير مكتملة');

  // الصنف الخدمي بلا مخزون إطلاقاً (FR-01-16)
  if (v.isService && (v.openingQty !== undefined || v.openingWarehouseId !== undefined)) {
    throw new Error(
      'الصنف الخدمي بلا مخزون — لا يمكن إدخال كمية افتتاحية أو مستودع لصنف خدمي. ' +
        'أزل علامة «صنف خدمي» إن أردت تتبع المخزون',
    );
  }

  const db = await getDb();
  const now = nowISO();
  let productId = 0;

  await db.transaction(async () => {
    // حجاب الفترات لكل كتابة بتاريخ (قاعدة 5.4-11)
    await assertPeriodOpen(todayISO());

    // الباركود: فارغ → توليد EAN-13 داخلي (FR-01-02)؛ مُدخل → حجز فريد
    let barcode: string;
    if (v.barcode === undefined) {
      barcode = generateEan13();
      // حماية من تصادم نظري (1 من 10^11) — إعادة المحاولة ثم فحص نهائي
      for (let attempt = 0; attempt < 5; attempt++) {
        const taken = await db.all<{ id: number }>('SELECT id FROM product WHERE barcode = ?', [barcode]);
        if (taken.length === 0) break;
        barcode = generateEan13();
      }
      await assertBarcodeFree(barcode, 'لصنف آخر');
    } else {
      barcode = v.barcode;
      await assertBarcodeFree(barcode, 'لصنف آخر');
    }

    if (v.categoryId !== undefined) await assertRefExists('category', v.categoryId, 'الفئة');
    if (v.unitId !== undefined) await assertRefExists('unit', v.unitId, 'وحدة القياس');
    for (const p of v.prices) {
      await assertRefExists('currency', p.currencyId, 'العملة');
    }

    const res = await db.run(
      'INSERT INTO product(name, barcode, category_id, unit_id, cost_price, min_stock, is_service, notes, is_archived, created_at, updated_at, created_by) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [
        v.name,
        barcode,
        v.categoryId ?? null,
        v.unitId ?? null,
        money(v.costPrice ?? '0'),
        money(v.minStock ?? '0'),
        v.isService ? 1 : 0,
        v.notes ?? null,
        now,
        now,
        getCurrentUserId() ?? null,
      ],
    );
    productId = Number(res.lastInsertRowId);

    // أسعار البيع لكل عملة — مستوى retail فقط (قرار 5)
    for (const p of v.prices) {
      await db.run(
        'INSERT INTO product_price(product_id, currency_id, price, price_level, margin_percent, updated_at) ' +
          'VALUES(?, ?, ?, ?, 0, ?)',
        [productId, p.currencyId, money(p.price), 'retail', now],
      );
    }

    // الحركة الافتتاحية: movement_type='opening' بتكلفة الصنف + UPSERT الرصيد (FR-01-01/07)
    if (!v.isService && v.openingQty !== undefined && dec(v.openingQty).greaterThan(0)) {
      const qty = dec(v.openingQty);
      let warehouseId = v.openingWarehouseId;
      if (warehouseId === undefined) {
        const def = await db.all<{ id: number }>(
          'SELECT id FROM warehouse WHERE is_archived = 0 ORDER BY is_default DESC, id ASC LIMIT 1',
        );
        if (def.length === 0) {
          throw new Error(
            'لا يوجد مستودع لتسجيل الكمية الافتتاحية — أكمل الإعداد الأولي أو أنشئ مستودعاً أولاً',
          );
        }
        warehouseId = Number(def[0].id);
      } else {
        await assertRefExists('warehouse', warehouseId, 'المستودع');
      }
      const unitCost = money(v.openingCost ?? v.costPrice ?? '0');
      await db.run(
        'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
          "VALUES(?, ?, 'opening', ?, ?, NULL, NULL, ?, ?, ?, ?)",
        [productId, warehouseId, money(qty), unitCost, now, 'الرصيد الافتتاحي عند إنشاء الصنف', now, getCurrentUserId() ?? null],
      );
      await db.run(
        'INSERT INTO stock_level(product_id, warehouse_id, qty) VALUES(?, ?, ?) ' +
          'ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty',
        [productId, warehouseId, money(qty)],
      );
    }

    await logAudit('product_create', {
      entity: 'product',
      entityId: productId,
      details: {
        name: v.name,
        barcode,
        isService: v.isService,
        prices: v.prices.map((p) => ({ currencyId: p.currencyId, price: money(p.price) })),
        openingQty: v.openingQty ?? null,
      },
    });
  });

  return productId;
}

// ============ تعديل صنف ============

export async function updateProduct(
  id: number,
  input: ProductInput & { mergePrices?: boolean },
): Promise<void> {
  const v = parseOrThrow(ProductInputSchema, normalizeInput(input), 'مدخلات تعديل الصنف غير مكتملة');

  if (v.isService && (v.openingQty !== undefined || v.openingWarehouseId !== undefined)) {
    throw new Error('الصنف الخدمي بلا مخزون — لا يمكن إدخال كمية افتتاحية أو مستودع لصنف خدمي');
  }

  const db = await getDb();
  const now = nowISO();

  await db.transaction(async () => {
    await assertPeriodOpen(todayISO());

    const rows = await db.all<{
      id: number;
      name: string;
      barcode: string | null;
      is_service: number;
    }>('SELECT id, name, barcode, is_service FROM product WHERE id = ?', [id]);
    if (rows.length === 0) {
      throw new Error(`صنف غير موجود (رقم ${id}) — ربما حُذف رابطه، عد للقائمة وأعد المحاولة`);
    }
    const existing = rows[0]!;

    // تحول لخدمي مع وجود رصيد → رفض (بلا مخزون إطلاقاً — FR-01-16)
    if (v.isService && Number(existing.is_service) === 0) {
      const totals = await db.all<{ t: string | number | null }>(
        'SELECT COALESCE(SUM(qty), 0) AS t FROM stock_level WHERE product_id = ?',
        [id],
      );
      if (dec(totals[0]?.t ?? 0).greaterThan(0)) {
        throw new Error(
          `لا يمكن تحويل الصنف «${existing.name}» إلى خدمي ولديه رصيد مخزني (${money(totals[0]?.t ?? 0)}) — ` +
            'صفّر الرصيد أولاً عبر «تعديل الرصيد» ثم أعد المحاولة',
        );
      }
    }

    // الباركود: غير مُدخل → يبقى الحالي؛ مُدخل مختلف → فحص الحجز (يشمل المؤرشف)
    let barcode: string | null = existing.barcode;
    if (v.barcode !== undefined && v.barcode !== existing.barcode) {
      await assertBarcodeFree(v.barcode, 'لصنف آخر', id);
      barcode = v.barcode;
    }

    if (v.categoryId !== undefined) await assertRefExists('category', v.categoryId, 'الفئة');
    if (v.unitId !== undefined) await assertRefExists('unit', v.unitId, 'وحدة القياس');
    for (const p of v.prices) {
      await assertRefExists('currency', p.currencyId, 'العملة');
    }

    await db.run(
      'UPDATE product SET name = ?, barcode = ?, category_id = ?, unit_id = ?, cost_price = ?, min_stock = ?, is_service = ?, notes = ?, updated_at = ? WHERE id = ?',
      [
        v.name,
        barcode,
        v.categoryId ?? null,
        v.unitId ?? null,
        money(v.costPrice ?? '0'),
        money(v.minStock ?? '0'),
        v.isService ? 1 : 0,
        v.notes ?? null,
        now,
        id,
      ],
    );

    // الأسعار: upsert لكل عملة (retail) — استبدال مباشر في V1 (السجل التاريخي V1.1 مع FR-01-11)
    for (const p of v.prices) {
      await db.run(
        'INSERT INTO product_price(product_id, currency_id, price, price_level, margin_percent, updated_at) ' +
          'VALUES(?, ?, ?, ?, 0, ?) ' +
          'ON CONFLICT(product_id, currency_id, price_level) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at',
        [id, p.currencyId, money(p.price), 'retail', now],
      );
    }
    if (input.mergePrices !== true && v.prices.length > 0) {
      const ids = v.prices.map((p) => '?').join(', ');
      await db.run(
        `DELETE FROM product_price WHERE product_id = ? AND price_level = 'retail' AND currency_id NOT IN (${ids})`,
        [id, ...v.prices.map((p) => p.currencyId)],
      );
    } else if (input.mergePrices !== true && v.prices.length === 0) {
      await db.run(`DELETE FROM product_price WHERE product_id = ? AND price_level = 'retail'`, [id]);
    }

    await logAudit('product_update', {
      entity: 'product',
      entityId: id,
      details: {
        name: v.name,
        barcode,
        isService: v.isService,
        prices: v.prices.map((p) => ({ currencyId: p.currencyId, price: money(p.price) })),
      },
    });
  });
}

// ============ أرشفة صنف (FR-01-15) ============

export async function archiveProduct(id: number): Promise<void> {
  const db = await getDb();
  const now = nowISO();
  await db.transaction(async () => {
    await assertPeriodOpen(todayISO());
    const rows = await db.all<{ id: number; name: string; is_archived: number }>(
      'SELECT id, name, is_archived FROM product WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      throw new Error(`صنف غير موجود (رقم ${id}) — لا يمكن أرشفته`);
    }
    if (Number(rows[0]!.is_archived) === 1) return; // أرشفة مكررة → لا شيء (idempotent)
    await db.run('UPDATE product SET is_archived = 1, updated_at = ? WHERE id = ?', [now, id]);
    await logAudit('product_archive', {
      entity: 'product',
      entityId: id,
      details: { name: rows[0]!.name },
    });
  });
}

// ============ بطاقة الصنف (§6.5) ============

export async function getProductFull(id: number, movementsLimit = 10): Promise<ProductRowFull | null> {
  const db = await getDb();
  const rows = await db.all<{
    id: number;
    name: string;
    barcode: string | null;
    category_id: number | null;
    unit_id: number | null;
    cost_price: string | number | null;
    min_stock: string | number | null;
    is_service: number;
    is_archived: number;
    notes: string | null;
    created_at: string | null;
    updated_at: string | null;
    total_qty: string | number | null;
    category_name: string | null;
    unit_name: string | null;
  }>(
    `SELECT p.*, c.name AS category_name, u.name AS unit_name,
            COALESCE((SELECT SUM(sl.qty) FROM stock_level sl WHERE sl.product_id = p.id), 0) AS total_qty
     FROM product p
     LEFT JOIN category c ON c.id = p.category_id
     LEFT JOIN unit u ON u.id = p.unit_id
     WHERE p.id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;

  const prices = await db.all<ProductPriceRow & { is_base: number }>(
    `SELECT pp.currency_id AS currencyId, c.code, c.name, c.decimals, c.is_base, pp.price
     FROM product_price pp JOIN currency c ON c.id = pp.currency_id
     WHERE pp.product_id = ? AND pp.price_level = 'retail'
     ORDER BY c.is_base DESC, c.code ASC`,
    [id],
  );
  const stocks = await db.all<{ warehouseId: number; warehouseName: string; is_default: number; qty: string | number }>(
    `SELECT sl.warehouse_id AS warehouseId, w.name AS warehouseName, w.is_default, sl.qty
     FROM stock_level sl JOIN warehouse w ON w.id = sl.warehouse_id
     WHERE sl.product_id = ? ORDER BY w.is_default DESC, w.name ASC`,
    [id],
  );
  const movements = await db.all<{
    id: number;
    warehouse_id: number;
    warehouse_name: string | null;
    movement_type: string;
    qty: string | number;
    unit_cost: string | number;
    ref_type: string | null;
    ref_id: number | null;
    moved_at: string;
    notes: string | null;
  }>(
    `SELECT sm.id, sm.warehouse_id, w.name AS warehouse_name, sm.movement_type, sm.qty, sm.unit_cost,
            sm.ref_type, sm.ref_id, sm.moved_at, sm.notes
     FROM stock_movement sm LEFT JOIN warehouse w ON w.id = sm.warehouse_id
     WHERE sm.product_id = ? ORDER BY sm.moved_at DESC, sm.id DESC LIMIT ?`,
    [id, movementsLimit],
  );

  return {
    id: Number(r.id),
    name: r.name,
    barcode: r.barcode,
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: r.category_name,
    unitId: r.unit_id === null ? null : Number(r.unit_id),
    unitName: r.unit_name,
    costPrice: money(r.cost_price ?? 0),
    minStock: money(r.min_stock ?? 0),
    isService: Number(r.is_service) === 1,
    isArchived: Number(r.is_archived) === 1,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalQty: money(r.total_qty ?? 0),
    prices: prices.map((p) => ({
      currencyId: Number(p.currencyId),
      code: p.code,
      name: p.name,
      decimals: Number(p.decimals),
      isBase: Number(p.is_base) === 1,
      price: money(p.price),
    })),
    stocks: stocks.map((s) => ({
      warehouseId: Number(s.warehouseId),
      warehouseName: s.warehouseName,
      isDefault: Number(s.is_default) === 1,
      qty: money(s.qty),
    })),
    movements: movements.map((m) => ({
      id: Number(m.id),
      warehouseId: Number(m.warehouse_id),
      warehouseName: m.warehouse_name,
      movementType: m.movement_type,
      qty: money(m.qty),
      unitCost: money(m.unit_cost),
      refType: m.ref_type,
      refId: m.ref_id,
      movedAt: m.moved_at,
      notes: m.notes,
    })),
  };
}

// ============ البحث والقوائم (FR-01-04) ============

export async function searchProducts(
  query: string,
  opts?: { limit?: number; includeArchived?: boolean },
): Promise<ProductListRow[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const includeArchived = opts?.includeArchived === true;
  const q = (query ?? '').trim();

  let baseCurrencyId = -1;
  try {
    baseCurrencyId = (await getBaseCurrency()).id;
  } catch {
    baseCurrencyId = -1; // بلا عملة أساس بعد — سعر القائمة null
  }

  if (q === '') {
    const rows = await db.all<ProductListSqlRow>(
      `${PRODUCT_LIST_SELECT} ${includeArchived ? '' : 'WHERE p.is_archived = 0'} ORDER BY p.name COLLATE NOCASE ASC LIMIT ?`,
      includeArchived ? [baseCurrencyId, limit] : [baseCurrencyId, limit],
    );
    return rows.map(toListRow);
  }

  const esc = likeEscape(q);
  const rows = await db.all<ProductListSqlRow>(
    `${PRODUCT_LIST_SELECT} WHERE (${includeArchived ? '1 = 1' : 'p.is_archived = 0'}) ` +
      'AND (p.name LIKE ? ESCAPE \'\\\' OR p.barcode LIKE ? ESCAPE \'\\\') ' +
      'ORDER BY p.name COLLATE NOCASE ASC LIMIT ?',
    [baseCurrencyId, `%${esc}%`, `${esc}%`, limit],
  );
  return rows.map(toListRow);
}

/** مسح باركود: مطابقة تامة للباركود — غير المؤرشف فقط (FR-01-03). */
export async function findByBarcode(barcode: string): Promise<ProductListRow | null> {
  const db = await getDb();
  const code = (barcode ?? '').trim();
  if (code === '') return null;
  let baseCurrencyId = -1;
  try {
    baseCurrencyId = (await getBaseCurrency()).id;
  } catch {
    baseCurrencyId = -1;
  }
  const rows = await db.all<ProductListSqlRow>(
    `${PRODUCT_LIST_SELECT} WHERE p.is_archived = 0 AND p.barcode = ? LIMIT 1`,
    [baseCurrencyId, code],
  );
  return rows.length === 0 ? null : toListRow(rows[0]!);
}

/** الأصناف تحت الحد الأدنى (FR-01-12) — شاشة تنبيهات المخزون. */
export async function listBelowMinStock(): Promise<ProductListRow[]> {
  const db = await getDb();
  let baseCurrencyId = -1;
  try {
    baseCurrencyId = (await getBaseCurrency()).id;
  } catch {
    baseCurrencyId = -1;
  }
  const rows = await db.all<ProductListSqlRow>(
    `${PRODUCT_LIST_SELECT}
     WHERE p.is_archived = 0 AND p.is_service = 0 AND p.min_stock > 0
       AND COALESCE((SELECT SUM(sl.qty) FROM stock_level sl WHERE sl.product_id = p.id), 0) < p.min_stock
     ORDER BY p.name COLLATE NOCASE ASC`,
    [baseCurrencyId],
  );
  return rows.map(toListRow);
}

/** آخر حركات صنف (مرجعية لا تُحذف — FR-01-07). */
export async function productMovements(productId: number, limit = 10): Promise<StockMovementRow[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: number;
    warehouse_id: number;
    warehouse_name: string | null;
    movement_type: string;
    qty: string | number;
    unit_cost: string | number;
    ref_type: string | null;
    ref_id: number | null;
    moved_at: string;
    notes: string | null;
  }>(
    `SELECT sm.id, sm.warehouse_id, w.name AS warehouse_name, sm.movement_type, sm.qty, sm.unit_cost,
            sm.ref_type, sm.ref_id, sm.moved_at, sm.notes
     FROM stock_movement sm LEFT JOIN warehouse w ON w.id = sm.warehouse_id
     WHERE sm.product_id = ? ORDER BY sm.moved_at DESC, sm.id DESC LIMIT ?`,
    [productId, Math.max(1, Math.min(limit, 200))],
  );
  return rows.map((m) => ({
    id: Number(m.id),
    warehouseId: Number(m.warehouse_id),
    warehouseName: m.warehouse_name,
    movementType: m.movement_type,
    qty: money(m.qty),
    unitCost: money(m.unit_cost),
    refType: m.ref_type,
    refId: m.ref_id,
    movedAt: m.moved_at,
    notes: m.notes,
  }));
}

// ============ تعديل الرصيد اليدوي (FR-01-07: manual_adjust) ============

export async function adjustStock(input: {
  productId: number;
  warehouseId: number;
  newQty: string;
  reason?: string;
}): Promise<void> {
  const v = parseOrThrow(AdjustStockSchema, input, 'مدخلات تعديل الرصيد غير صالحة');
  const db = await getDb();
  const now = nowISO();

  await db.transaction(async () => {
    await assertPeriodOpen(todayISO());

    const prods = await db.all<{ id: number; name: string; cost_price: string | number | null; is_service: number }>(
      'SELECT id, name, cost_price, is_service FROM product WHERE id = ?',
      [v.productId],
    );
    if (prods.length === 0) {
      throw new Error(`صنف غير موجود (رقم ${v.productId}) — لا يمكن تعديل رصيده`);
    }
    const product = prods[0]!;
    if (Number(product.is_service) === 1) {
      throw new Error(`الصنف «${product.name}» خدمي وبلا مخزون — لا يمكن تعديل رصيده`);
    }
    await assertRefExists('warehouse', v.warehouseId, 'المستودع');

    // منع السالب مطلقاً (قرار 9 / قاعدة 5.4-5): رفض باسم الصنف والكمية الناقصة
    const newQtyD = dec(v.newQty);
    if (newQtyD.isNegative()) {
      const shortfall = newQtyD.abs();
      throw new Error(
        `رصيد الصنف «${product.name}» لا يمكن أن يكون سالباً — القيمة المطلوبة (${newQtyD.toString()}) ` +
          `تنقص عن الصفر بمقدار ${shortfall.toString()} وحدة. راجع العدد المدخل`,
      );
    }

    const levels = await db.all<{ qty: string | number }>(
      'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
      [v.productId, v.warehouseId],
    );
    const currentQty = dec(levels[0]?.qty ?? 0);
    const diff = newQtyD.minus(currentQty);
    if (diff.isZero()) return; // لا تغيير → لا حركة (CHECK qty <> 0 يمنع صفراً أصلاً)

    await db.run(
      'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, notes, created_at, created_by) ' +
        "VALUES(?, ?, 'manual_adjust', ?, ?, NULL, NULL, ?, ?, ?, ?)",
      [
        v.productId,
        v.warehouseId,
        money(diff),
        money(product.cost_price ?? 0),
        now,
        v.reason ?? 'تعديل يدوي للرصيد',
        now,
        getCurrentUserId() ?? null,
      ],
    );
    await db.run(
      'INSERT INTO stock_level(product_id, warehouse_id, qty) VALUES(?, ?, ?) ' +
        'ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty',
      [v.productId, v.warehouseId, money(newQtyD)],
    );
    await logAudit('stock_adjust', {
      entity: 'product',
      entityId: v.productId,
      details: {
        warehouseId: v.warehouseId,
        oldQty: money(currentQty),
        newQty: money(newQtyD),
        diff: money(diff),
        reason: v.reason ?? null,
      },
    });
  });
}

// ============ الفئات (FR-01-05: شجرة بعمق مستويين) ============

export async function listCategories(): Promise<CategoryNode[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string; parent_id: number | null }>(
    'SELECT id, name, parent_id FROM category WHERE is_archived = 0 ORDER BY sort_order ASC, id ASC',
  );
  const byId = new Map<number, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const r of rows) {
    byId.set(Number(r.id), { id: Number(r.id), name: r.name, children: [] });
  }
  for (const r of rows) {
    const node = byId.get(Number(r.id))!;
    const parent = r.parent_id === null ? undefined : byId.get(Number(r.parent_id));
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function upsertCategory(id: number | null, name: string, parentId?: number): Promise<number> {
  const n = (name ?? '').trim();
  if (n === '') {
    throw new Error('اسم الفئة مطلوب — أدخل اسماً مثل «مشروبات» أو «ألبان»');
  }
  if (n.length > 100) {
    throw new Error('اسم الفئة طويل جداً (الحد 100 حرف)');
  }
  const db = await getDb();
  const now = nowISO();

  return db.transaction(async () => {
    await assertPeriodOpen(todayISO());

    let parent: { id: number; parent_id: number | null } | undefined;
    if (parentId !== undefined && parentId !== null && (!id || parentId !== id)) {
      const parents = await db.all<{ id: number; parent_id: number | null }>(
        'SELECT id, parent_id FROM category WHERE id = ? AND is_archived = 0',
        [parentId],
      );
      if (parents.length === 0) {
        throw new Error(`الفئة الأصل (رقم ${parentId}) غير موجودة — اختر فئة من القائمة`);
      }
      parent = parents[0]!;
      if (parent.parent_id !== null) {
        throw new Error(
          'بنية الفئات شجرة بعمق مستويين فقط (FR-01-05) — لا يمكن جعل فئة فرعية أصلاً لفئة أخرى',
        );
      }
    }

    if (id === null || id === undefined) {
      const res = await db.run(
        'INSERT INTO category(name, parent_id, sort_order, is_archived, created_at, updated_at, created_by) VALUES(?, ?, 0, 0, ?, ?, ?)',
        [n, parent ? Number(parent.id) : null, now, now, getCurrentUserId() ?? null],
      );
      await logAudit('category_create', { entity: 'category', details: { name: n } });
      return Number(res.lastInsertRowId);
    }

    const existing = await db.all<{ id: number }>('SELECT id FROM category WHERE id = ?', [id]);
    if (existing.length === 0) {
      throw new Error(`فئة غير موجودة (رقم ${id}) — لا يمكن تعديلها`);
    }
    if (parentId !== undefined && parentId !== null) {
      if (parentId === id) {
        throw new Error('لا يمكن جعل الفئة أبنةً لنفسها — اختر فئة أصل مختلفة');
      }
      const children = await db.all<{ c: number }>(
        'SELECT count(*) AS c FROM category WHERE parent_id = ? AND is_archived = 0',
        [id],
      );
      if ((children[0]?.c ?? 0) > 0) {
        throw new Error(
          'لا يمكن تحويل فئة لها فئات فرعية إلى فئة فرعية — البنية شجرة بعمق مستويين فقط (FR-01-05)',
        );
      }
    }
    await db.run('UPDATE category SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?', [
      n,
      parent ? Number(parent.id) : null,
      now,
      id,
    ]);
    await logAudit('category_update', { entity: 'category', entityId: id, details: { name: n } });
    return id;
  });
}

export async function archiveCategory(id: number): Promise<void> {
  const db = await getDb();
  const now = nowISO();
  await db.transaction(async () => {
    await assertPeriodOpen(todayISO());
    const rows = await db.all<{ id: number; name: string }>(
      'SELECT id, name FROM category WHERE id = ? AND is_archived = 0',
      [id],
    );
    if (rows.length === 0) {
      throw new Error(`فئة غير موجودة أو مؤرشفة سابقاً (رقم ${id})`);
    }
    const products = await db.all<{ c: number }>(
      'SELECT count(*) AS c FROM product WHERE category_id = ? AND is_archived = 0',
      [id],
    );
    if ((products[0]?.c ?? 0) > 0) {
      throw new Error(
        `لا يمكن أرشفة الفئة «${rows[0]!.name}» — عليها ${Number(products[0]!.c)} صنفاً فاعلاً. ` +
          'انقل الأصناف لفئة أخرى أو أرشفها أولاً',
      );
    }
    const children = await db.all<{ c: number }>(
      'SELECT count(*) AS c FROM category WHERE parent_id = ? AND is_archived = 0',
      [id],
    );
    if ((children[0]?.c ?? 0) > 0) {
      throw new Error(
        `لا يمكن أرشفة الفئة «${rows[0]!.name}» — تحتها ${Number(children[0]!.c)} فئة فرعية فاعلة. أرشفها أولاً`,
      );
    }
    await db.run('UPDATE category SET is_archived = 1, updated_at = ? WHERE id = ?', [now, id]);
    await logAudit('category_archive', { entity: 'category', entityId: id, details: { name: rows[0]!.name } });
  });
}

// ============ وحدات القياس (FR-01-05) ============

export async function listUnits(): Promise<UnitRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string; base_unit_id: number | null; factor: string | number | null; is_archived: number }>(
    'SELECT id, name, base_unit_id, factor, is_archived FROM unit WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC',
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    baseUnitId: r.base_unit_id === null ? null : Number(r.base_unit_id),
    factor: money(r.factor ?? '1'),
    isArchived: Number(r.is_archived) === 1,
  }));
}

export async function upsertUnit(
  id: number | null,
  name: string,
  baseUnitId?: number,
  factor?: string,
): Promise<number> {
  const n = (name ?? '').trim();
  if (n === '') {
    throw new Error('اسم الوحدة مطلوب — أدخل اسماً مثل «قطعة» أو «كرتون»');
  }
  if (n.length > 50) {
    throw new Error('اسم الوحدة طويل جداً (الحد 50 حرفاً)');
  }
  const f = normOpt(factor) ?? '1';
  if (!DECIMAL_RE.test(f) || dec(f).lessThanOrEqualTo(0)) {
    throw new Error('معامل التحويل يجب أن يكون رقماً أكبر من صفر (مثل «24» لكرتون = 24 قطعة)');
  }
  const db = await getDb();
  const now = nowISO();

  return db.transaction(async () => {
    await assertPeriodOpen(todayISO());

    let base: { id: number; base_unit_id: number | null } | undefined;
    if (baseUnitId !== undefined && baseUnitId !== null && (!id || baseUnitId !== id)) {
      const bases = await db.all<{ id: number; base_unit_id: number | null }>(
        'SELECT id, base_unit_id FROM unit WHERE id = ? AND is_archived = 0',
        [baseUnitId],
      );
      if (bases.length === 0) {
        throw new Error(`وحدة الأساس (رقم ${baseUnitId}) غير موجودة — اختر وحدة من القائمة`);
      }
      if (bases[0]!.base_unit_id !== null) {
        throw new Error('سلسلة التحويل مستويان فقط — وحدة الأساس نفسها يجب أن تكون أساسية (بلا أساس)');
      }
      base = bases[0]!;
    }

    if (id === null || id === undefined) {
      const res = await db.run(
        'INSERT INTO unit(name, base_unit_id, factor, is_archived, created_at, updated_at, created_by) VALUES(?, ?, ?, 0, ?, ?, ?)',
        [n, base ? Number(base.id) : null, money(f), now, now, getCurrentUserId() ?? null],
      );
      await logAudit('unit_create', { entity: 'unit', details: { name: n, factor: money(f) } });
      return Number(res.lastInsertRowId);
    }

    const existing = await db.all<{ id: number }>('SELECT id FROM unit WHERE id = ?', [id]);
    if (existing.length === 0) {
      throw new Error(`وحدة غير موجودة (رقم ${id}) — لا يمكن تعديلها`);
    }
    if (baseUnitId !== undefined && baseUnitId !== null) {
      if (baseUnitId === id) {
        throw new Error('لا يمكن جعل الوحدة أساساً لنفسها — اختر وحدة أخرى');
      }
      const derived = await db.all<{ c: number }>(
        'SELECT count(*) AS c FROM unit WHERE base_unit_id = ? AND is_archived = 0',
        [id],
      );
      if ((derived[0]?.c ?? 0) > 0) {
        throw new Error(
          'لا يمكن إعطاء وحدة أساسية وحدةً أساساً لها — سلسلة التحويل مستويان فقط (قطعة ← كرتون)',
        );
      }
    }
    await db.run('UPDATE unit SET name = ?, base_unit_id = ?, factor = ?, updated_at = ? WHERE id = ?', [
      n,
      base ? Number(base.id) : null,
      money(f),
      now,
      id,
    ]);
    await logAudit('unit_update', { entity: 'unit', entityId: id, details: { name: n, factor: money(f) } });
    return id;
  });
}

/** أرشفة وحدة — تُمنع إن كان عليها أصناف فاعلة (كالفئات تماماً). */
export async function archiveUnit(id: number): Promise<void> {
  const db = await getDb();
  const now = nowISO();
  await db.transaction(async () => {
    await assertPeriodOpen(todayISO());
    const rows = await db.all<{ id: number; name: string }>(
      'SELECT id, name FROM unit WHERE id = ? AND is_archived = 0',
      [id],
    );
    if (rows.length === 0) {
      throw new Error(`وحدة غير موجودة أو مؤرشفة سابقاً (رقم ${id})`);
    }
    const products = await db.all<{ c: number }>(
      'SELECT count(*) AS c FROM product WHERE unit_id = ? AND is_archived = 0',
      [id],
    );
    if ((products[0]?.c ?? 0) > 0) {
      throw new Error(
        `لا يمكن أرشفة الوحدة «${rows[0]!.name}» — يستخدمها ${Number(products[0]!.c)} صنفاً فاعلاً. ` +
          'غيّر وحدة الأصناف أولاً',
      );
    }
    await db.run('UPDATE unit SET is_archived = 1, updated_at = ? WHERE id = ?', [now, id]);
    await logAudit('unit_archive', { entity: 'unit', entityId: id, details: { name: rows[0]!.name } });
  });
}

// ============ المستودعات (قراءة فقط في V1 — التحويل مؤجل FR-01-09) ============

export async function listWarehouses(): Promise<WarehouseRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number; name: string; is_default: number }>(
    'SELECT id, name, is_default FROM warehouse WHERE is_archived = 0 ORDER BY is_default DESC, name ASC',
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    isDefault: Number(r.is_default) === 1,
  }));
}

// ============ دوال مساعدة للعرض ============

/** هل الكمية موجبة؟ (لعرض أسهم الحركات) */
export function isQtyIn(qty: string): boolean {
  return dec(qty).greaterThan(0);
}

/** فرق الكمية عن الحد (لعرض التنبيهات) — سالب يعني عجزاً. */
export function minStockGap(row: ProductListRow): Decimal {
  return dec(row.minStock).minus(dec(row.totalQty));
}
