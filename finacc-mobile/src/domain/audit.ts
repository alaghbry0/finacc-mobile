import { getDb } from '@/db/client';
import { getCurrentUserId } from './session-user';

/**
 * سجل التدقيق (FR-12-04) — إضافة فقط (append-only):
 * الجدول محمي بـ SQLite Triggers ضد UPDATE/DELETE (الهجرة 0001)، وهنا نوفّر الإدراج الموحد.
 * أحداث موصى بها: void_invoice, price_override, fx_edit, stocktake, backdate,
 * restore_backup, cheque_bounce, owner_draw, backdate_confirmed, onboarding_complete…
 *
 * ملاحظة: إن استُدعيت داخل transaction مفتوحة تنضم إليها (تُرجَع معها عند الفشل) — سلوك مقصود.
 */
export async function logAudit(
  action: string,
  opts?: { entity?: string; entityId?: number; details?: unknown },
): Promise<void> {
  if (!action || typeof action !== 'string') {
    throw new Error('حدث التدقيق (action) مطلوب — مرّر اسماً واصفاً مثل «void_invoice»');
  }
  const db = await getDb();
  const userId = getCurrentUserId();
  const details =
    opts?.details === undefined ? null : JSON.stringify(opts.details, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  await db.run(
    'INSERT INTO audit_log(user_id, action, entity, entity_id, details, at) VALUES(?, ?, ?, ?, ?, ?)',
    [userId ?? null, action, opts?.entity ?? null, opts?.entityId ?? null, details, new Date().toISOString()],
  );
}
