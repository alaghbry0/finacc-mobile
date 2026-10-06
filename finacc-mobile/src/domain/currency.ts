import { z } from 'zod';
import { getDb } from '@/db/client';
import { dec, money, Decimal } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getSetting } from './settings';
import { logAudit } from './audit';
import { getCurrentUserId } from './session-user';

/**
 * العملات وأسعار الصرف (الوحدة 08 + قرار 3 + قرار 8):
 * - السعر يدوي لكل يوم (لا API موثوق للريال اليمني) — Snapshot لكل حركة (FR-08-05).
 * - سياسة السعر المفقود (قرار 3 / FR-08-09): لا سعر لهذا التاريخ → يُمنع الحفظ
 *   (MissingRateError تستقبلها الواجهة بـ BottomSheet فوري) — الإعداد fx.fallback
 *   (افتراضي off) عند تفعيله = آخر سعر معروف مع علم rate_is_fallback=1.
 * - لا يوجد أي DEFAULT 1 في أي عمود exchange_rate (قرار 3 حرفياً).
 */

export class MissingRateError extends Error {
  readonly currencyId: number;
  readonly date: string;
  constructor(currencyId: number, date: string) {
    super(
      `لا يوجد سعر صرف للعملة (رقم ${currencyId}) بتاريخ ${date} — ` +
        `أدخل سعر اليوم من شاشة أسعار الصرف ثم أعد الحفظ، أو فعّل «استخدام آخر سعر معروف» من الإعدادات (fx.fallback)`,
    );
    this.name = 'MissingRateError';
    this.currencyId = currencyId;
    this.date = date;
  }
}

export interface RateSnapshot {
  /** سعر التحويل إلى العملة الأساسية (نص عشري مطبع — يُخزَّن في المستند كما هو). */
  rate: string;
  /** true عند استخدام آخر سعر معروف بموجب fx.fallback=last_known (شارة على الفاتورة FR-02-20). */
  rateIsFallback: boolean;
}

/** صف عملة كما يعيده SQL الخام (أعمدة snake_case — مطابق لجدول currency في الهجرة 0001). */
export interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol_svg: string | null;
  is_base: number;
  decimals: number;
  is_active: number;
}

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`تاريخ غير صالح لسعر الصرف: «${date}» — استخدم صيغة YYYY-MM-DD مثل 2026-05-15`);
  }
}

/** لقطة سعر يومٍ محدد لعملة — قلب سياسة قرار 3. */
export async function getRateSnapshot(currencyId: number, date: string): Promise<RateSnapshot> {
  assertIsoDate(date);
  const db = await getDb();
  const cur = await db.all<{ is_base: number }>('SELECT is_base FROM currency WHERE id = ?', [currencyId]);
  if (cur.length === 0) {
    throw new Error(`عملة غير موجودة (رقم ${currencyId}) — راجع شاشة العملات أو أعد الإعداد الأولي`);
  }
  if (Number(cur[0].is_base) === 1) {
    return { rate: '1', rateIsFallback: false };
  }
  const exact = await db.all<{ rate: string | number }>(
    'SELECT rate FROM exchange_rate WHERE currency_id = ? AND rate_date = ?',
    [currencyId, date],
  );
  if (exact.length > 0) {
    return { rate: money(exact[0].rate), rateIsFallback: false };
  }
  const fallbackMode = await getSetting('fx.fallback');
  if (fallbackMode === 'last_known') {
    // آخر سعر معروف «حتى تاريخ الحركة» (بلا نظر للمستقبل المحاسبي)
    const last = await db.all<{ rate: string | number }>(
      'SELECT rate FROM exchange_rate WHERE currency_id = ? AND rate_date <= ? ORDER BY rate_date DESC, id DESC LIMIT 1',
      [currencyId, date],
    );
    if (last.length > 0) {
      return { rate: money(last[0].rate), rateIsFallback: true };
    }
  }
  throw new MissingRateError(currencyId, date);
}

const rateSchema = z
  .string()
  .trim()
  .refine((s) => /^-?\d+(\.\d+)?$/.test(s) && dec(s).greaterThan(0), {
    message: 'سعر الصرف يجب أن يكون رقماً أكبر من صفر (مثل 250 أو 250.5)',
  });

/** إدخال/تحديث سعر يوم لعملة — UPSERT على UNIQUE(currency_id, rate_date) + قيد تدقيق fx_edit (FR-12-04). */
export async function setDailyRate(currencyId: number, date: string, rate: string): Promise<void> {
  assertIsoDate(date);
  const parsed = rateSchema.safeParse(rate);
  if (!parsed.success) {
    throw new Error(
      `قيمة سعر صرف غير صالحة: «${rate}» (${parsed.error.issues[0]?.message ?? 'ليست رقماً موجباً'}) — ` +
        'أدخل رقماً أكبر من صفر مثل «250»',
    );
  }
  const value = money(parsed.data);
  const db = await getDb();
  const exists = await db.all<{ id: number }>('SELECT id FROM currency WHERE id = ?', [currencyId]);
  if (exists.length === 0) {
    throw new Error(`عملة غير موجودة (رقم ${currencyId}) — لا يمكن تسجيل سعر لعملة غير معرفة`);
  }
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO exchange_rate(currency_id, rate_date, rate, source, created_at, created_by) ' +
      'VALUES(?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(currency_id, rate_date) DO UPDATE SET rate = excluded.rate',
    [currencyId, date, value, 'manual', now, getCurrentUserId() ?? null],
  );
  await logAudit('fx_edit', {
    entity: 'exchange_rate',
    entityId: currencyId,
    details: { currencyId, date, rate: value },
  });
}

/** آخر سعر معروف لعملة (أي تاريخ) أو null — يُستخدم للعرض والتذكير اليومي. */
export async function getLatestRate(currencyId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.all<{ rate: string | number }>(
    'SELECT rate FROM exchange_rate WHERE currency_id = ? ORDER BY rate_date DESC, id DESC LIMIT 1',
    [currencyId],
  );
  return rows.length > 0 ? money(rows[0].rate) : null;
}

/** العملات المفعلة (is_active=1) — الأساسية أولاً ثم بالرمز. */
export async function listActiveCurrencies(): Promise<CurrencyRow[]> {
  const db = await getDb();
  return db.all<CurrencyRow>(
    'SELECT id, code, name, symbol_svg, is_base, decimals, is_active FROM currency WHERE is_active = 1 ' +
      'ORDER BY is_base DESC, code ASC',
  );
}

/** العملة الأساسية — يفترض وجودها بعد الإعداد الأولي (واحدة فقط is_base=1). */
export async function getBaseCurrency(): Promise<CurrencyRow> {
  const db = await getDb();
  const rows = await db.all<CurrencyRow>(
    'SELECT id, code, name, symbol_svg, is_base, decimals, is_active FROM currency WHERE is_base = 1 LIMIT 1',
  );
  if (rows.length === 0) {
    throw new Error('لم تُعرَّف عملة أساسية بعد — أكمل الإعداد الأولي للتطبيق أولاً');
  }
  return rows[0];
}

/** تحويل مبلغ بعملة أجنبية إلى العملة الأساسية بسعر محدد (مبلغ × سعر). */
export function convertToBase(amount: Decimal, rate: Decimal): Decimal {
  return amount.times(rate);
}

// ============ إدارة العملات (Task 3-b — FR-08-02) ============

const addCurrencySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}$/, 'رمز العملة يجب أن يكون 2–8 أحرف لاتينية مثل SAR أو USD'),
  name: z.string().trim().min(1, 'اسم العملة مطلوب — مثل «ريال سعودي»').max(60, 'اسم العملة طويل (60 حرفاً كحد أقصى)'),
  decimals: z.number().int().min(0, 'عدد المنازل بين 0 و6').max(6, 'عدد المنازل بين 0 و6'),
});

/**
 * إضافة عملة جديدة (FR-08-02): رمز فريد كبير (SAR/USD/AED…) + اسم + منازل عشرية.
 * تُنشأ مفعّلة (is_active=1) وغير أساسية (is_base=0 — الأساس يتحدد في الإعداد الأولي فقط FR-08-01).
 */
export async function addCurrency(input: { code: string; name: string; decimals: number }): Promise<number> {
  const parsed = addCurrencySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`مدخلات عملة جديدة غير صالحة: ${issue?.message ?? 'راجع الحقول'} (الحقل: ${issue?.path?.join('.') ?? '?'})`);
  }
  const code = parsed.data.code.toUpperCase();
  const db = await getDb();
  // فحص التميز (كود العملة UNIQUE — نفحص القضية أيضاً منعاً لـ sar/SAR)
  const dup = await db.all<{ id: number }>('SELECT id FROM currency WHERE UPPER(code) = UPPER(?)', [code]);
  if (dup.length > 0) {
    throw new Error(`رمز العملة «${code}» مستخدم مسبقاً — اختر رمزاً آخر أو أعد تفعيل العملة الموقوفة من القائمة`);
  }
  let newId = 0;
  await db.transaction(async () => {
    const res = await db.run('INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, 0, ?, 1)', [
      code,
      parsed.data.name,
      parsed.data.decimals,
    ]);
    newId = Number(res.lastInsertRowId);
    await logAudit('currency_add', {
      entity: 'currency',
      entityId: newId,
      details: { code, name: parsed.data.name, decimals: parsed.data.decimals },
    });
  });
  return newId;
}

/**
 * تفعيل/تعطيل عملة — **العملة الأساسية لا تُعطّل أبداً** (FR-08-01: تتحدد في الإعداد الأولي ثم تثبت).
 * تعطيل عملة لا يحذف أسعارها ولا أرصدتها؛ يزيلها فقط من القوائم والفواتير الجديدة.
 */
export async function setCurrencyActive(id: number, active: boolean): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{ code: string; is_base: number }>('SELECT code, is_base FROM currency WHERE id = ?', [id]);
  if (rows.length === 0) {
    throw new Error(`عملة غير موجودة (رقم ${id}) — لا يمكن تغيير حالتها`);
  }
  if (Number(rows[0].is_base) === 1 && !active) {
    throw new Error(`العملة الأساسية «${rows[0].code}» لا يمكن تعطيلها — العملة الأساسية تتحدد في الإعداد الأولي فقط ثم تثبت (FR-08-01)`);
  }
  await db.transaction(async () => {
    await db.run('UPDATE currency SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await logAudit('currency_set_active', {
      entity: 'currency',
      entityId: id,
      details: { code: rows[0].code, active },
    });
  });
}

/** صف من سجل أسعار عملة. */
export interface RateHistoryRow {
  rateDate: string;
  rate: string;
}

/**
 * سجل أسعار العملة تنازلياً (الأحدث أولاً — FR-08-03).
 * limitDays: حد عدد الصفوف المعادة (الافتراضي 30؛ القائمة تعرض آخر 14 سعراً).
 */
export async function rateHistory(currencyId: number, limitDays = 30): Promise<RateHistoryRow[]> {
  const db = await getDb();
  const rows = await db.all<{ rate_date: string; rate: string | number }>(
    'SELECT rate_date, rate FROM exchange_rate WHERE currency_id = ? ORDER BY rate_date DESC, id DESC LIMIT ?',
    [currencyId, Math.max(1, Math.min(Math.floor(limitDays), 365))],
  );
  return rows.map((r) => ({ rateDate: r.rate_date, rate: money(r.rate) }));
}

/** كل العملات (مفعّلة وموقوفة) — الأساسية أولاً ثم المفعّلة ثم بالرمز. لشاشة الإعدادات. */
export async function listAllCurrencies(): Promise<CurrencyRow[]> {
  const db = await getDb();
  return db.all<CurrencyRow>(
    'SELECT id, code, name, symbol_svg, is_base, decimals, is_active FROM currency ' +
      'ORDER BY is_base DESC, is_active DESC, code ASC',
  );
}

/**
 * العملات الفاعلة غير الأساسية التي لا سعر لها اليوم (FR-08-04/09 — أساس شارة
 * «لا سعر اليوم — أدخله» وشاشة التذكير). سعر اليوم مطلوب قبل أي حركة بعملة غير الأساس.
 */
export async function missingRateToday(): Promise<CurrencyRow[]> {
  const db = await getDb();
  return db.all<CurrencyRow>(
    'SELECT id, code, name, symbol_svg, is_base, decimals, is_active FROM currency c ' +
      'WHERE c.is_active = 1 AND c.is_base = 0 AND NOT EXISTS (' +
      '  SELECT 1 FROM exchange_rate e WHERE e.currency_id = c.id AND e.rate_date = ?) ' +
      'ORDER BY c.code ASC',
    [todayISO()],
  );
}
