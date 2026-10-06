/**
 * SHA-256 + HMAC + PBKDF2 بـ JavaScript خالص (Task Android-Fix):
 * Hermes على الجهاز لا يوفر WebCrypto (crypto.subtle) ولا TextEncoder — فالمسار
 * الأصلي لتجزئة PIN كان ينهار عند الإعداد الأول. هذه التطبيقات معيارية حرفياً
 * (FIPS 180-4 / RFC 2104 / RFC 8018) وتنتج نفس مخرجات WebCrypto تماماً —
 * يتحقق الاختبار src/utils/__tests__/native-compat.test.ts بمعاملات معروفة
 * وبالمقارنة المباشرة مع crypto.subtle في بيئة bun.
 *
 * أداء PBKDF2: حالة HMAC (ipad/opad) تُحسب مرة واحدة لكل كلمة مرور ثم تُستكمل
 * الضغط من حالتها المحفوظة — بلا إعادة معالجة كتلة المفتاح في كل تكرار (2x+).
 */

// ============ UTF-8 (بديل TextEncoder) ============

export function utf8Bytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i);
    if (cp === undefined) cp = 0xfffd;
    if (cp > 0xffff) i++; // surrogate pair consumed
    if (cp <= 0x7f) {
      out.push(cp);
    } else if (cp <= 0x7ff) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

// ============ SHA-256 (FIPS 180-4) ============

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** جدول الرسائل — scratch مشترك (JS أحادي الخيط). */
const W = new Uint32Array(64);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** جولة ضغط واحدة: تُحدّث الحالة h بكتلة 64 بايتاً من buf عند offset. */
function compress(h: Uint32Array, buf: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t++) {
    const i = offset + t * 4;
    W[t] = ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
  }
  for (let t = 16; t < 64; t++) {
    const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
    const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
    W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
  }

  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];

  for (let t = 0; t < 64; t++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (hh + S1 + ch + K[t] + W[t]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  h[0] = (h[0] + a) >>> 0;
  h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0;
  h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0;
  h[5] = (h[5] + f) >>> 0;
  h[6] = (h[6] + g) >>> 0;
  h[7] = (h[7] + hh) >>> 0;
}

function stateToBytes(h: Uint32Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

/** كتلة الحشوة الأخيرة (قد تكون واحدة أو اثنتين) ثم إخراج الحالة. */
function finish(h: Uint32Array, tail: Uint8Array, tailLen: number, prefixLen: number): Uint8Array {
  const scratch = new Uint8Array(64);
  scratch.set(tail.subarray(0, tailLen));
  scratch[tailLen] = 0x80;
  const bitLen = (prefixLen + tailLen) * 8;
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  if (tailLen > 55) {
    compress(h, scratch, 0);
    scratch.fill(0);
  }
  scratch[56] = (hi >>> 24) & 0xff;
  scratch[57] = (hi >>> 16) & 0xff;
  scratch[58] = (hi >>> 8) & 0xff;
  scratch[59] = hi & 0xff;
  scratch[60] = (lo >>> 24) & 0xff;
  scratch[61] = (lo >>> 16) & 0xff;
  scratch[62] = (lo >>> 8) & 0xff;
  scratch[63] = lo & 0xff;
  compress(h, scratch, 0);
  return stateToBytes(h);
}

/** تجزئة SHA-256 لرسالة بايتات — 32 بايتاً. */
export function sha256(message: Uint8Array): Uint8Array {
  const h = Uint32Array.from(IV);
  let off = 0;
  while (off + 64 <= message.length) {
    compress(h, message, off);
    off += 64;
  }
  // prefixLen = البايتات المضغوطة فعلاً — تحسب في الطول الكلي
  return finish(h, message.subarray(off), message.length - off, off);
}

/** حالة وسيطة بعد معالجة كتلة أولى ثابتة (ipad/opad) — لتسريع PBKDF2. */
function prefixState(firstBlock: Uint8Array): Uint32Array {
  const h = Uint32Array.from(IV);
  compress(h, firstBlock, 0);
  return h;
}

/** استكمال التجزئة من حالة محفوظة: الرسالة tail بحجم ≤ 64 بايتاً (حالة PBKDF2). */
function continueFrom(state: Uint32Array, tail: Uint8Array, tailLen: number, prefixLen: number): Uint8Array {
  const h = Uint32Array.from(state);
  return finish(h, tail, tailLen, prefixLen);
}

// ============ HMAC-SHA256 (RFC 2104) ============

/** HMAC-SHA256 لمفتاح ورسالة بايتات — 32 بايتاً (مسار عام). */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  const inner = new Uint8Array(64 + message.length);
  inner.set(ipad);
  inner.set(message, 64);
  const innerHash = sha256(inner);
  return continueFrom(prefixState(opad), innerHash, 32, 64);
}

// ============ PBKDF2-HMAC-SHA256 (RFC 8018) — محسّن ============

/**
 * PBKDF2 بمغلف HMAC-SHA256 — dkLen بايتاً.
 * تحسين الأداء: حالة ipad/opad تُحسب مرة واحدة ثم تُستكمل الضغط منها،
 * وذاكرات scratch تُعاد استخدامها عبر التكرارات (بلا ضغط GC على Hermes).
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  if (iterations < 1) throw new Error('عدد تكرارات PBKDF2 يجب أن يكون ≥ 1');

  let k = password;
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  const innerState = prefixState(ipad);
  const outerState = prefixState(opad);

  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);

  // ذاكرة مؤقتة: salt + INT(i) — تُعاد كتابتها لكل كتلة
  const msgLen = salt.length + 4;
  const msg = new Uint8Array(msgLen);
  const u = new Uint8Array(32);
  const t = new Uint8Array(32);

  for (let i = 1; i <= blocks; i++) {
    msg.set(salt);
    msg[salt.length] = (i >>> 24) & 0xff;
    msg[salt.length + 1] = (i >>> 16) & 0xff;
    msg[salt.length + 2] = (i >>> 8) & 0xff;
    msg[salt.length + 3] = i & 0xff;

    // U1 = HMAC كامل: داخلي ثم خارجي (كان الداخلي فقط — خلل صُحح)
    const inner1 = continueFrom(innerState, msg, msgLen, 64);
    u.set(continueFrom(outerState, inner1, 32, 64));
    t.set(u);
    for (let iter = 1; iter < iterations; iter++) {
      // outer: HMAC(password, u) عبر الحالتين المحفوظتين
      const inner = continueFrom(innerState, u, 32, 64); // SHA256(ipad || u)
      const outer = continueFrom(outerState, inner, 32, 64); // SHA256(opad || inner)
      u.set(outer);
      for (let b = 0; b < 32; b++) t[b] ^= u[b];
    }
    out.set(t, (i - 1) * 32);
  }
  return out.subarray(0, dkLen);
}
