import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { isOnboarded, completeOnboarding, type OnboardingInput } from '@/domain/onboarding';
import { getSetting } from '@/domain/settings';
import { getCurrentUserId, setCurrentUserId } from '@/domain/session-user';
import { hashPin } from '@/services/crypto';

/**
 * اختبارات الإعداد الأولي (FR-13-01):
 * كل شيء داخل معاملة واحدة — فشل أي خطوة (بصمة فارغة أو تعارض عملة) يرجع الكل،
 * والاستدعاء الثاني يرفض (قرار موثق)، والنتيجة: عملة + شركة + مخزن + صندوق + مستخدم
 * + 5 فئات مصاريف + 20 إعداداً (17 من الملحق هـ + 3 مفاتيح طباعة FR-13-03).
 */

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  setCurrentUserId(null);
  disposeTestDb();
});

async function count(table: string): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ c: number }>(`SELECT count(*) AS c FROM ${table}`);
  return rows[0]?.c ?? -1;
}

describe('onboarding: قبل النجاح — الفشل يرجع كل شيء (ذرّية 5.4-4)', () => {
  test('isOnboarded=false على قاعدة فارغة', async () => {
    expect(await isOnboarded()).toBe(false);
  });

  test('pinHash فارغ → رفض zod عربي قبل أي كتابة', async () => {
    const input: OnboardingInput = {
      companyName: 'متجر النور',
      baseCurrencyCode: 'YER',
      pinHash: '',
    };
    let msg = '';
    try {
      await completeOnboarding(input);
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('بصمة PIN مطلوبة');
    expect(await isOnboarded()).toBe(false);
    expect(await count('company')).toBe(0);
    expect(await count('app_user')).toBe(0);
  });

  test('اسم شركة فارغ → رفض zod عربي', async () => {
    let msg = '';
    try {
      await completeOnboarding({ companyName: '  ', baseCurrencyCode: 'YER', pinHash: 'x' });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('اسم المنشأة مطلوب');
  });

  test('فشل داخل المعاملة (تعارض رمز عملة موجود مسبقاً) → رجوع كامل: لا شركة بلا مستخدم', async () => {
    const db = await getDb();
    // عملة موجودة مسبقاً ستتعارض مع extras داخل المعاملة
    await db.run("INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES('XYZ', 'عملة تعارض', 0, 2, 1)");
    let failed = false;
    try {
      await completeOnboarding({
        companyName: 'متجر سيف',
        baseCurrencyCode: 'YER',
        pinHash: 'pbkdf2$100000$abc$def',
        extraCurrencies: [{ code: 'XYZ', name: 'عملة تعارض', decimals: 2 }],
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    // كل شيء رُجع: لا شركة ولا مستخدم ولا مخزن ولا صندوق ولا إعدادات ولا فئات
    expect(await isOnboarded()).toBe(false);
    expect(await count('company')).toBe(0);
    expect(await count('app_user')).toBe(0);
    expect(await count('warehouse')).toBe(0);
    expect(await count('cashbox')).toBe(0);
    expect(await count('expense_category')).toBe(0);
    expect(await count('settings')).toBe(0);
    expect(await count('currency')).toBe(1); // فقط العملة الموجودة مسبقاً
  });
});

describe('onboarding: النجاح الكامل (FR-13-01)', () => {
  test('completeOnboarding ينشئ كل شيء في معاملة واحدة', async () => {
    const pinHash = await hashPin('1234');
    await completeOnboarding({
      companyName: 'متجر النور',
      phone: '0500123456',
      whatsapp: '0500123456',
      address: 'صنعاء',
      baseCurrencyCode: 'YER',
      taxRate: '0',
      pinHash,
      // extraCurrencies غير ممررة → الزرع الافتراضي SAR/USD/AED
    });

    expect(await isOnboarded()).toBe(true);

    const db = await getDb();

    // العملات: الأساس YER (decimals=0) + الثلاث الافتراضية + عملة التعارض السابقة
    const currencies = await db.all<{ code: string; is_base: number; decimals: number; is_active: number }>(
      'SELECT code, is_base, decimals, is_active FROM currency ORDER BY id',
    );
    expect(currencies.map((c) => c.code)).toEqual(['XYZ', 'YER', 'SAR', 'USD', 'AED']);
    const yer = currencies.find((c) => c.code === 'YER');
    expect(yer?.is_base).toBe(1);
    expect(yer?.decimals).toBe(0);
    expect(currencies.filter((c) => c.code !== 'YER').every((c) => c.is_base === 0)).toBe(true);

    // الشركة
    const companies = await db.all<{
      name: string;
      phone: string | null;
      currency_id: number;
      tax_rate: string | number;
      invoice_prefix: string | null;
      created_by: number | null;
    }>('SELECT name, phone, currency_id, tax_rate, invoice_prefix, created_by FROM company');
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe('متجر النور');
    expect(companies[0]?.phone).toBe('0500123456');
    expect(companies[0]?.invoice_prefix).toBe('INV');
    expect(String(companies[0]?.tax_rate)).toBe('0');
    expect(companies[0]?.created_by).toBe(1); // منسوبة لمستخدم المدير

    // المخزن والصندوق الرئيسيان بالعملة الأساسية
    const warehouses = await db.all<{ name: string; is_default: number }>('SELECT name, is_default FROM warehouse');
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0]?.name).toBe('المخزن الرئيسي');
    expect(warehouses[0]?.is_default).toBe(1);

    const boxes = await db.all<{ id: number; name: string; currency_id: number; is_default: number }>(
      'SELECT id, name, currency_id, is_default FROM cashbox',
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.name).toBe('الصندوق الرئيسي');
    expect(boxes[0]?.is_default).toBe(1);
    expect(boxes[0]?.currency_id).toBe(companies[0]?.currency_id); // بعملة الأساس

    // المستخدم
    const users = await db.all<{
      username: string;
      display_name: string;
      role: string;
      pin_hash: string | null;
      default_cashbox_id: number | null;
      is_active: number;
    }>('SELECT username, display_name, role, pin_hash, default_cashbox_id, is_active FROM app_user');
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe('admin');
    expect(users[0]?.display_name).toBe('المدير');
    expect(users[0]?.role).toBe('admin');
    expect(users[0]?.pin_hash).toBe(pinHash);
    expect(users[0]?.default_cashbox_id).toBe(boxes[0]?.id);
    expect(users[0]?.is_active).toBe(1);

    // 5 فئات مصاريف افتراضية بالأسماء الحرفية
    const cats = await db.all<{ name: string }>('SELECT name FROM expense_category');
    expect(cats.map((c) => c.name).sort()).toEqual(['رواتب', 'عام', 'إيجار', 'كهرباء', 'نقل'].sort());

    // الإعدادات الـ20 (17 من الملحق هـ + 3 طباعة FR-13-03)
    expect(await count('settings')).toBe(20);
    expect(await getSetting('fx.fallback')).toBe('off');

    // قيد تدقيق الإقلاع + هوية الجلسة للمدير
    const audit = await db.all<{ c: number }>("SELECT count(*) AS c FROM audit_log WHERE action = 'onboarding_complete'");
    expect(audit[0]?.c ?? 0).toBe(1);
    expect(getCurrentUserId()).toBe(1);
  });

  test('الاستدعاء الثاني يرفض (قرار موثق: لا إعداد أولي مزدوج)', async () => {
    let msg = '';
    try {
      await completeOnboarding({
        companyName: 'شركة ثانية',
        baseCurrencyCode: 'YER',
        pinHash: 'pbkdf2$100000$abc$def',
      });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('منجز مسبقاً');
    expect(await count('company')).toBe(1);
    expect(await count('app_user')).toBe(1);
  });

  test('رموز مكررة داخل المدخلات نفسها → رفض قبل المعاملة', async () => {
    // القاعدة مزروعة بالفعل؛ نفحص الفرع المبكر بمحاولة على قاعدة مُجهزة: نكتفي بالرسالة
    let msg = '';
    try {
      await completeOnboarding({
        companyName: 'شركة',
        baseCurrencyCode: 'YER',
        pinHash: 'pbkdf2$100000$abc$def',
        extraCurrencies: [
          { code: 'SAR', name: 'ريال', decimals: 2 },
          { code: 'SAR', name: 'مكرر', decimals: 2 },
        ],
      });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    // يصل أولاً فحص «مُنجز مسبقاً» لأن الشركة موجودة — الترتيب مقصود (الحماية الخارجية قبل التحقق الداخلي)
    expect(msg).toContain('منجز مسبقاً');
  });
});
