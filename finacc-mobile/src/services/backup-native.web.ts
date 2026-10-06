/**
 * stub للويب — يمنع تحزيم expo-sqlite في تصدير الويب.
 * الاستعادة على الويب تتم عبر restoreWeb داخل backup.ts مباشرة.
 */
export async function restoreNative(): Promise<void> {
  throw new Error('restoreNative غير متاح على الويب — استخدم مسار الاستعادة للويب');
}
