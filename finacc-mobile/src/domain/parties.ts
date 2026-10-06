import { z } from 'zod';
import { getDb } from '@/db/client';
import { dec, money, roundTo, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * الأطراف — العملاء والموردون (الوحدة 03 + قرار 8):
 *
 * المعادلة الملزمة لرصيد العميل (FR-03-02 + قرار 8 — لكل عملة على حدة):
 *   رصيد = رصيد افتتاحي بعملته
 *     + Σ(invoice.due_amount حيث doc_type='sale' AND status='completed'
 *          AND pay_status IN ('credit','mixed'))
 *     − Σ(cash_tx.amount حيث tx_type='receipt' AND is_voided=0
 *          AND ref_type IN ('invoice','installment','on_account'))
 *     − Σ(invoice.due_amount حيث doc_type='sale_return' AND status='completed')
 *
 * رصيد المورّد مرآة كاملة:
 *   رصيد = رصيد افتتاحي (دائن مستحق للمورّد)
 *     + Σ(purchase.due_amount بذات شروط الآجل)
 *     − Σ(cash_tx.amount حيث tx_type='payment' AND is_voided=0 AND ref_type كما أعلاه)
 *     − Σ(purchase_return.due_amount حيث status='completed')
 *
 * إشارات مهمة:
 * - كل المبالغ Decimal من '@/utils/money' (لا Float) والتجميع يجري في JS فوق الصفوف
 *   الخام (SUM في SQLite يُرجع REAL وقد يفقد الدقة — القوائم السريعة فقط تستخدم
 *   ROUND(...,4) الموثقة أدناه).
 * - الفواتير تُنشأ في الموجة 4 — المعادلة تعمل الآن بالرصيد الافتتاحي وأي صفوف
 *   يدخلها الاختبار، وستلتقط الفواتير تلقائياً عند توفرها.
 * - لا حذف لأي طرف إطلاقاً؛ الأرشفة فقط (FR-03-09) — دالة الحذف غير موجودة أصلاً.
 * - كشف الحساب التفصيلي (FR-03-04) شاشته في الموجة 5؛ دوال الرصيد هنا هي أساسه.
 */

// ============ الأنواع والعقود ============

export interface PartyInput {
  name: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  area?: string;
  /** null = بلا حد، 0 = منع البيع الآجل كلياً (FR-03-01). */
  creditLimit?: string | null;
  /** موجب = مدين على العميل / دائن مستحق للمورّد (سالب مسموح في الدومين: رصيد افتتاحي دائن). */
  openingBalance?: string;
  openingCurrencyId?: number;
  openingRate?: string;
  openingDate?: string;
  notes?: string;
}

/** مدخل المورّد — جدول supplier بلا واتساب/منطقة/حد ائتمان (فرق الهيكل عن customer). */
export type SupplierInput = Omit<PartyInput, 'creditLimit' | 'whatsapp' | 'area'>;

/** صف عميل كما يعيده الدومين (أعمدة مطبّعة — مبالغ نصاً). */
export interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  area: string | null;
  /** null = بلا حد / '0' = منع الآجل / غير ذلك = قيمة الحد. */
  creditLimit: string | null;
  openingBalance: string;
  openingCurrencyId: number | null;
  openingRate: string | null;
  openingDate: string | null;
  notes: string | null;
  imagePath: string | null;
  isArchived: number;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: number | null;
}

/** صف مورّد (بلا واتساب/منطقة/حد ائتمان). */
export interface SupplierRow {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  openingBalance: string;
  openingCurrencyId: number | null;
  openingRate: string | null;
  openingDate: string | null;
  notes: string | null;
  isArchived: number;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: number | null;
}

/** صف قائمة الأطراف — بحث سريع + رصيد مبسّط بعملة الأساس (العرض الكامل في الملف). */
export interface CustomerListRow {
  id: number;
  name: string;
  phone: string | null;
  area: string | null;
  /** الرصيد بعملة الأساس فقط (حساب مبسّط — أرصدة العملات الأخرى تُعرض في ملف الطرف). */
  baseBalance: string;
}

export type SupplierListRow = CustomerListRow;

/** رصيد طرف بعملة واحدة — موجب = مدين على العميل / مستحق للمورّد، سالب = دائن لصالح الطرف. */
export interface PartyBalance {
  currencyId: number;
  code: string;
  balance: string;
}

// ============ التحقق (zod) ============

const MONEY_RE = /^-?\d+(\.\d+)?$/;
const POS_MONEY_RE = /^\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const partyInputSchema = z.object({
  name: z.string().trim().min(1, 'اسم الطرف مطلوب — أدخل الاسم للمتابعة').max(120, 'الاسم طويل جداً (120 حرفاً كحد أقصى)'),
  phone: z.string().trim().max(30, 'رقم الهاتف طويل (30 خانة كحد أقصى)').optional(),
  whatsapp: z.string().trim().max(30, 'رقم الواتساب طويل (30 خانة كحد أقصى)').optional(),
  address: z.string().trim().max(200, 'العنوان طويل (200 حرف كحد أقصى)').optional(),
  area: z.string().trim().max(80, 'اسم المنطقة طويل (80 حرفاً كحد أقصى)').optional(),
  creditLimit: z
    .string()
    .trim()
    .regex(POS_MONEY_RE, 'حد الائتمان يجب أن يكون رقماً غير سالب — «500000» أو «0» لمنع الآجل')
    .nullable()
    .optional(),
  openingBalance: z.string().trim().regex(MONEY_RE, 'الرصيد الافتتاحي يجب أن يكون رقماً مثل «50000»').optional(),
  openingCurrencyId: z.number().int().positive('معرّف العملة غير صالح').optional(),
  openingRate: z
    .string()
    .trim()
    .regex(POS_MONEY_RE, 'سعر صرف الرصيد الافتتاحي يجب أن يكون رقماً مثل «530»')
    .refine((s) => dec(s).greaterThan(0), 'سعر صرف الرصيد الافتتاحي يجب أن يكون أكبر من صفر')
    .optional(),
  openingDate: z.string().trim().regex(ISO_DATE_RE, 'تاريخ الرصيد غير صالح — استخدم YYYY-MM-DD').optional(),
  notes: z.string().trim().max(1000, 'الملاحظات طويلة (1000 حرف كحد أقصى)').optional(),
});

const partyUpdateSchema = partyInputSchema.partial();

function parseInput(input: unknown, what: string): z.infer<typeof partyInputSchema> {
  const parsed = partyInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `مدخلات ${what} غير صالحة: ${issue?.message ?? 'راجع الحقول'} (الحقل: ${issue?.path?.join('.') ?? '?'})`,
    );
  }
  return parsed.data;
}

function parseUpdate(input: unknown, what: string): Partial<z.infer<typeof partyInputSchema>> {
  const parsed = partyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `مدخلات تعديل ${what} غير صالحة: ${issue?.message ?? 'راجع الحقول'} (الحقل: ${issue?.path?.join('.') ?? '?'})`,
    );
  }
  return parsed.data;
}

// ============ الرصيد الافتتاحي (FR-03-01) ============

interface OpeningStorage {
  balance: string;
  currencyId: number | null;
  rate: string | null;
  date: string | null;
}

/**
 * بناء قيم الرصيد الافتتاحي المخزنة:
 * - بلا مبلغ → أصفار وNULLs (لا يظهر في المعادلة).
 * - عملة الأساس → سعرها 1 دائماً (تعريف).
 * - عملة أجنبية بمبلغ فعلي → السعر إلزامي (قرار 8: الأرصدة الافتتاحية تحمل currency_id + as_of_rate).
 * - المبلغ يُقرَّب لمنازل عملته (اليمني 0).
 */
async function buildOpening(
  amountRaw: string | undefined,
  currencyIdRaw: number | undefined,
  rateRaw: string | undefined,
  dateRaw: string | undefined,
): Promise<OpeningStorage> {
  const db = await getDb();
  const baseRows = await db.all<{ id: number }>('SELECT id FROM currency WHERE is_base = 1 LIMIT 1');
  if (baseRows.length === 0) {
    throw new Error('لم تُعرَّف عملة أساسية بعد — أكمل الإعداد الأولي للتطبيق أولاً');
  }
  const baseId = Number(baseRows[0].id);

  const amount = amountRaw !== undefined && amountRaw.trim() !== '' ? amountRaw.trim() : '0';
  const amt = dec(amount);

  const currencyId = currencyIdRaw ?? baseId;
  const cur = await db.all<{ is_base: number; decimals: number; is_active: number }>(
    'SELECT is_base, decimals, is_active FROM currency WHERE id = ?',
    [currencyId],
  );
  if (cur.length === 0) {
    throw new Error(`عملة الرصيد الافتتاحي غير موجودة (رقم ${currencyId}) — اختر عملة من القائمة`);
  }
  if (Number(cur[0].is_active) !== 1) {
    throw new Error('عملة الرصيد الافتتاحي موقوفة — اختر عملة مفعّلة أو أعد تفعيلها من شاشة العملات');
  }
  const isBase = Number(cur[0].is_base) === 1;

  if (amt.isZero()) {
    return {
      balance: '0',
      currencyId: currencyIdRaw !== undefined ? currencyId : null,
      rate: isBase ? '1' : rateRaw !== undefined && rateRaw.trim() !== '' ? money(rateRaw) : null,
      date: dateRaw ?? null,
    };
  }

  let rate: string;
  if (isBase) {
    rate = '1';
  } else if (rateRaw !== undefined && rateRaw.trim() !== '') {
    rate = money(rateRaw);
  } else {
    throw new Error('سعر الصرف مطلوب للرصيد الافتتاحي بعملة غير الأساس — أدخل سعر يوم الرصيد (مثل «530»)');
  }

  const date = dateRaw ?? todayISO();
  if (!ISO_DATE_RE.test(date)) {
    throw new Error('تاريخ الرصيد الافتتاحي غير صالح — استخدم صيغة YYYY-MM-DD');
  }
  return { balance: money(roundTo(amt, Number(cur[0].decimals))), currencyId, rate, date };
}

// ============ العملاء (FR-03-01) ============

const CUSTOMER_SELECT =
  'SELECT id, name, phone, whatsapp, address, area, credit_limit AS creditLimit, ' +
  'opening_balance AS openingBalance, opening_balance_currency_id AS openingCurrencyId, ' +
  'opening_balance_rate AS openingRate, opening_balance_date AS openingDate, notes, image_path AS imagePath, ' +
  'is_archived AS isArchived, created_at AS createdAt, updated_at AS updatedAt, created_by AS createdBy FROM customer';

function normalizeCustomer(r: Record<string, unknown>): CustomerRow {
  return {
    id: Number(r.id),
    name: String(r.name),
    phone: (r.phone as string | null) ?? null,
    whatsapp: (r.whatsapp as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    creditLimit: r.creditLimit === null || r.creditLimit === undefined ? null : money(r.creditLimit as string | number),
    openingBalance: money((r.openingBalance as string | number | null) ?? 0),
    openingCurrencyId:
      r.openingCurrencyId === null || r.openingCurrencyId === undefined ? null : Number(r.openingCurrencyId),
    openingRate: r.openingRate === null || r.openingRate === undefined ? null : money(r.openingRate as string | number),
    openingDate: (r.openingDate as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    imagePath: (r.imagePath as string | null) ?? null,
    isArchived: Number(r.isArchived ?? 0),
    createdAt: (r.createdAt as string | null) ?? null,
    updatedAt: (r.updatedAt as string | null) ?? null,
    createdBy: r.createdBy === null || r.createdBy === undefined ? null : Number(r.createdBy),
  };
}

/** إنشاء عميل (FR-03-01) — ذرّي مع قيد تدقيق. يُرجع المعرّف الجديد. */
export async function createCustomer(input: PartyInput): Promise<number> {
  const v = parseInput(input, 'العميل');
  const opening = await buildOpening(v.openingBalance, v.openingCurrencyId, v.openingRate, v.openingDate);
  const db = await getDb();
  const now = new Date().toISOString();
  let newId = 0;
  await db.transaction(async () => {
    const res = await db.run(
      'INSERT INTO customer(name, phone, whatsapp, address, area, credit_limit, opening_balance, ' +
        'opening_balance_currency_id, opening_balance_rate, opening_balance_date, notes, is_archived, created_at, updated_at, created_by) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [
        v.name,
        v.phone && v.phone.length > 0 ? v.phone : null,
        v.whatsapp && v.whatsapp.length > 0 ? v.whatsapp : null,
        v.address && v.address.length > 0 ? v.address : null,
        v.area && v.area.length > 0 ? v.area : null,
        v.creditLimit === null ? null : v.creditLimit === undefined ? null : money(v.creditLimit),
        opening.balance,
        opening.currencyId,
        opening.rate,
        opening.date,
        v.notes && v.notes.length > 0 ? v.notes : null,
        now,
        now,
        getCurrentUserId() ?? null,
      ],
    );
    newId = Number(res.lastInsertRowId);
    await logAudit('create_customer', {
      entity: 'customer',
      entityId: newId,
      details: {
        name: v.name,
        opening: opening.balance === '0' ? null : { balance: opening.balance, currencyId: opening.currencyId, rate: opening.rate, date: opening.date },
        creditLimit: v.creditLimit ?? null,
      },
    });
  });
  return newId;
}

/** تعديل عميل — الحقول غير الممررة تبقى كما هي (Partial). */
export async function updateCustomer(id: number, input: Partial<PartyInput>): Promise<void> {
  const v = parseUpdate(input, 'العميل');
  const db = await getDb();
  const existing = await db.all<Record<string, unknown>>(`${CUSTOMER_SELECT} WHERE id = ?`, [id]);
  if (existing.length === 0) {
    throw new Error(`عميل غير موجود (رقم ${id}) — لا يمكن تعديله`);
  }
  const cur = normalizeCustomer(existing[0]);

  // دمج الرصيد الافتتاحي: ما لم يُمرَّر يبقى من الصف الحالي (ثم يُعاد بناؤه بقواعده)
  const opening = await buildOpening(
    v.openingBalance !== undefined ? v.openingBalance : cur.openingBalance,
    v.openingCurrencyId !== undefined ? v.openingCurrencyId : cur.openingCurrencyId ?? undefined,
    v.openingRate !== undefined ? v.openingRate : cur.openingRate ?? undefined,
    v.openingDate !== undefined ? v.openingDate : cur.openingDate ?? undefined,
  );

  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (v.name !== undefined) {
    sets.push('name = ?');
    params.push(v.name);
  }
  if (v.phone !== undefined) {
    sets.push('phone = ?');
    params.push(v.phone.length > 0 ? v.phone : null);
  }
  if (v.whatsapp !== undefined) {
    sets.push('whatsapp = ?');
    params.push(v.whatsapp.length > 0 ? v.whatsapp : null);
  }
  if (v.address !== undefined) {
    sets.push('address = ?');
    params.push(v.address.length > 0 ? v.address : null);
  }
  if (v.area !== undefined) {
    sets.push('area = ?');
    params.push(v.area.length > 0 ? v.area : null);
  }
  if (v.creditLimit !== undefined) {
    // undefined = لا تغيير / null = بلا حد (NULL) / نص = قيمة
    sets.push('credit_limit = ?');
    params.push(v.creditLimit === null ? null : money(v.creditLimit));
  }
  if (v.notes !== undefined) {
    sets.push('notes = ?');
    params.push(v.notes.length > 0 ? v.notes : null);
  }
  sets.push('opening_balance = ?', 'opening_balance_currency_id = ?', 'opening_balance_rate = ?', 'opening_balance_date = ?');
  params.push(opening.balance, opening.currencyId, opening.rate, opening.date);

  params.push(id);
  await db.transaction(async () => {
    await db.run(`UPDATE customer SET ${sets.join(', ')} WHERE id = ?`, params);
    await logAudit('update_customer', {
      entity: 'customer',
      entityId: id,
      details: { fields: Object.keys(v), opening: opening.balance === '0' ? null : opening },
    });
  });
}

/**
 * أرشفة عميل (FR-03-09): لا حذف إطلاقاً — الطرف له حركات يُؤرشف فقط،
 * وحتى بلا حركات لا يوفر الدومين مسار حذف (قرار حماية البيانات).
 */
export async function archiveCustomer(id: number): Promise<void> {
  const db = await getDb();
  const row = await db.all<{ name: string; is_archived: number }>(
    'SELECT name, is_archived FROM customer WHERE id = ?',
    [id],
  );
  if (row.length === 0) {
    throw new Error(`عميل غير موجود (رقم ${id}) — لا يمكن أرشفته`);
  }
  if (Number(row[0].is_archived) === 1) return; // مؤرشف مسبقاً — نجاح صامت
  const inv = await db.all<{ c: number }>('SELECT count(*) AS c FROM invoice WHERE customer_id = ?', [id]);
  const cash = await db.all<{ c: number }>('SELECT count(*) AS c FROM cash_tx WHERE customer_id = ?', [id]);
  await db.transaction(async () => {
    await db.run('UPDATE customer SET is_archived = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    await logAudit('archive_customer', {
      entity: 'customer',
      entityId: id,
      details: {
        name: row[0].name,
        invoices: Number(inv[0]?.c ?? 0),
        cashTxs: Number(cash[0]?.c ?? 0),
        rule: 'FR-03-09: أرشفة فقط — لا حذف لطرف له حركات',
      },
    });
  });
}

/** جلب عميل أو null. */
export async function getCustomer(id: number): Promise<CustomerRow | null> {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(`${CUSTOMER_SELECT} WHERE id = ?`, [id]);
  return rows.length > 0 ? normalizeCustomer(rows[0]) : null;
}

// ============ الموردون (FR-03-03) ============

const SUPPLIER_SELECT =
  'SELECT id, name, phone, address, opening_balance AS openingBalance, ' +
  'opening_balance_currency_id AS openingCurrencyId, opening_balance_rate AS openingRate, ' +
  'opening_balance_date AS openingDate, notes, is_archived AS isArchived, ' +
  'created_at AS createdAt, updated_at AS updatedAt, created_by AS createdBy FROM supplier';

function normalizeSupplier(r: Record<string, unknown>): SupplierRow {
  return {
    id: Number(r.id),
    name: String(r.name),
    phone: (r.phone as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    openingBalance: money((r.openingBalance as string | number | null) ?? 0),
    openingCurrencyId:
      r.openingCurrencyId === null || r.openingCurrencyId === undefined ? null : Number(r.openingCurrencyId),
    openingRate: r.openingRate === null || r.openingRate === undefined ? null : money(r.openingRate as string | number),
    openingDate: (r.openingDate as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    isArchived: Number(r.isArchived ?? 0),
    createdAt: (r.createdAt as string | null) ?? null,
    updatedAt: (r.updatedAt as string | null) ?? null,
    createdBy: r.createdBy === null || r.createdBy === undefined ? null : Number(r.createdBy),
  };
}

/** إنشاء مورّد بنفس بنية العميل (FR-03-03) — رصيده الافتتاحي دائن مستحق له. */
export async function createSupplier(input: SupplierInput): Promise<number> {
  const v = parseInput(input, 'المورّد');
  const opening = await buildOpening(v.openingBalance, v.openingCurrencyId, v.openingRate, v.openingDate);
  const db = await getDb();
  const now = new Date().toISOString();
  let newId = 0;
  await db.transaction(async () => {
    const res = await db.run(
      'INSERT INTO supplier(name, phone, address, opening_balance, opening_balance_currency_id, ' +
        'opening_balance_rate, opening_balance_date, notes, is_archived, created_at, updated_at, created_by) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [
        v.name,
        v.phone && v.phone.length > 0 ? v.phone : null,
        v.address && v.address.length > 0 ? v.address : null,
        opening.balance,
        opening.currencyId,
        opening.rate,
        opening.date,
        v.notes && v.notes.length > 0 ? v.notes : null,
        now,
        now,
        getCurrentUserId() ?? null,
      ],
    );
    newId = Number(res.lastInsertRowId);
    await logAudit('create_supplier', {
      entity: 'supplier',
      entityId: newId,
      details: {
        name: v.name,
        opening: opening.balance === '0' ? null : { balance: opening.balance, currencyId: opening.currencyId, rate: opening.rate, date: opening.date },
      },
    });
  });
  return newId;
}

/** تعديل مورّد — Partial بنفس دلالات العميل. */
export async function updateSupplier(id: number, input: Partial<SupplierInput>): Promise<void> {
  const v = parseUpdate(input, 'المورّد');
  const db = await getDb();
  const existing = await db.all<Record<string, unknown>>(`${SUPPLIER_SELECT} WHERE id = ?`, [id]);
  if (existing.length === 0) {
    throw new Error(`مورّد غير موجود (رقم ${id}) — لا يمكن تعديله`);
  }
  const cur = normalizeSupplier(existing[0]);
  const opening = await buildOpening(
    v.openingBalance !== undefined ? v.openingBalance : cur.openingBalance,
    v.openingCurrencyId !== undefined ? v.openingCurrencyId : cur.openingCurrencyId ?? undefined,
    v.openingRate !== undefined ? v.openingRate : cur.openingRate ?? undefined,
    v.openingDate !== undefined ? v.openingDate : cur.openingDate ?? undefined,
  );

  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (v.name !== undefined) {
    sets.push('name = ?');
    params.push(v.name);
  }
  if (v.phone !== undefined) {
    sets.push('phone = ?');
    params.push(v.phone.length > 0 ? v.phone : null);
  }
  if (v.address !== undefined) {
    sets.push('address = ?');
    params.push(v.address.length > 0 ? v.address : null);
  }
  if (v.notes !== undefined) {
    sets.push('notes = ?');
    params.push(v.notes.length > 0 ? v.notes : null);
  }
  sets.push('opening_balance = ?', 'opening_balance_currency_id = ?', 'opening_balance_rate = ?', 'opening_balance_date = ?');
  params.push(opening.balance, opening.currencyId, opening.rate, opening.date);

  params.push(id);
  await db.transaction(async () => {
    await db.run(`UPDATE supplier SET ${sets.join(', ')} WHERE id = ?`, params);
    await logAudit('update_supplier', { entity: 'supplier', entityId: id, details: { fields: Object.keys(v) } });
  });
}

/** أرشفة مورّد — نفس قاعدة FR-03-09 (لا حذف أبداً). */
export async function archiveSupplier(id: number): Promise<void> {
  const db = await getDb();
  const row = await db.all<{ name: string; is_archived: number }>(
    'SELECT name, is_archived FROM supplier WHERE id = ?',
    [id],
  );
  if (row.length === 0) {
    throw new Error(`مورّد غير موجود (رقم ${id}) — لا يمكن أرشفته`);
  }
  if (Number(row[0].is_archived) === 1) return;
  const inv = await db.all<{ c: number }>('SELECT count(*) AS c FROM invoice WHERE supplier_id = ?', [id]);
  const cash = await db.all<{ c: number }>('SELECT count(*) AS c FROM cash_tx WHERE supplier_id = ?', [id]);
  await db.transaction(async () => {
    await db.run('UPDATE supplier SET is_archived = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    await logAudit('archive_supplier', {
      entity: 'supplier',
      entityId: id,
      details: {
        name: row[0].name,
        invoices: Number(inv[0]?.c ?? 0),
        cashTxs: Number(cash[0]?.c ?? 0),
        rule: 'FR-03-09: أرشفة فقط — لا حذف لطرف له حركات',
      },
    });
  });
}

/** جلب مورّد أو null. */
export async function getSupplier(id: number): Promise<SupplierRow | null> {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(`${SUPPLIER_SELECT} WHERE id = ?`, [id]);
  return rows.length > 0 ? normalizeSupplier(rows[0]) : null;
}

// ============ المعادلة الملزمة — الأرصدة لكل عملة (FR-03-02 + قرار 8) ============

interface CurrencyAgg {
  opening: Decimal;
  docs: Decimal;
  payments: Decimal;
  returns: Decimal;
  hasRows: boolean;
}

function aggEntry(map: Map<number, CurrencyAgg>, currencyId: number): CurrencyAgg {
  let e = map.get(currencyId);
  if (e === undefined) {
    e = { opening: dec(0), docs: dec(0), payments: dec(0), returns: dec(0), hasRows: false };
    map.set(currencyId, e);
  }
  return e;
}

/**
 * محرك الأرصدة المشترك (عميل/مورّد) — يجمع الصفوف الخام ويجمعها بـ Decimal
 * (دقة كاملة بلا float)، لكل عملة على حدة (قرار 8).
 */
async function partyBalances(
  kind: 'customer' | 'supplier',
  partyId: number,
): Promise<PartyBalance[]> {
  const db = await getDb();
  const table = kind === 'customer' ? 'customer' : 'supplier';
  const idCol = kind === 'customer' ? 'customer_id' : 'supplier_id';
  const purchaseType = kind === 'customer' ? 'sale' : 'purchase';
  const returnType = kind === 'customer' ? 'sale_return' : 'purchase_return';
  const cashType = kind === 'customer' ? 'receipt' : 'payment';

  // 1) الصف الحالي (الرصيد الافتتاحي بعملته)
  const partyRows = await db.all<{
    opening_balance: string | number | null;
    opening_balance_currency_id: number | null;
  }>(`SELECT opening_balance, opening_balance_currency_id FROM ${table} WHERE id = ?`, [partyId]);
  if (partyRows.length === 0) {
    throw new Error(kind === 'customer' ? `عميل غير موجود (رقم ${partyId})` : `مورّد غير موجود (رقم ${partyId})`);
  }

  const perCurrency = new Map<number, CurrencyAgg>();
  const openingAmount = dec(partyRows[0].opening_balance ?? 0);
  const openingCurrencyId = partyRows[0].opening_balance_currency_id;
  if (openingCurrencyId !== null && openingCurrencyId !== undefined && !openingAmount.isZero()) {
    aggEntry(perCurrency, Number(openingCurrencyId)).opening = openingAmount;
  }

  // 2) الفواتير الآجلة والمرتجعات (الموجة 4 تملؤها — المعادلة جاهزة)
  const invRows = await db.all<{ currency_id: number; doc_type: string; pay_status: string; due_amount: string | number }>(
    'SELECT currency_id, doc_type, pay_status, due_amount FROM invoice ' +
      `WHERE ${idCol} = ? AND status = 'completed' AND doc_type IN (?, ?)`,
    [partyId, purchaseType, returnType],
  );
  for (const r of invRows) {
    const e = aggEntry(perCurrency, Number(r.currency_id));
    e.hasRows = true;
    if (r.doc_type === purchaseType && (r.pay_status === 'credit' || r.pay_status === 'mixed')) {
      e.docs = e.docs.plus(dec(r.due_amount));
    } else if (r.doc_type === returnType) {
      e.returns = e.returns.plus(dec(r.due_amount));
    }
  }

  // 3) السندات الفعلية (غير المعكوسة) المرتبطة بالطرف
  const cashRows = await db.all<{ currency_id: number; amount: string | number }>(
    'SELECT currency_id, amount FROM cash_tx ' +
      `WHERE ${idCol} = ? AND tx_type = ? AND is_voided = 0 ` +
      "AND ref_type IN ('invoice','installment','on_account')",
    [partyId, cashType],
  );
  for (const r of cashRows) {
    const e = aggEntry(perCurrency, Number(r.currency_id));
    e.hasRows = true;
    e.payments = e.payments.plus(dec(r.amount));
  }

  // 4) تجميع العملات المعنية (ذات حركة فعلة أو رصيد افتتاحي) وقراءة رموزها
  const involved = [...perCurrency.entries()]
    .filter(([, e]) => e.hasRows || !e.opening.isZero())
    .map(([currencyId, e]) => {
      const balance = e.opening.plus(e.docs).minus(e.payments).minus(e.returns);
      return { currencyId, balance };
    });
  if (involved.length === 0) return [];

  const curRows = await db.all<{ id: number; code: string; is_base: number }>(
    'SELECT id, code, is_base FROM currency',
  );
  const byId = new Map(curRows.map((c) => [Number(c.id), c]));

  return involved
    .filter((x) => byId.has(x.currencyId))
    .sort((a, b) => {
      const ba = Number(byId.get(a.currencyId)?.is_base ?? 0);
      const bb = Number(byId.get(b.currencyId)?.is_base ?? 0);
      if (ba !== bb) return bb - ba; // الأساس أولاً
      return (byId.get(a.currencyId)?.code ?? '').localeCompare(byId.get(b.currencyId)?.code ?? '');
    })
    .map((x) => ({
      currencyId: x.currencyId,
      code: byId.get(x.currencyId)?.code ?? String(x.currencyId),
      balance: money(x.balance),
    }));
}

/** أرصدة العميل لكل عملة على حدة — موجب = مدين عليه، سالب = دائن لصالحه (قرار 8). */
export async function customerBalances(customerId: number): Promise<PartyBalance[]> {
  return partyBalances('customer', customerId);
}

/** أرصدة المورّد لكل عملة على حدة — موجب = مستحق له (علينا)، سالب = دائن لصالحنا. */
export async function supplierBalances(supplierId: number): Promise<PartyBalance[]> {
  return partyBalances('supplier', supplierId);
}

// ============ البحث والقوائم السريعة ============

/** تهريب محارف LIKE الخاصة (% _ \). */
function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * رصيد الطرف بعملة الأساس — حساب مبسّط بعرضة واحدة (المطلوب للقائمة فقط):
 * مكونات عملة الأساس حصراً + الرصيد الافتتاحي (بسعره المسجل إن كان بعملة أخرى).
 * أرصدة العملات الأخرى تُعرض مفصولة في ملف الطرف (قرار 8 — العرض المجمّع V1.1).
 * SUM في SQLite يُرجع REAL — نقرّب لمنازل NUMERIC(14,4) ثم نطبع نصاً.
 */
async function searchParties(
  kind: 'customer' | 'supplier',
  q: string,
): Promise<CustomerListRow[]> {
  const db = await getDb();
  const base = await db.all<{ id: number }>('SELECT id FROM currency WHERE is_base = 1 LIMIT 1');
  if (base.length === 0) {
    throw new Error('لم تُعرَّف عملة أساسية بعد — أكمل الإعداد الأولي للتطبيق أولاً');
  }
  const baseId = Number(base[0].id);

  const table = kind === 'customer' ? 'customer' : 'supplier';
  const idCol = kind === 'customer' ? 'customer_id' : 'supplier_id';
  const purchaseType = kind === 'customer' ? 'sale' : 'purchase';
  const returnType = kind === 'customer' ? 'sale_return' : 'purchase_return';
  const cashType = kind === 'customer' ? 'receipt' : 'payment';

  const search = q.trim();
  const where =
    search.length > 0 ? " AND (p.name LIKE ? ESCAPE '\\' OR IFNULL(p.phone, '') LIKE ? ESCAPE '\\')" : '';
  // ترتيب المعاملات: عملة الأساس في CASE الافتتاحي، ثم (doc_type للآجل، العملة)،
  // (tx_type للسند، العملة)، (doc_type للمرتجع، العملة)، ثم معاملا البحث.
  const params: unknown[] = [
    baseId,
    purchaseType,
    baseId,
    cashType,
    baseId,
    returnType,
    baseId,
  ];
  if (search.length > 0) {
    const esc = `%${likeEscape(search)}%`;
    params.push(esc, esc);
  }

  const rows = await db.all<{ id: number; name: string; phone: string | null; area: string | null; base_balance: string | number }>(
    'SELECT p.id, p.name, p.phone' +
      (kind === 'customer' ? ', p.area' : ', NULL AS area') +
      ', CAST(ROUND(' +
      'CASE WHEN p.opening_balance_currency_id = ? THEN IFNULL(p.opening_balance, 0)' +
      '     WHEN p.opening_balance_currency_id IS NOT NULL AND p.opening_balance_rate IS NOT NULL' +
      '          AND IFNULL(p.opening_balance, 0) <> 0 THEN p.opening_balance * p.opening_balance_rate' +
      '     ELSE 0 END' +
      ` + IFNULL((SELECT SUM(i.due_amount) FROM invoice i WHERE i.${idCol} = p.id AND i.doc_type = ? AND i.status = 'completed' AND i.pay_status IN ('credit','mixed') AND i.currency_id = ?), 0)` +
      ` - IFNULL((SELECT SUM(t.amount) FROM cash_tx t WHERE t.${idCol} = p.id AND t.tx_type = ? AND t.is_voided = 0 AND t.ref_type IN ('invoice','installment','on_account') AND t.currency_id = ?), 0)` +
      ` - IFNULL((SELECT SUM(r.due_amount) FROM invoice r WHERE r.${idCol} = p.id AND r.doc_type = ? AND r.status = 'completed' AND r.currency_id = ?), 0)` +
      `, 4) AS TEXT) AS base_balance ` +
      `FROM ${table} p WHERE p.is_archived = 0${where} ORDER BY p.name ASC, p.id ASC LIMIT 300`,
    params,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    phone: (r.phone as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    baseBalance: money(dec(r.base_balance)),
  }));
}

/** بحث العملاء بالاسم/الهاتف (غير المؤرشفين) + رصيد مبسّط بعملة الأساس. */
export async function searchCustomers(q: string): Promise<CustomerListRow[]> {
  return searchParties('customer', q);
}

/** بحث الموردين بالاسم/الهاتف (غير المؤرشفين) + رصيد مبسّط بعملة الأساس. */
export async function searchSuppliers(q: string): Promise<SupplierListRow[]> {
  return searchParties('supplier', q);
}
