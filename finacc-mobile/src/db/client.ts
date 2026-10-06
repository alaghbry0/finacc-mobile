import type { DbEngine } from './types';

/**
 * النقطة الموحدة لقاعدة البيانات — الكشف عبر HermesInternal (لا استيراد react-native هنا إطلاقاً).
 * native → expo-sqlite (WAL) / web → sql.js (WASM + IndexedDB).
 * الاستيراد ديناميكي في كلتا الحالتين، ثم تُطبَّق الهجرات مرة واحدة عند أول استخدام.
 */
let engine: DbEngine | null = null;

export async function getDb(): Promise<DbEngine> {
  if (engine) return engine;
  const isNative = typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined';
  // (await إضافي حول الثلاثي — النسخة الحرفية أسندت Promise إلى DbEngine)
  engine = await (isNative
    ? (await import('./engine-native')).createNativeEngine()
    : (await import('./engine-web')).createWebEngine());
  await (await import('./migrate')).runMigrations(engine);
  return engine;
}

export function setDbEngineForTesting(e: DbEngine | null) {
  engine = e;
}

export function getCurrentDb(): DbEngine | null {
  return engine;
}
