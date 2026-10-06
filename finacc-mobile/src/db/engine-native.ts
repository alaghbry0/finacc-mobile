import * as SQLite from 'expo-sqlite';
import type { DbEngine } from './types';

/**
 * محرك expo-sqlite للأجهزة (native) — WAL + foreign_keys مفعّلان دائماً.
 * لا يُستورد إلا ديناميكياً من client.ts (كشف HermesInternal) حتى لا يُنفَّذ على الويب.
 * منطق المعاملات منسوخ حرفياً من محرك الويب (BEGIN IMMEDIATE + SAVEPOINT)
 * — بلا withTransactionAsync — لتطابق السلوك بين المنصتين.
 */

type BindParams = (string | number | null | boolean | Uint8Array)[];

export async function createNativeEngine(): Promise<DbEngine> {
  const db = await SQLite.openDatabaseAsync('finacc.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const bind = (params?: unknown[]): BindParams => (params ?? []) as BindParams;

  let txDepth = 0;

  const engine: DbEngine = {
    async run(sql, params) {
      const result = await db.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowId ?? 0) };
    },

    async all<T>(sql: string, params?: unknown[]) {
      return (await db.getAllAsync<T>(sql, bind(params))) as T[];
    },

    async exec(sql) {
      await db.execAsync(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const depth = txDepth;
      txDepth += 1;
      try {
        if (depth === 0) {
          await db.execAsync('BEGIN IMMEDIATE');
        } else {
          await db.execAsync(`SAVEPOINT sp_${depth}`);
        }
        const result = await fn();
        if (depth === 0) {
          await db.execAsync('COMMIT');
        } else {
          await db.execAsync(`RELEASE sp_${depth}`);
        }
        return result;
      } catch (err) {
        try {
          if (depth === 0) {
            await db.execAsync('ROLLBACK');
          } else {
            await db.execAsync(`ROLLBACK TO sp_${depth}`);
            await db.execAsync(`RELEASE sp_${depth}`);
          }
        } catch {
          // تجاهل فشل التراجع للحفاظ على الخطأ الأصلي
        }
        throw err;
      } finally {
        txDepth -= 1;
      }
    },

    persist(): void {
      // no-op — القاعدة على القرص (WAL) على الجهاز، لا حاجة لتصدير يدوي
    },

    /** تصدير بايتات ملف القاعدة بعد checkpoint — للنسخ الاحتياطي (الجهاز). */
    async exportDbBytes(): Promise<Uint8Array> {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
      const FileSystem = await import('expo-file-system/legacy');
      const src = `${FileSystem.documentDirectory}SQLite/finacc.db`;
      const b64 = await FileSystem.readAsStringAsync(src, { encoding: FileSystem.EncodingType.Base64 });
      return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    },

    /** إغلاق الاتصال — قبل استبدال ملف القاعدة عند الاستعادة (FR-11-02). */
    async close(): Promise<void> {
      await db.closeAsync();
    },
  };

  return engine;
}
