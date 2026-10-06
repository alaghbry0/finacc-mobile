import { z } from 'zod';
import { getDb } from '@/db/client';
import { getCurrentUserId } from './session-user';

/**
 * سجل الإعدادات — الملحق هـ من SRS v1.2 حرفياً (FR-13-09):
 * لا يجوز إضافة أي إعداد خارج هذا السجل، ولا استخدام «حسب الإعداد» في أي نص بلا مفتاح منه.
 * التخزين: جدول settings (key TEXT PK, value TEXT) — القراءة تُرجع القيمة أو الافتراضي
 * (لا كتابة أبداً أثناء القراءة)، والكتابة تتحقق بـ zod من نطاق كل مفتاح.
 */

/** القيم الافتراضية النصية لكل مفاتيح الملحق هـ (17 مفتاحاً). */
export const SETTING_DEFAULTS = {
  'inventory.min_stock_alert': 'on', // on/off
  'inventory.auto_price_margin': '0', // 0–100 (نطاق V1.1)
  'invoicing.tax_mode': 'on_total', // per_item/on_total
  'invoicing.discount_below_margin': 'off', // off/warn/block
  'invoicing.print_on_save': 'ask', // print/no/ask
  'invoicing.payment_sheet': 'on', // on/off
  'sale.over_avail_policy': 'warn', // warn/add_available
  'parties.credit_limit_action': 'warn', // warn/block
  'fx.daily_reminder': 'on', // on/off
  'fx.fallback': 'off', // off/last_known (قرار 3)
  'display.numerals': 'western', // western/arabic_indic
  'ui.high_contrast': 'off', // on/off
  'backup.schedule': 'weekly', // daily/weekly/off
  'backup.retention_count': '7', // 1–30
  'security.autolock_minutes': '5', // 1–60
  'security.pin_lockout': 'on', // ثابتة النظام (لا تُعدل)
  'dating.max_backdate_days': '30', // 1–365
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/** عدد المفاتيح — حارس انحدار: 17 حرفياً كما في الملحق هـ. */
export const SETTINGS_COUNT = SETTING_KEYS.length;

// ---------- مخططات zod لكل مفتاح (نطاق القيم من الملحق هـ) ----------

const onOff = z.enum(['on', 'off']);

/** رقم صحيح نصي ضمن نطاق شامل. */
function intRange(min: number, max: number): z.ZodType<string> {
  return z
    .string()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max, {
      message: `قيمة خارج النطاق المسموح (${min}–${max})`,
    });
}

const SETTING_SCHEMAS: Record<SettingKey, z.ZodType<string>> = {
  'inventory.min_stock_alert': onOff,
  'inventory.auto_price_margin': intRange(0, 100),
  'invoicing.tax_mode': z.enum(['per_item', 'on_total']),
  'invoicing.discount_below_margin': z.enum(['off', 'warn', 'block']),
  'invoicing.print_on_save': z.enum(['print', 'no', 'ask']),
  'invoicing.payment_sheet': onOff,
  'sale.over_avail_policy': z.enum(['warn', 'add_available']),
  'parties.credit_limit_action': z.enum(['warn', 'block']),
  'fx.daily_reminder': onOff,
  'fx.fallback': z.enum(['off', 'last_known']),
  'display.numerals': z.enum(['western', 'arabic_indic']),
  'ui.high_contrast': onOff,
  'backup.schedule': z.enum(['daily', 'weekly', 'off']),
  'backup.retention_count': intRange(1, 30),
  'security.autolock_minutes': intRange(1, 60),
  'security.pin_lockout': z.enum(['on']), // ثابتة النظام: مفعّل دائماً ولا يُعدَّل
  'dating.max_backdate_days': intRange(1, 365),
};

/** قائمة مفاتيح السجل (للاختبارات وللشاشات). */
export function listSettingKeys(): SettingKey[] {
  return [...SETTING_KEYS];
}

/** قراءة إعداد واحد: القيمة المخزنة أو الافتراضي — بلا أي كتابة. */
export async function getSetting(key: SettingKey): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows.length > 0 ? String(rows[0].value) : SETTING_DEFAULTS[key];
}

/** قراءة كل الإعدادات (المخزن مدمجاً فوق الافتراضيات). */
export async function getSettings(): Promise<Record<SettingKey, string>> {
  const db = await getDb();
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = new Map(rows.map((r) => [r.key, String(r.value)]));
  const out = {} as Record<SettingKey, string>;
  for (const k of SETTING_KEYS) out[k] = stored.get(k) ?? SETTING_DEFAULTS[k];
  return out;
}

/** كتابة إعداد بعد التحقق بنطاقه — رفض برسالة عربية واضحة، ولا كتابة عند الفشل. */
export async function setSetting(key: SettingKey, value: string): Promise<void> {
  if (!SETTING_KEYS.includes(key)) {
    throw new Error(`مفتاح إعداد غير معروف: «${key}» — لا يجوز استخدام أي إعداد خارج سجل الملحق هـ`);
  }
  const parsed = SETTING_SCHEMAS[key].safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `قيمة غير صالحة للإعداد «${key}»: «${value}» (${issue?.message ?? 'خارج النطاق'}) — ` +
        `راجع القيم المسموحة في سجل الإعدادات (ملحق هـ) واختر قيمة صحيحة`,
    );
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const updatedBy = getCurrentUserId();
  await db.run(
    'INSERT INTO settings(key, value, updated_at, updated_by) VALUES(?, ?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    [key, parsed.data, now, updatedBy ?? null],
  );
}

/** زرع الافتراضيات — idempotent (INSERT OR IGNORE): لا يمس أي قيمة عدّلها المستخدم. */
export async function seedDefaultSettings(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    for (const k of SETTING_KEYS) {
      await db.run('INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES(?, ?, ?)', [
        k,
        SETTING_DEFAULTS[k],
        now,
      ]);
    }
  });
}
