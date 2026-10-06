import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import {
  SETTING_DEFAULTS,
  SETTINGS_COUNT,
  getSetting,
  getSettings,
  setSetting,
  seedDefaultSettings,
  listSettingKeys,
  type SettingKey,
} from '@/domain/settings';

/**
 * اختبارات سجل الإعدادات (الملحق هـ — 17 مفتاحاً + 3 مفاتيح طباعة FR-13-03 أضيفت في الموجة 6-b):
 * الزرع idempotent، نطاق zod لكل مفتاح، القراءة بلا كتابة، الرفض برسائل عربية.
 */

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  disposeTestDb();
});

describe('settings: السجل نفسه', () => {
  test('20 مفتاحاً: 17 من الملحق هـ + 3 مفاتيح طباعة (FR-13-03)', () => {
    expect(SETTINGS_COUNT).toBe(20);
    expect(listSettingKeys()).toHaveLength(20);
    expect(Object.keys(SETTING_DEFAULTS)).toHaveLength(20);
  });

  test('المفاتيح المفصلية موجودة بأسمائها الحرفية', () => {
    const keys = listSettingKeys();
    expect(keys).toContain('fx.fallback');
    expect(keys).toContain('dating.max_backdate_days');
    expect(keys).toContain('invoicing.tax_mode');
    expect(keys).toContain('security.pin_lockout');
    expect(keys).toContain('backup.retention_count');
    expect(keys).toContain('printing.paper');
    expect(keys).toContain('printing.detailed');
    expect(keys).toContain('printing.copies');
  });
});

describe('settings: القراءة', () => {
  test('مفتاح غير مزروع → الافتراضي وبلا أي كتابة', async () => {
    expect(await getSetting('fx.fallback')).toBe('off');
    expect(await getSetting('dating.max_backdate_days')).toBe('30');
    const db = await getDb();
    const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM settings');
    expect(rows[0]?.c ?? -1).toBe(0); // لا كتابة عند القراءة أبداً
  });

  test('getSettings يدمج المخزن فوق الافتراضيات', async () => {
    const all = await getSettings();
    expect(Object.keys(all)).toHaveLength(20);
    expect(all['invoicing.print_on_save']).toBe('ask');
    expect(all['display.numerals']).toBe('western');
  });
});

describe('settings: الزرع idempotent', () => {
  test('الزرعة الأولى تكتب 20 صفاً بالقيم الافتراضية', async () => {
    await seedDefaultSettings();
    const db = await getDb();
    const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM settings');
    expect(rows[0]?.c ?? -1).toBe(20);
    expect(await getSetting('inventory.min_stock_alert')).toBe('on');
    expect(await getSetting('backup.schedule')).toBe('weekly');
  });

  test('الزرعة الثانية لا تضيف ولا تغير شيئاً (INSERT OR IGNORE)', async () => {
    await setSetting('inventory.min_stock_alert', 'off'); // قيمة عدلها «المستخدم»
    await seedDefaultSettings();
    const db = await getDb();
    const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM settings');
    expect(rows[0]?.c ?? -1).toBe(20);
    expect(await getSetting('inventory.min_stock_alert')).toBe('off'); // بقيت كما عدلها
  });
});

describe('settings: setSetting والنطاق (zod)', () => {
  test('قيمة صالحة تُخزن وتُقرأ', async () => {
    await setSetting('fx.fallback', 'last_known');
    expect(await getSetting('fx.fallback')).toBe('last_known');
  });

  test('قيمة خارج التعداد → رفض عربي وبلا كتابة', async () => {
    let msg = '';
    try {
      await setSetting('invoicing.tax_mode', 'x');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('قيمة غير صالحة للإعداد');
    expect(msg).toContain('invoicing.tax_mode');
    expect(await getSetting('invoicing.tax_mode')).toBe('on_total'); // لم تتغير
  });

  test('fx.fallback يقبل قيمتيه فقط', async () => {
    await expect(setSetting('fx.fallback', 'yesterday')).rejects.toThrow();
    await setSetting('fx.fallback', 'off');
  });

  test('النطاقات الرقمية: backup.retention_count (1–30)', async () => {
    await expect(setSetting('backup.retention_count', '31')).rejects.toThrow();
    await expect(setSetting('backup.retention_count', '0')).rejects.toThrow();
    await setSetting('backup.retention_count', '30');
    expect(await getSetting('backup.retention_count')).toBe('30');
  });

  test('النطاقات الرقمية: security.autolock_minutes (1–60) وdating.max_backdate_days (1–365)', async () => {
    await expect(setSetting('security.autolock_minutes', '0')).rejects.toThrow();
    await setSetting('security.autolock_minutes', '60');
    await expect(setSetting('dating.max_backdate_days', '400')).rejects.toThrow();
    await setSetting('dating.max_backdate_days', '365');
    expect(await getSetting('dating.max_backdate_days')).toBe('365');
  });

  test('security.pin_lockout ثابتة النظام — لا تقبل غير «on»', async () => {
    await expect(setSetting('security.pin_lockout', 'off')).rejects.toThrow();
    expect(await getSetting('security.pin_lockout')).toBe('on');
  });
});

describe('settings: مفاتيح غير معروفة', () => {
  test('مفتاح خارج السجل → رفض صريح (FR-13-09)', async () => {
    let msg = '';
    try {
      await setSetting('not.in.registry' as SettingKey, 'x');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('مفتاح إعداد غير معروف');
  });
});
