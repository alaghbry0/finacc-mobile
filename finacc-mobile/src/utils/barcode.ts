/**
 * أدوات الباركود EAN-13 (FR-01-02):
 * - generateEan13: توليد كود داخلي يبدأ بـ 2 (نطاق الاستخدام الداخلي 20–29 وفق GS1
 *   للأكواد المحلية داخل المتاجر) + 11 رقماً عشوائياً + خانة تحقق → 13 رقماً.
 * - isValidEan13: تحقق كامل (طول + أرقام + خانة تحقق) للكود الممسوح أو المدخل.
 *
 * خوارزمية خانة التحقق (GS1): من اليسار، اجمع الأرقام في المواضع الفردية (1، 3، 5…)
 * ×1 والمواضع الزوجية ×3، ثم خانة التحقق = (10 − (المجموع mod 10)) mod 10.
 */

/** هل السلسلة أرقاماً عربية غربية فقط؟ */
function isDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

/** خانة تحقق EAN-13 لأول 12 رقماً (يجب أن تكون أرقاماً وطولها 12 تماماً). */
export function ean13Checksum(digits12: string): number {
  if (!isDigits(digits12) || digits12.length !== 12) {
    throw new Error(
      `حساب خانة تحقق EAN-13 يتطلب 12 رقماً بالضبط — ما وصل هو «${digits12}» (${digits12.length} خانة)`,
    );
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = digits12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** توليد كود EAN-13 داخلي جديد: يبدأ بـ 2 + 11 رقماً عشوائياً + خانة تحقق. */
export function generateEan13(): string {
  let body = '2';
  for (let i = 0; i < 11; i++) {
    body += String(Math.floor(Math.random() * 10));
  }
  return body + String(ean13Checksum(body));
}

/** تحقق كامل من صحة كود EAN-13: الطول 13 + أرقام فقط + خانة تحقق صحيحة. */
export function isValidEan13(code: string): boolean {
  if (typeof code !== 'string' || code.length !== 13 || !isDigits(code)) return false;
  const expected = ean13Checksum(code.slice(0, 12));
  return code.charCodeAt(12) - 48 === expected;
}
