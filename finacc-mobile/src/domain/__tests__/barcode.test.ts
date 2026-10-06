import { ean13Checksum, generateEan13, isValidEan13 } from '@/utils/barcode';

/**
 * اختبارات EAN-13 (FR-01-02): خانة التحقق وفق GS1، التوليد الداخلي 2x،
 * والتحقق من الأطوال والمدخلات الفاسدة.
 */

describe('EAN-13: خانة التحقق (GS1)', () => {
  test('أكواد مرجعية معروفة تُرجع خانتها الصحيحة', () => {
    // منتج ألماني معروف 4006381333931 → خانة التحقق 1
    expect(ean13Checksum('400638133393')).toBe(1);
    // ISBN-13 9780201379624 → خانة التحقق 4
    expect(ean13Checksum('978020137962')).toBe(4);
    // 4711234567893 → تحقق يدوي: أفراد 4+1+2+4+6+8=25، أزواج 7+1+3+5+7+9=32×3=96، 121 → 9... نعيد:
    // المجموع = 25 + 96 = 121 → (10 - 1) = 9؟ 121 mod 10 = 1 → 9
    expect(ean13Checksum('471123456789')).toBe(9);
  });

  test('مدخل بطول خطأ → خطأ عربي واضح', () => {
    expect(() => ean13Checksum('12345')).toThrow('12 رقماً');
    expect(() => ean13Checksum('1234567890123')).toThrow('12 رقماً');
    expect(() => ean13Checksum('40063813339a')).toThrow('12 رقماً');
  });
});

describe('EAN-13: isValid', () => {
  test('يقبل الكود الصحيح ويرفض الخطأ في خانة التحقق', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('9780201379624')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  test('يرفض الطول الخطأ والمحارف غير الرقمية', () => {
    expect(isValidEan13('400638133393')).toBe(false); // 12
    expect(isValidEan13('40063813339312')).toBe(false); // 14
    expect(isValidEan13('')).toBe(false);
    expect(isValidEan13('400638133393a')).toBe(false);
    expect(isValidEan13('٤٠٠٦٣٨١٣٣٣٩٣١')).toBe(false); // أرقام هندية
  });
});

describe('EAN-13: توليد داخلي (نطاق 2x)', () => {
  test('50 كوداً: كلها تبدأ بـ 2 وصحيحة وفريدة', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const code = generateEan13();
      expect(code.length).toBe(13);
      expect(code.startsWith('2')).toBe(true);
      expect(isValidEan13(code)).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(50);
  });
});
