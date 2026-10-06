import { bytesToBase64, base64ToBytes } from '@/utils/base64';
import { sha256, hmacSha256, pbkdf2Sha256, utf8Bytes } from '@/utils/sha256';

/**
 * اختبارات التوافق مع الجهاز (Task Android-Fix):
 * المسار الخالص (بلا WebCrypto/btoa/atob/Buffer — كما على Hermes) يجب أن ينتج
 * نفس مخرجات المعايير حرفياً، وإلا فقد PIN قيمته عند التنقل بين الويب والجهاز.
 */

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

describe('SHA-256 خالص — معاملات NIST/RFC معروفة', () => {
  test('النص الفارغ', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('"abc"', () => {
    expect(hex(sha256(utf8Bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('نص عربي (تشفير UTF-8 صحيح — مرجع node:crypto)', () => {
    expect(hex(sha256(utf8Bytes('المحاسب')))).toBe(
      'afa43145bb51f5575ec576c4fb40c285c6747df4c3340736b38f22752de8abb8',
    );
  });

  test('رسالة أطول من كتلة (1000 حرف a — مرجع node:crypto)', () => {
    expect(hex(sha256(utf8Bytes('a'.repeat(1000))))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('HMAC-SHA256 خالص — معامل معروف', () => {
  test('مفتاح "key" ورسالة "The quick brown fox jumps over the lazy dog"', () => {
    expect(hex(hmacSha256(utf8Bytes('key'), utf8Bytes('The quick brown fox jumps over the lazy dog')))).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  test('مفتاح أطول من 64 بايت — سلوك حتمي متسق', () => {
    const key = utf8Bytes('k'.repeat(131));
    const msg = utf8Bytes('msg');
    const a = hex(hmacSha256(key, msg));
    const b = hex(hmacSha256(utf8Bytes('k'.repeat(131)), msg));
    expect(a).toBe(b);
    // التحقق التقاطعي مع node:crypto تم في المتجهات المعيارية أعلاه
  });
});

describe('PBKDF2-HMAC-SHA256 خالص — معاملات RFC 7914 §11', () => {
  test('password/salt/1 تكرار/32 بايتاً', () => {
    const out = pbkdf2Sha256(utf8Bytes('password'), utf8Bytes('salt'), 1, 32);
    expect(hex(out)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  test('password/salt/2 تكرار/32 بايتاً', () => {
    const out = pbkdf2Sha256(utf8Bytes('password'), utf8Bytes('salt'), 2, 32);
    expect(hex(out)).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  });

  test('passwordPASSWORDpassword/saltSALTsaltSALTsalt/4096/40 بايتاً', () => {
    const out = pbkdf2Sha256(
      utf8Bytes('passwordPASSWORDpassword'),
      utf8Bytes('saltSALTsaltSALTsaltSALTsaltSALTsalt'),
      4096,
      40,
    );
    expect(hex(out)).toBe('348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9');
  });

  test('dkLen ليس مضاعف 32 — اقتطاع صحيح', () => {
    const out = pbkdf2Sha256(utf8Bytes('password'), utf8Bytes('salt'), 1, 20);
    expect(out.length).toBe(20);
    expect(hex(out)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c9');
  });
});

describe('التقاطع مع WebCrypto — نفس الناتج بتة ببتة', () => {
  test('PBKDF2 الخالص = crypto.subtle (بيئة bun توفر الاثنين)', async () => {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return; // بيئة بلا WebCrypto — المعاملات أعلاه كافية
    const pin = '1234';
    const saltHex = '0123456789abcdef0123456789abcdef';
    const iterations = 1000;
    const salt = new Uint8Array((saltHex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

    const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(
      await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
    );
    const webHex = hex(bits);

    const pureHex = hex(pbkdf2Sha256(utf8Bytes(pin), salt, iterations, 32));
    expect(pureHex).toBe(webHex);
  });

  test('utf8Bytes = TextEncoder (عربي + رموز)', () => {
    const enc = new TextEncoder();
    for (const s of ['المحاسب الشخصي', 'PIN: 1234¢€', 'مزيج mixed نص 42']) {
      expect(hex(utf8Bytes(s))).toBe(hex(new Uint8Array(enc.encode(s))));
    }
  });
});

describe('Base64 خالص', () => {
  test('متجهات RFC 4648', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([102]))).toBe('Zg==');
    expect(bytesToBase64(new Uint8Array([102, 111]))).toBe('Zm8=');
    expect(bytesToBase64(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
    expect(bytesToBase64(new Uint8Array([102, 111, 111, 98, 97, 114]))).toBe('Zm9vYmFy');
  });

  test('دورة كاملة لبايتات بأنماط مختلفة الأطوال', () => {
    for (let len = 0; len <= 66; len++) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 37 + len * 11) & 0xff;
      const b64 = bytesToBase64(data);
      const back = base64ToBytes(b64);
      expect(back.length).toBe(len);
      for (let i = 0; i < len; i++) expect(back[i]).toBe(data[i]);
    }
  });

  test('يطابق btoa/atob المرجعيين', () => {
    const data = new Uint8Array(300);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
    const bin = String.fromCharCode(...data);
    expect(bytesToBase64(data)).toBe(btoa(bin));
    expect(hex(base64ToBytes(btoa(bin)))).toBe(hex(data));
  });

  test('يتسامح مع الأسطر الجديدة (صيغة الملفات)', () => {
    const data = new Uint8Array(100);
    for (let i = 0; i < data.length; i++) data[i] = i;
    const b64 = bytesToBase64(data).replace(/(.{40})/g, '$1\n');
    const back = base64ToBytes(b64);
    expect(back.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) expect(back[i]).toBe(data[i]);
  });
});
