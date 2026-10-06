import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { verifyPin, recordUnlockSuccess, verifyPassphraseAndUnlock } from '@/domain/auth';
import { getCurrentUserId, setCurrentUserId } from '@/domain/session-user';
import { hashPin, verifyPinHash, randomId } from '@/services/crypto';

/**
 * اختبارات سياسة قفل PIN (FR-12-06 / قرار 4):
 * 1–4 أخطاء عادية، 5+ قفل متصاعد min(30×2^(n−5), 900)، 10+ عبارة المرور،
 * والنجاح لا يكتب شيئاً — الشاشة تستدعي recordUnlockSuccess.
 */

const PIN = '1234';
const WRONG = '0000';

let pinHash = '';

beforeAll(async () => {
  await createTestDb();
  pinHash = await hashPin(PIN);
  const db = await getDb();
  await db.run(
    'INSERT INTO app_user(username, display_name, role, pin_hash, is_active, created_at) VALUES(?, ?, ?, ?, 1, ?)',
    ['admin', 'المدير', 'admin', pinHash, '2026-01-01T00:00:00.000Z'],
  );
});

afterAll(() => {
  setCurrentUserId(null);
  disposeTestDb();
});

async function getAttempts(): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ failed_attempts: number }>('SELECT failed_attempts FROM app_user WHERE id = 1');
  return rows[0]?.failed_attempts ?? -1;
}

describe('auth: verifyPin — المسار العادي', () => {
  test('PIN صحيح → ok:true بلا أي كتابة', async () => {
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(true);
    expect(r.lockedForSeconds).toBeUndefined();
    expect(getCurrentUserId()).toBeNull(); // لم تُضبط هوية الجلسة هنا
    expect(await getAttempts()).toBe(0);
  });

  test('PIN خاطئ → ok:false برسالة عربية', async () => {
    const r = await verifyPin(WRONG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('غير صحيح');
    expect(await getAttempts()).toBe(1);
  });
});

describe('auth: القفل المتصاعد (قرار 4)', () => {
  test('المحاولات 1–4 الخاطئة: خطأ عادي بلا قفل', async () => {
    // المحاولة 1 حدثت في الاختبار السابق — نكمل حتى 4
    for (let i = 0; i < 3; i++) {
      const r = await verifyPin(WRONG);
      expect(r.ok).toBe(false);
      expect(r.lockedForSeconds).toBeUndefined();
      expect(r.requirePassphrase).toBeUndefined();
    }
    expect(await getAttempts()).toBe(4);
  });

  test('المحاولة 5 → قفل 30 ثانية (lockedForSeconds > 0)', async () => {
    const r = await verifyPin(WRONG);
    expect(r.ok).toBe(false);
    expect(r.lockedForSeconds ?? 0).toBeGreaterThan(0);
    expect(r.lockedForSeconds ?? 99).toBeLessThanOrEqual(30);
    expect(r.requirePassphrase).toBeUndefined();
    expect(r.error).toContain('قُفل مؤقتاً');
  });

  test('محاولة خلال القفل (حتى PIN صحيح) → مرفوضة مع الوقت المتبقي', async () => {
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(false);
    expect(r.lockedForSeconds ?? 0).toBeGreaterThan(0);
    expect(await getAttempts()).toBe(5); // المحاولة خلال القفل لا تزيد العداد
  });

  test('بعد انقضاء القفل: PIN صحيح يعمل من جديد', async () => {
    const db = await getDb();
    await db.run("UPDATE app_user SET locked_until = '2000-01-01T00:00:00.000Z' WHERE id = 1");
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(true);
  });

  test('بعد انقضاء القفل: خطأ جديد يصعّد (المحاولة 6 → 60 ثانية)', async () => {
    const r = await verifyPin(WRONG);
    expect(r.ok).toBe(false);
    expect(r.lockedForSeconds ?? 0).toBeGreaterThan(30); // 60
    expect(r.lockedForSeconds ?? 0).toBeLessThanOrEqual(60);
    expect(await getAttempts()).toBe(6);
  });
});

describe('auth: عتبة العشر محاولات (عبارة المرور)', () => {
  test('المحاولة 10 → requirePassphrase=true', async () => {
    const db = await getDb();
    await db.run('UPDATE app_user SET failed_attempts = 9, locked_until = NULL WHERE id = 1');
    const r = await verifyPin(WRONG);
    expect(r.ok).toBe(false);
    expect(r.requirePassphrase).toBe(true);
    expect(r.lockedForSeconds ?? 0).toBeGreaterThan(0);
    expect(r.error).toContain('عشر محاولات');
    expect(await getAttempts()).toBe(10);
  });

  test('خلال حجب العبارة: حتى PIN الصحيح مرفوض مع requirePassphrase', async () => {
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(false);
    expect(r.requirePassphrase).toBe(true);
  });

  test('verifyPassphraseAndUnlock: V1 لا يخزن عبارة مرور → false دائماً', async () => {
    expect(await verifyPassphraseAndUnlock('أي عبارة')).toBe(false);
    expect(await verifyPassphraseAndUnlock('')).toBe(false);
  });
});

describe('auth: recordUnlockSuccess', () => {
  test('يصفّر العداد والقفل ويسجل الدخول ويضبط هوية الجلسة', async () => {
    await recordUnlockSuccess();
    const db = await getDb();
    const rows = await db.all<{ failed_attempts: number; locked_until: string | null; last_login_at: string | null }>(
      'SELECT failed_attempts, locked_until, last_login_at FROM app_user WHERE id = 1',
    );
    expect(rows[0]?.failed_attempts).toBe(0);
    expect(rows[0]?.locked_until).toBeNull();
    expect(rows[0]?.last_login_at).not.toBeNull();
    expect(getCurrentUserId()).toBe(1);

    // وبعد التصفير: PIN الصحيح يعمل مباشرة
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(true);
  });
});

describe('auth: حالات نادرة', () => {
  test('بلا PIN معين (pin_hash NULL) → رسالة تعيين واضحة', async () => {
    const db = await getDb();
    await db.run('UPDATE app_user SET pin_hash = NULL WHERE id = 1');
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('لم يُعيَّن رمز PIN');
  });

  test('بلا مستخدم أصلاً → رسالة الإعداد الأولي', async () => {
    const db = await getDb();
    await db.run('DELETE FROM app_user');
    const r = await verifyPin(PIN);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('الإعداد الأولي');
  });
});

describe('crypto: واجهة التجزئة (PBKDF2 طبقة المعاينة)', () => {
  test('hashPin ثم verifyPinHash: تطابق ورفض', async () => {
    const h1 = await hashPin('9999');
    expect(h1.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPinHash('9999', h1)).toBe(true);
    expect(await verifyPinHash('0000', h1)).toBe(false);
  });

  test('salt ثابت → نفس البصمة (قابلية إعادة الإنتاج للاختبارات)', async () => {
    const a = await hashPin('2580', 'aabbccdd');
    const b = await hashPin('2580', 'aabbccdd');
    expect(a).toBe(b);
    expect(a.startsWith('pbkdf2$100000$aabbccdd$')).toBe(true);
  });

  test('صيغة بصمة تالفة → خطأ عربي واضح', async () => {
    let msg = '';
    try {
      await verifyPinHash('1234', 'argon2$xxx');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('صيغة بصمة PIN غير معروفة');
  });

  test('randomId بصيغة uuid-like فريدة', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
