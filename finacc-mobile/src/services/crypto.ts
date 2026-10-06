/**
 * تجزئة PIN — قرار بيئة موثق (worklog Task 0/1):
 * SRS FR-12-03 يحدد Argon2id (وحدة native تُضاف عند بناء EAS). في المعاينة والاختبارات
 * (bun/sql.js) نستخدم PBKDF2-SHA256 عبر WebCrypto القياسي بنفس الواجهة تماماً،
 * وعند الترحيل إلى EAS تُستبدل هذه الطبقة بـ Argon2id دون تغيير أي مستدعٍ.
 *
 * صيغة التخزين: pbkdf2$<iterations>$<saltHex(32)>$<hashHex(64)>
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16; // 16 بايت → 32 حرف hex
const KEY_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`قيمة hex غير صالحة أثناء فك بصمة PIN — البيانات المحفوظة تالفة؟ (${hex.slice(0, 12)}…)`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(b);
  } else {
    // fallback نظري (بيئات بلا WebCrypto) — لا يُفترض حدوثه في bun/المتصفح/native
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto (crypto.subtle) غير متاح في هذه البيئة — تعذر حماية رمز PIN. أعد تشغيل التطبيق أو بلّغ الدعم');
  }
  return subtle;
}

async function derivePinHex(pin: string, saltHex: string, iterations: number): Promise<string> {
  const subtle = getSubtle();
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
    key,
    KEY_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** تجزئة PIN لإدخالها في app_user.pin_hash. salt اختياري (عشوائي 16 بايت hex إن لم يُمرر — للإنتاج). */
export async function hashPin(pin: string, salt?: string): Promise<string> {
  if (typeof pin !== 'string' || pin.length === 0) {
    throw new Error('رمز PIN مطلوب ولا يمكن أن يكون فارغاً — أدخل رقماً سرياً من 4 خانات على الأقل');
  }
  const saltHex = salt ?? bytesToHex(randomBytes(SALT_BYTES));
  if (!/^[0-9a-fA-F]{2,64}$/.test(saltHex)) {
    throw new Error('قيمة salt غير صالحة — يجب أن تكون نص hex (زوجياً بين 2 و64 حرفاً)');
  }
  const saltLower = saltHex.toLowerCase();
  const hashHex = await derivePinHex(pin, saltLower, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltLower}$${hashHex}`;
}

/** مقارنة توقيت ثابت قدر الإمكان (XOR تراكمي على الطول الكامل). */
function fixedTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** التحقق من PIN مقابل بصمة محفوظة بصيغة pbkdf2$…$. */
export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  if (typeof pin !== 'string' || pin.length === 0) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    throw new Error(`صيغة بصمة PIN غير معروفة: «${stored.slice(0, 24)}…» — المتوقع pbkdf2$<iters>$<salt>$<hash>. أعد تعيين رمز PIN من الإعدادات`);
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`عدد تكرارات غير صالح في بصمة PIN (${parts[1]}) — البيانات المحفوظة تالفة`);
  }
  const computed = await derivePinHex(pin, parts[2], iterations);
  return fixedTimeEqual(computed, parts[3]);
}

/** معرّف عشوائي uuid-like (v4 شكلياً) عبر crypto.getRandomValues مع fallback Math.random. */
export function randomId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
