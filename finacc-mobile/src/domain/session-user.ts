/**
 * تتبع المستخدم الحالي داخل الجلسة — يستخدمه سجل التدقيق (audit.ts) لتعبئة user_id
 * دون تمريره في كل استدعاء. تضبطه شاشة الدخول عبر recordUnlockSuccess() (auth.ts)
 * وشاشة الإعداد الأولي عبر completeOnboarding() (onboarding.ts).
 */

let currentUserId: number | null = null;

/** ضبط هوية المستخدم الحالي (أو null عند الخروج/القفل). */
export function setCurrentUserId(id: number | null): void {
  currentUserId = id;
}

/** هوية المستخدم الحالي أو null إن لم يسجّل دخله أحد بعد. */
export function getCurrentUserId(): number | null {
  return currentUserId;
}
