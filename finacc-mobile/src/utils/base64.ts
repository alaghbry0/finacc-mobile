/**
 * ترميز/فك Base64 بـ JavaScript خالص (Task Android-Fix):
 * بلا btoa/atob (غير موجودين في Hermes على الجهاز) وبلا Buffer (غير موجود
 * في المتصفح/Hermes) — نفس المخرجات على المنصات الثلاث (ويب/جهاز/اختبارات).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** ترميز بايتات إلى Base64 (مع الحشوة =). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < len ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;

/** فك Base64 (يتسامح مع الفراغات والأسطر الجديدة — صيغة الملفات القديمة). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s\r\n]+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const len = clean.length;
  let byteLen = (len * 3) / 4 - padding;
  if (!Number.isInteger(byteLen) || byteLen < 0) {
    throw new Error('نص Base64 غير صالح — طول غير متوافق');
  }
  byteLen = Math.floor(byteLen);
  const out = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = LOOKUP[clean[i]] ?? 0;
    const c1 = LOOKUP[clean[i + 1]] ?? 0;
    const c2 = LOOKUP[clean[i + 2]] ?? 0;
    const c3 = LOOKUP[clean[i + 3]] ?? 0;
    if (p < byteLen) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < byteLen) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (p < byteLen) out[p++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}
