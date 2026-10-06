import type { DbEngine } from './types';
import type { SqlJsDatabase } from 'sql.js';

/**
 * محرك sql.js — للويب (مع استمرارية IndexedDB) وللاختبارات في node/bun (inMemory).
 *
 * - الاسترجاع: عند الفتح في المتصفح يُقرأ آخر تصدير (Uint8Array) من IndexedDB.
 * - الاستمرارية: persist() يصدّر القاعدة كاملة إلى IndexedDB مع debounce 400ms،
 *   تُجدوَل تلقائياً بعد كل run مباشر (خارج معاملة) وبعد كل commit خارجي ناجح،
 *   مع فرض الحفظ الفوري عند pagehide/visibilitychange.
 * - المعاملات: عدّاد عمق — العمق 0: BEGIN IMMEDIATE..COMMIT/ROLLBACK،
 *   والأعمق: SAVEPOINT sp_<depth> / RELEASE / ROLLBACK TO (نفس منطق المحرك الأصلي).
 * - sql.js متزامن — كل الدوال مغلفة بـ async لتوافق الواجهة.
 */

const IDB_NAME = 'finacc';
const IDB_STORE = 'state';
const IDB_KEY = 'db';
const PERSIST_DEBOUNCE_MS = 400;

// ---------- IndexedDB (خالصة بلا مكتبات) ----------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('فشل فتح IndexedDB'));
  });
}

async function idbPut(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('فشل حفظ القاعدة في IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('أُلغيت معاملة الحفظ في IndexedDB'));
    });
  } finally {
    idb.close();
  }
}

async function idbGet(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('فشل قراءة القاعدة من IndexedDB'));
    });
  } finally {
    idb.close();
  }
}

async function idbDelete(): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('فشل حذف القاعدة من IndexedDB'));
    });
  } finally {
    idb.close();
  }
}

/** مسح الاستمرارية — يستخدمه زر «مسح البيانات» في المعاينة (web فقط). */
export async function clearWebPersistence(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await idbDelete();
}

// ---------- المحرك ----------

export async function createWebEngine(opts?: { inMemory?: boolean }): Promise<DbEngine> {
  const inMemory = opts?.inMemory ?? false;
  // كشف بيئة الاختبار: node/bun test بلا indexedDB
  const isNode = typeof indexedDB === 'undefined';

  // تحميل sql.js (ديناميكياً حتى يبقى قابل التحزيم في Metro)
  const initSqlJs = (await import('sql.js')).default;

  const config: { locateFile?: (file: string) => string; wasmBinary?: Uint8Array } = {};
  if (isNode) {
    // في node/bun: تحميل الـ wasm من node_modules عبر fs
    // (process.getBuiltinModule لا يراها Metro — تحليل استاتيكي آمن للويب)
    const g = globalThis as unknown as {
      process?: { getBuiltinModule?: (name: string) => unknown; cwd?: () => string };
    };
    const fsMod = g.process?.getBuiltinModule?.('fs') as
      | { readFileSync: (path: string) => Uint8Array }
      | undefined;
    if (!fsMod) throw new Error('بيئة node بلا getBuiltinModule("fs") — تعذر تحميل wasm الخاص بـ sql.js');
    const cwd = g.process?.cwd?.() ?? '.';
    config.wasmBinary = fsMod.readFileSync(`${cwd}/node_modules/sql.js/dist/sql-wasm.wasm`);
  } else {
    // في المتصفح: الـ wasm يُخدم من مسار المعاينة (ينسخه سكربت البناء)
    config.locateFile = (file: string) => '/rn/assets/' + file;
  }

  const SQL = await initSqlJs(config);

  // الاسترجاع من IndexedDB (متصفح فقط، خارج وضع الاختبار)
  let db: SqlJsDatabase;
  if (!inMemory && !isNode) {
    const saved = await idbGet();
    db = saved ? new SQL.Database(saved) : new SQL.Database();
  } else {
    db = new SQL.Database();
  }

  db.exec('PRAGMA foreign_keys = ON;');

  let txDepth = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushNow(): Promise<void> {
    if (inMemory || isNode) return;
    const bytes = db.export();
    await idbPut(bytes);
  }

  /** جدولة تصدير كامل مع debounce 400ms. */
  function schedulePersist(): void {
    if (inMemory || isNode) return;
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void flushNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  // فرض الحفظ الفوري عند إخفاء الصفحة (قد لا يأتي المؤقت أبداً)
  if (!inMemory && !isNode) {
    const forceFlush = (): void => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      void flushNow();
    };
    window.addEventListener('pagehide', forceFlush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') forceFlush();
    });
  }

  const engine: DbEngine = {
    async run(sql, params) {
      const stmt = db.prepare(sql);
      try {
        if (params !== undefined && params.length > 0) stmt.bind(params);
        stmt.step();
        const changes = db.getRowsModified();
        const lastRow = db.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowId =
          lastRow.length > 0 && lastRow[0].values.length > 0 ? Number(lastRow[0].values[0][0]) : 0;
        if (txDepth === 0) schedulePersist();
        return { changes, lastInsertRowId };
      } finally {
        stmt.free();
      }
    },

    async all<T>(sql: string, params?: unknown[]) {
      const stmt = db.prepare(sql);
      try {
        if (params !== undefined && params.length > 0) stmt.bind(params);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },

    async exec(sql) {
      db.exec(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const depth = txDepth;
      txDepth += 1;
      if (depth === 0) {
        db.exec('BEGIN IMMEDIATE');
      } else {
        db.exec(`SAVEPOINT sp_${depth}`);
      }
      try {
        const result = await fn();
        if (depth === 0) {
          db.exec('COMMIT');
          // persist بعد commit خارجي ناجح (جدولة فقط)
          schedulePersist();
        } else {
          db.exec(`RELEASE sp_${depth}`);
        }
        return result;
      } catch (err) {
        try {
          if (depth === 0) {
            db.exec('ROLLBACK');
          } else {
            db.exec(`ROLLBACK TO sp_${depth}`);
            db.exec(`RELEASE sp_${depth}`);
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
      schedulePersist();
    },
  };

  return engine;
}
