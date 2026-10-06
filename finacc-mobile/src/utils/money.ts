import Decimal from 'decimal.js';

/**
 * التعامل النقدي الموحد للمشروع كله (قاعدة 5.2-3: لا Float أبداً في المبالغ).
 * - كل مبلغ يُحمل كـ Decimal ويُخزَّن نصاً في أعمدة NUMERIC.
 * - الدقة العالمية 28 خانة significand (تغطي NUMERIC(14,4) و(14,6) بهامش واسع).
 *
 * قرار تقريب موثق: التقريب الافتراضي HALF_UP (تقريب «المحاسبي» المعتاد: 10.005 → 10.01).
 * وفق المهمة كان Banker's (HALF_EVEN) مقبولاً أيضاً — اخترنا HALF_UP لأنه الأوضح للمستخدم
 * والمطابق لتقريب الكاشير اليدوي. من يحتاج تقريباً آخر يمرر النتيجة على toDecimalPlaces بنفسه.
 */
Decimal.set({ precision: 28 });

/** قيمة Decimal أو نصها/رقمها؛ null/undefined/'' → صفر. */
export type MoneyValue = Decimal.Value | number | string | null | undefined;

/** تحويل آمن إلى Decimal — null/undefined/'' → 0، وقيمة غير رقمية → خطأ عربي واضح (لا صفر صامت يفسد الحسابات). */
export function dec(v: MoneyValue): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new Error(`قيمة رقمية غير صالحة: «${v}» — لا يُسمح بـ NaN/Infinity في المبالغ، مرّر نصاً عشرياً مثل «12500.50»`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`قيمة رقمية غير صالحة: «${String(v)}» — مرّر نصاً عشرياً مثل «12500.50» أو «-0.25»`);
  }
  if (d.isNaN() || !d.isFinite()) {
    throw new Error(`قيمة رقمية غير صالحة: «${String(v)}» — النتيجة NaN/غير منتهية، راجع مصدر المبلغ`);
  }
  return d;
}

/**
 * نص التخزين المطبع (لأعمدة NUMERIC): أقصر تمثيل عشري دقيق بلا أصفار ذيلية ولا صيغة أسية.
 * أمثلة: '12500.00' → '12500'، '0.10' → '0.1'، '-0' → '0'.
 * من يريد تثبيت عدد منازل (مثل 0 لليمني) يستدعي roundTo أولاً ثم money.
 */
export function money(v: MoneyValue): string {
  const d = dec(v);
  let s = d.toString();
  if (s.includes('e') || s.includes('E')) {
    // توسيع الصيغة الأسية (نادر جداً خارج نطاق NUMERIC(14,x)) إلى عشرية ثابتة
    const dp = Math.min(Math.max(d.decimalPlaces(), 0), 20);
    s = d.toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  return s === '-0' ? '0' : s;
}

/** تقريب إلى عدد منازل عشرية (HALF_UP — انظر قرار التقريب أعلاه). */
export function roundTo(v: MoneyValue, decimals: number): Decimal {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new Error(`عدد منازل تقريب غير صالح: «${decimals}» — استخدم عدداً صحيحاً بين 0 و12`);
  }
  return dec(v).toDecimalPlaces(decimals);
}

/**
 * تنسيق العرض بفواصل آلاف قياسية (12,500.00) — أرقام غربية دائماً (قاعدة 5.4-12)؛
 * التحويل للهندية مسؤولية طبقة العرض حسب إعداد display.numerals وليس هنا.
 */
export function formatMoney(v: MoneyValue, decimals = 2): string {
  const d = dec(v);
  const fixed = d.toFixed(Math.max(0, Math.min(decimals, 12)));
  const neg = fixed.startsWith('-');
  const body = neg ? fixed.slice(1) : fixed;
  const [int, frac] = body.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = neg ? '-' : '';
  return frac !== undefined ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/** تنسيق مع إشارة صريحة: '+12,500.00' للموجب و'-1,250.00' للسالب (للفروق: fx_gain_loss، عجز الجرد...). */
export function formatSigned(v: MoneyValue, decimals = 2): string {
  const d = dec(v);
  return `${d.isNegative() ? '-' : '+'}${formatMoney(d.abs(), decimals)}`;
}

export { Decimal };
