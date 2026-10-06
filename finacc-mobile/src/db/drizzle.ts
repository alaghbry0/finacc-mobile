import { drizzle, type AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { getCurrentDb } from './client';
import type { DbEngine } from './types';
import { schema } from './schema';

/**
 * instance دريزل فوق محركنا الموحد عبر sqlite-proxy.
 * قرار معماري موثق: لا drizzle transactions إطلاقاً — المعاملات عبر engine.transaction()
 * (getDrizzle لا يوفر db.batch — غير مدعوم بلا batch callback).
 */

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: DrizzleDb | null = null;

function createCallback(engine: DbEngine): AsyncRemoteCallback {
  return async (sqlText, params, method) => {
    if (method === 'run') {
      const meta = await engine.run(sqlText, params);
      // rows الفارغة كما تتوقع drizzle + meta كحقول إضافية متاحة عند الحاجة
      const result: { rows: unknown[]; lastInsertRowid?: number; changes?: number } = {
        rows: [],
        lastInsertRowid: meta.lastInsertRowId,
        changes: meta.changes,
      };
      return result;
    }
    const rows = await engine.all(sqlText, params);
    if (method === 'get') {
      return { rows: rows.slice(0, 1) };
    }
    if (method === 'values') {
      return { rows: rows.map((row) => Object.values(row)) };
    }
    return { rows };
  };
}

/** lazy — يجب استدعاء getDb() أولاً (يسجل المحرك الحالي في client.ts). */
export function getDrizzle(): DrizzleDb {
  if (instance) return instance;
  const engine = getCurrentDb();
  if (!engine) {
    throw new Error('قاعدة البيانات غير مهيأة بعد — استدعِ getDb() قبل getDrizzle()');
  }
  instance = drizzle(createCallback(engine), { schema });
  return instance;
}
