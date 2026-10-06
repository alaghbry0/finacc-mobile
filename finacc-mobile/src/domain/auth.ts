import { getDb } from '@/db/client';
import { verifyPinHash } from '@/services/crypto';
import { setCurrentUserId } from './session-user';
import { logAudit } from './audit';

/**
 * سياسة قفل PIN (FR-12-06 / قرار 4):
 * - المحاولات 1–4 الخاطئة: خطأ عادي بلا قفل.
 * - المحاولة 5+: تأخير متصاعد locked_for = min(30s × 2^(attempts−5), 900s) → locked_until.
 * - المحاولة 10+: قفل حتى عبارة المرور (requirePassphrase=true، locked_until بعيد جداً).
 * - V1: مدير واحد فقط (أول صف في app_user — ينشئه الإعداد الأولي).
 *
 * التحقق الناجح لا يكتب شيئاً هنا — الشاشة تستدعي recordUnlockSuccess() عند الدخول الفعلي.
 */

export interface PinCheckResult {
  ok: boolean;
  /** الثواني المتبقية للقفل (موجبة فقط عند القفل). */
  lockedForSeconds?: number;
  /** true بعد 10 محاولات خاطئة: الحل هو عبارة المرور أو مسح كامل بتأكيد مزدوج. */
  requirePassphrase?: boolean;
  /** رسالة عربية جاهزة للعرض عند ok=false. */
  error?: string;
}

/** عتبات القرار 4 حرفياً. */
const LOCK_START_ATTEMPT = 5;
const PASSPHRASE_ATTEMPT = 10;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 900;

/** قيمة locked_until عند «مقفل حتى عبارة المرور» (بعيدة بما يكفي = 100 سنة). */
const PASSPHRASE_LOCK_YEARS = 100;

interface AdminRow {
  id: number;
  pin_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

async function getAdmin(): Promise<AdminRow | null> {
  const db = await getDb();
  const rows = await db.all<AdminRow>(
    'SELECT id, pin_hash, failed_attempts, locked_until FROM app_user ORDER BY id LIMIT 1',
  );
  return rows.length > 0 ? rows[0] : null;
}

/** فحص PIN بلا كتابة عند النجاح؛ الفشل يزيد العداد ويطبق سياسة القفل. */
export async function verifyPin(pin: string): Promise<PinCheckResult> {
  const admin = await getAdmin();
  if (!admin) {
    return { ok: false, error: 'لا يوجد مستخدم بعد — أكمل الإعداد الأولي للتطبيق أولاً' };
  }

  // مقفل حالياً؟ (قفل مؤقت أو قفل عبارة المرور)
  if (admin.locked_until) {
    const untilMs = Date.parse(admin.locked_until);
    if (Number.isFinite(untilMs) && untilMs > Date.now()) {
      const remaining = Math.ceil((untilMs - Date.now()) / 1000);
      if (admin.failed_attempts >= PASSPHRASE_ATTEMPT) {
        return {
          ok: false,
          requirePassphrase: true,
          lockedForSeconds: remaining,
          error:
            'حُجب الدخول بعد عشر محاولات خاطئة — أدخل عبارة المرور لفك الحجب، ' +
            'وإن نسيتها فالحل الوحيد هو المسح الكامل بتأكيد مزدوج (ستفقد كل البيانات إن لم يكن لديك نسخة احتياطية)',
        };
      }
      return {
        ok: false,
        lockedForSeconds: remaining,
        error: `رمز PIN مقفل مؤقتاً بسبب محاولات خاطئة متكررة — انتظر ${remaining} ثانية ثم أعد المحاولة`,
      };
    }
  }

  if (!admin.pin_hash) {
    return { ok: false, error: 'لم يُعيَّن رمز PIN لهذا الجهاز — عيّنه من الإعداد الأولي أو شاشة الإعدادات' };
  }

  const storedHash = admin.pin_hash;
  const attempts = admin.failed_attempts + 1; // المحاولة الحالية تحتسب فور فشلها
  const now = new Date().toISOString();

  if (await verifyPinHash(pin, storedHash)) {
    return { ok: true };
  }

  // فشل → تحديث العداد والقفل
  const db = await getDb();
  if (attempts >= PASSPHRASE_ATTEMPT) {
    const lockedUntil = new Date(
      Date.now() + PASSPHRASE_LOCK_YEARS * 365 * 24 * 3600 * 1000,
    ).toISOString();
    await db.run(
      'UPDATE app_user SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      [attempts, lockedUntil, now, admin.id],
    );
    await logAudit('pin_locked_passphrase', { entity: 'app_user', entityId: admin.id, details: { attempts } });
    return {
      ok: false,
      requirePassphrase: true,
      lockedForSeconds: MAX_LOCK_SECONDS,
      error:
        'حُجب الدخول بعد عشر محاولات خاطئة — أدخل عبارة المرور لفك الحجب، ' +
        'وإن نسيتها فالحل الوحيد هو المسح الكامل بتأكيد مزدوج (ستفقد كل البيانات إن لم يكن لديك نسخة احتياطية)',
    };
  }

  if (attempts >= LOCK_START_ATTEMPT) {
    const lockSeconds = Math.min(BASE_LOCK_SECONDS * 2 ** (attempts - LOCK_START_ATTEMPT), MAX_LOCK_SECONDS);
    const lockedUntil = new Date(Date.now() + lockSeconds * 1000).toISOString();
    await db.run(
      'UPDATE app_user SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      [attempts, lockedUntil, now, admin.id],
    );
    return {
      ok: false,
      lockedForSeconds: lockSeconds,
      error: `رمز PIN غير صحيح — قُفل مؤقتاً لمدة ${lockSeconds} ثانية بسبب ${attempts} محاولات خاطئة`,
    };
  }

  await db.run('UPDATE app_user SET failed_attempts = ?, updated_at = ? WHERE id = ?', [attempts, now, admin.id]);
  const left = LOCK_START_ATTEMPT - attempts;
  return {
    ok: false,
    error: `رمز PIN غير صحيح — أعد المحاولة (تبقى ${left} ${left === 1 ? 'محاولة' : 'محاولات'} قبل القفل المؤقت)`,
  };
}

/** إعادة تعيين العداد بعد دخول ناجح + تسجيل آخر دخول + ضبط هوية الجلسة. */
export async function recordUnlockSuccess(): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{ id: number }>('SELECT id FROM app_user ORDER BY id LIMIT 1');
  if (rows.length === 0) return;
  const id = Number(rows[0].id);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    [now, now, id],
  );
  setCurrentUserId(id);
}

/**
 * فك حجب «عشر محاولات» بعبارة المرور (FR-12-06):
 * V1 لا يخزّن عبارة مرور إطلاقاً (اختيارية من الإعدادات لاحقاً) → false دائماً،
 * والواجهة تُظهر عندئذ خيار المسح الكامل بتأكيد مزدوج (نسيانها = فقدان البيانات نهائياً).
 */
export async function verifyPassphraseAndUnlock(_passphrase: string): Promise<boolean> {
  void _passphrase;
  return false;
}
