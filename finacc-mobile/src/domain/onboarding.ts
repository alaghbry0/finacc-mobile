import { z } from 'zod';
import { getDb } from '@/db/client';
import { seedDefaultSettings } from './settings';
import { logAudit } from './audit';
import { setCurrentUserId } from './session-user';

/**
 * الإعداد الأولي (FR-13-01): بيانات المنشأة → خطوة ختامية واحدة ذرّية تنشئ:
 * العملات (الأساس + الإضافية) + الشركة + «المخزن الرئيسي» + «الصندوق الرئيسي»
 * بالعملة الأساسية + مستخدم المدير (admin) + فئات مصاريف افتراضية + إعدادات الملحق هـ.
 * الهدف المقيس AC-24: من التثبيت إلى أول فاتورة ≤ 5 دقائق.
 *
 * قرار موثق: الاستدعاء الثاني يرفض (يرجع خطأ واضحاً) — الأصح تجارياً من الإذعان الصامت:
 * تعديل بيانات المنشأة يتم لاحقاً من شاشة الإعدادات، لا بإعادة «الإعداد الأولي».
 */

export interface OnboardingInput {
  companyName: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  /** رمز العملة الأساسية — 'YER' افتراضياً (FR-08-01: قابلة للتغيير هنا فقط ثم تثبت). */
  baseCurrencyCode: string;
  /** نسبة الضريبة كنص عشري — '0' افتراضياً (SRS: ضريبة 0%). */
  taxRate?: string;
  /** بصمة PIN محسوبة مسبقاً من الشاشة عبر hashPin — لا يمرر الـ PIN نصاً هنا أبداً. */
  pinHash: string;
  displayName?: string;
  username?: string;
  /** عملات إضافية — undefined يعني الزرع الافتراضي SAR/USD/ADE... انظر DEFAULT_EXTRA_CURRENCIES. */
  extraCurrencies?: { code: string; name: string; decimals: number }[];
}

const CURRENCY_CODE_RE = /^[A-Za-z]{2,8}$/;

const OnboardingInputSchema = z.object({
  companyName: z.string().trim().min(1, 'اسم المنشأة مطلوب — أدخل اسم المتجر للمتابعة'),
  phone: z.string().trim().max(30).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  baseCurrencyCode: z
    .string()
    .trim()
    .regex(CURRENCY_CODE_RE, 'رمز العملة يجب أن يكون 2–8 أحرف لاتينية مثل YER أو SAR')
    .default('YER'),
  taxRate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'نسبة الضريبة يجب أن تكون رقماً بين 0 و100 مثل «0» أو «5»')
    .refine((s) => Number(s) >= 0 && Number(s) <= 100, { message: 'نسبة الضريبة يجب أن تكون بين 0 و100' })
    .default('0'),
  pinHash: z.string().min(1, 'بصمة PIN مطلوبة — مرّر pinHash محسوبة من hashPin (لا يمكن الإعداد بدون رمز دخول)'),
  displayName: z.string().trim().min(1, 'اسم العرض مطلوب').default('المدير'),
  username: z.string().trim().min(1, 'اسم المستخدم مطلوب').default('admin'),
  extraCurrencies: z
    .array(
      z.object({
        code: z.string().trim().regex(CURRENCY_CODE_RE, 'رمز عملة غير صالح (2–8 أحرف لاتينية)'),
        name: z.string().trim().min(1, 'اسم العملة مطلوب'),
        decimals: z.number().int().min(0).max(6, 'عدد المنازل بين 0 و6'),
      }),
    )
    .optional(),
});

/** أسماء/منازل العملات المعروفة (FR-08-01: اليمني decimals=0 افتراضياً). */
const KNOWN_CURRENCIES: Record<string, { name: string; decimals: number }> = {
  YER: { name: 'ريال يمني', decimals: 0 },
  SAR: { name: 'ريال سعودي', decimals: 2 },
  USD: { name: 'دولار أمريكي', decimals: 2 },
  AED: { name: 'درهم إماراتي', decimals: 2 },
};

/** عملات مفعلة مبدئياً عند عدم تمرير extraCurrencies صراحة. */
const DEFAULT_EXTRA_CURRENCIES: { code: string; name: string; decimals: number }[] = [
  { code: 'SAR', name: 'ريال سعودي', decimals: 2 },
  { code: 'USD', name: 'دولار أمريكي', decimals: 2 },
  { code: 'AED', name: 'درهم إماراتي', decimals: 2 },
];

/** فئات المصاريف الافتراضية (المهمة 2-a: خمسة). */
const DEFAULT_EXPENSE_CATEGORIES = ['رواتب', 'عام', 'إيجار', 'كهرباء', 'نقل'];

/** هل أُنجز الإعداد الأولي؟ (وجود أي صف في company). */
export async function isOnboarded(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM company');
  return (rows[0]?.c ?? 0) > 0;
}

/**
 * تنفيذ الإعداد الأولي كله داخل transaction واحدة (قاعدة الذرّة 5.4-4):
 * فشل أي خطوة يرجع كل شيء — لا شركة بلا مستخدم ولا صندوق بلا عملة.
 */
export async function completeOnboarding(input: OnboardingInput): Promise<void> {
  const parsed = OnboardingInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `مدخلات الإعداد الأولي غير مكتملة: ${issue?.message ?? 'راجع الحقول'} ` +
        `(الحقل: ${issue?.path?.join('.') ?? '?'}) — صحح المدخلات ثم أعد المحاولة`,
    );
  }
  const v = parsed.data;
  const baseCode = v.baseCurrencyCode.toUpperCase();
  const base = KNOWN_CURRENCIES[baseCode] ?? { name: baseCode, decimals: 2 };

  const extras = (v.extraCurrencies ?? DEFAULT_EXTRA_CURRENCIES).map((c) => ({
    code: c.code.toUpperCase(),
    name: c.name,
    decimals: c.decimals,
  }));

  const db = await getDb();
  if (await isOnboarded()) {
    throw new Error(
      'الإعداد الأولي منجز مسبقاً ولا يمكن تكراره — عدّل بيانات المنشأة من شاشة الإعدادات، ' +
        'أو امسح كل البيانات من شاشة «حول» ثم ابدأ من جديد (سيُفقد كل شيء)',
    );
  }

  // منع تكرار رموز العملات داخل المدخلات نفسها (وإلا تفشل المعاملة لاحقاً بشكل غامض)
  const codes = [baseCode, ...extras.map((c) => c.code)];
  const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
  if (duplicate) {
    throw new Error(`رمز عملة مكرر في الإعداد الأولي: «${duplicate}» — استخدم كل رمز مرة واحدة فقط`);
  }

  const now = new Date().toISOString();
  await db.transaction(async () => {
    // 1) العملات: الأساس + الإضافية (بلا is_base)
    const baseRes = await db.run(
      'INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, 1, ?, 1)',
      [baseCode, base.name, base.decimals],
    );
    const baseCurrencyId = Number(baseRes.lastInsertRowId);
    for (const c of extras) {
      await db.run('INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, 0, ?, 1)', [
        c.code,
        c.name,
        c.decimals,
      ]);
    }

    // 2) مستخدم المدير أولاً (ليُنسب إليه الإنشاء في created_by)
    const userRes = await db.run(
      'INSERT INTO app_user(username, display_name, role, pin_hash, is_active, created_at) VALUES(?, ?, ?, ?, 1, ?)',
      [v.username, v.displayName, 'admin', v.pinHash, now],
    );
    const userId = Number(userRes.lastInsertRowId);

    // 3) الشركة (عملة الأساس + بادئة INV + الضريبة)
    const companyRes = await db.run(
      'INSERT INTO company(name, phone, whatsapp, address, currency_id, tax_rate, invoice_prefix, created_at, updated_at, created_by) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.companyName, v.phone ?? null, v.whatsapp ?? null, v.address ?? null, baseCurrencyId, v.taxRate, 'INV', now, now, userId],
    );
    const companyIdInner = Number(companyRes.lastInsertRowId);

    // 4) المخزن الرئيسي (invoice.warehouse_id NOT NULL — بدونه تفشل أول فاتورة)
    await db.run('INSERT INTO warehouse(name, is_default, created_at, created_by) VALUES(?, 1, ?, ?)', [
      'المخزن الرئيسي',
      now,
      userId,
    ]);

    // 5) الصندوق الرئيسي بعملة الأساس + ربطه كمستخدم افتراضي
    const boxRes = await db.run(
      'INSERT INTO cashbox(name, currency_id, is_default, created_at, created_by) VALUES(?, ?, 1, ?, ?)',
      ['الصندوق الرئيسي', baseCurrencyId, now, userId],
    );
    await db.run('UPDATE app_user SET default_cashbox_id = ? WHERE id = ?', [Number(boxRes.lastInsertRowId), userId]);

    // 6) فئات المصاريف الافتراضية
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await db.run('INSERT INTO expense_category(name, created_at, created_by) VALUES(?, ?, ?)', [name, now, userId]);
    }

    // 7) إعدادات الملحق هـ (idempotent — savepoint داخل نفس المعاملة)
    await seedDefaultSettings();

    // 8) قيد تدقيق الإقلاع
    await logAudit('onboarding_complete', {
      entity: 'company',
      entityId: companyIdInner,
      details: { companyName: v.companyName, baseCurrencyCode: baseCode, extraCurrencies: extras.map((c) => c.code) },
    });
  });

  // بعد نجاح المعاملة كلها فقط: هذه الجلسة لمدير أُنشئ للتو
  const userRow = await db.all<{ id: number }>('SELECT id FROM app_user ORDER BY id LIMIT 1');
  if (userRow.length > 0) setCurrentUserId(Number(userRow[0].id));
}
