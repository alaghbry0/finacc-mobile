import { dec, money, roundTo, formatMoney, formatSigned } from '@/utils/money';

/**
 * اختبارات النقدين (src/utils/money.ts) — قاعدة 5.2-3: لا Float في المبالغ.
 * قرار التقريب الموثق: HALF_UP (10.005 → 10.01) — البديل Banker's كان مقبولاً واختير غيره.
 */

describe('money: dec', () => {
  test('null/undefined/سلسلة فارغة → صفر', () => {
    expect(dec(null).isZero()).toBe(true);
    expect(dec(undefined).isZero()).toBe(true);
    expect(dec('').isZero()).toBe(true);
  });

  test('نص/رقم/Decimal يُحوَّل بدقة كاملة', () => {
    expect(dec('12500.50').toString()).toBe('12500.5');
    expect(dec(12500.5).toString()).toBe('12500.5');
    expect(dec(dec('0.1')).toString()).toBe('0.1');
  });

  test('قيمة غير رقمية → خطأ عربي واضح (لا صفر صامت يفسد الحسابات)', () => {
    let msg = '';
    try {
      dec('abc');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('قيمة رقمية غير صالحة');
    expect(() => dec('abc')).toThrow('قيمة رقمية غير صالحة');
  });

  test('NaN/Infinity مرفوضان', () => {
    expect(() => dec(Number.NaN)).toThrow();
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('money: money (نص التخزين المطبع)', () => {
  test('أسقط الأصفار الذيلية دون فقد دقة', () => {
    expect(money('12500.00')).toBe('12500');
    expect(money('0.10')).toBe('0.1');
    expect(money('12.3400')).toBe('12.34');
    expect(money('-0')).toBe('0');
  });

  test('دقة عالية محفوظة نصاً (ضمن precision 28)', () => {
    expect(money('1234.567891')).toBe('1234.567891');
  });
});

describe('money: roundTo (HALF_UP موثق)', () => {
  test('roundTo(10.005, 2) = 10.01 — تقريب المحاسبي HALF_UP (ليس Banker\'s — قرار موثق)', () => {
    expect(roundTo('10.005', 2).toString()).toBe('10.01');
    expect(roundTo(10.005, 2).toString()).toBe('10.01');
  });

  test('النصف نزولاً عند ما دونها', () => {
    expect(roundTo('10.004', 2).toString()).toBe('10');
    expect(roundTo('2.675', 2).toString()).toBe('2.68');
  });

  test('صفر منازل لليمني', () => {
    expect(roundTo('1250.7', 0).toString()).toBe('1251');
  });

  test('عدد منازل غير صالح → خطأ عربي', () => {
    expect(() => roundTo('10', -1)).toThrow('عدد منازل تقريب غير صالح');
    expect(() => roundTo('10', 1.5)).toThrow('عدد منازل تقريب غير صالح');
  });
});

describe('money: formatMoney (فواصل آلاف — أرقام غربية دائماً)', () => {
  test('formatMoney(12500, 2) = "12,500.00"', () => {
    expect(formatMoney(12500, 2)).toBe('12,500.00');
  });

  test('منازل وافتراضيات وسالب', () => {
    expect(formatMoney('12500')).toBe('12,500.00');
    expect(formatMoney('1250000', 2)).toBe('1,250,000.00');
    expect(formatMoney('12500', 0)).toBe('12,500');
    expect(formatMoney('-1250.5', 2)).toBe('-1,250.50');
    expect(formatMoney('0', 2)).toBe('0.00');
  });
});

describe('money: formatSigned (إشارة صريحة للفروق)', () => {
  test('موجب بإشارة +', () => {
    expect(formatSigned('250')).toBe('+250.00');
    expect(formatSigned(12500, 2)).toBe('+12,500.00');
  });

  test('سالب بإشارة -', () => {
    expect(formatSigned('-1250.5')).toBe('-1,250.50');
    expect(formatSigned('-0.25', 2)).toBe('-0.25');
  });
});
