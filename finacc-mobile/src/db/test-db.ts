import { setDbEngineForTesting } from './client';
import { createWebEngine } from './engine-web';
import { runMigrations } from './migrate';
import { setCurrentUserId } from '@/domain/session-user';

/**
 * مساعد اختبارات (يعمل في bun):
 * ينشئ engine sql.js في الذاكرة (inMemory + wasmBinary يُحمل تلقائياً من node_modules
 * عبر fs داخل engine-web عند كشف بيئة node)، يطبق الهجرات، ويسجله كمحرك حالي.
 */
export async function createTestDb() {
  const engine = await createWebEngine({ inMemory: true });
  await runMigrations(engine);
  setDbEngineForTesting(engine);
  return engine;
}

/** يفكك قاعدة الاختبار ويعيد المحرك الحالي إلى null (مع مسح هوية المستخدم الجلسية لمنع تسرب الحالة بين الملفات). */
export function disposeTestDb(): void {
  setDbEngineForTesting(null);
  setCurrentUserId(null);
}
