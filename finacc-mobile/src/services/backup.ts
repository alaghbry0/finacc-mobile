import { isNativePlatform } from '@/utils/platform';
import { getDb, setDbEngineForTesting } from '@/db/client';
import { SCHEMA_VERSION } from '@/db/migrate';
import { initSqlJsRuntime } from '@/db/engine-web';
import type { SqlJsDatabase } from 'sql.js';
import { getSetting } from '@/domain/settings';
import { isOnboarded } from '@/domain/onboarding';
import { getCurrentUserId } from '@/domain/session-user';
import { bytesToBase64 as pureBytesToBase64, base64ToBytes as pureBase64ToBytes } from '@/utils/base64';

/**
 * النسخ الاحتياطي والاستعادة المحلي 100% (الوحدة 11 — FR-11-01/02/04/05/06/08):
 *
 * ── الويب ──────────────────────────────────────────────────────────────────
 * - يدوي: بايتات القاعدة (db.export) → تنزيل ملف finacc-backup-YYYYMMDD-HHmm.db.
 * - تلقائي/pre_restore: نسخة صامتة في IndexedDB منفصل (finacc-backups) — بلا تنزيل مزعج.
 * - الاستعادة: اختيار ملف → فحص (قاعدة صالحة + إصدار المخطط ≤ التطبيق) → نسخة أمان
 *   تلقائية → استبدال الاستمرارية → إعادة تحميل التطبيق.
 *
 * ── الجهاز (native) ────────────────────────────────────────────────────────
 * - checkpoint(WAL) ثم بايتات الملف → مجلد backups داخل documentDirectory
 *   + قائمة مشاركة النظام (FR-11-08: واتساب/درايف/بلوتوث).
 * - الاستعادة: document-picker → فحص بقاعدة مؤقتة → نسخة أمان → استبدال الملف
 *   → مطالبة المستخدم بإعادة تشغيل التطبيق (الحالة في الذاكرة قديمة).
 *
 * ── الاحتفاظ (FR-11-05) ────────────────────────────────────────────────────
 * آخر N نسخة (backup.retention_count): تُحذف النسخ المخزنة الأقدم + سجلها؛
 * سجل النسخ اليدوية على الويب يبقى دائماً (ملفاتها في تنزيلات المتصفح خارجة عن سيطرتنا).
 */

const isWebPlatform = !isNativePlatform();

export type BackupKind = 'manual' | 'auto' | 'pre_restore';

export interface BackupLogRow {
  id: number;
  kind: string;
  fileName: string | null;
  fileSize: number | null;
  status: string;
  at: string;
}

export interface BackupResult {
  fileName: string;
  sizeBytes: number;
}

// ============ أدوات مشتركة ============

/** طابع محلي YYYYMMDD-HHmm لاسم ملف النسخة. */
function stampLocal(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ترميز Base64 خالص — بلا btoa/atob (غير موجودين في Hermes) وبلا Buffer
// (غير موجود في المتصفح) — نفس المخرجات على المنصات الثلاث (Task Android-Fix)
function bytesToBase64(bytes: Uint8Array): string {
  return pureBytesToBase64(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  return pureBase64ToBytes(b64);
}

/** تنزيل بايتات كملف في المتصفح (استدعاء مستخدم = إيماءة صالحة للتنزيل). */
function downloadBytes(bytes: Uint8Array, fileName: string): void {
  if (typeof document === 'undefined') return; // بيئة الاختبار
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
}

// ============ مخزن النسخ الصامتة على الويب (IndexedDB منفصل عن قاعدة التطبيق) ============

const BK_DB = 'finacc-backups';
const BK_STORE = 'files';
const hasIdb = typeof indexedDB !== 'undefined';

function openBackupIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BK_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BK_STORE)) {
        request.result.createObjectStore(BK_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('فشل فتح مخزن النسخ'));
  });
}

async function putStoredBackup(fileName: string, bytes: Uint8Array): Promise<void> {
  if (!hasIdb) return; // الاختبارات في node — لا مخزن، يبقى السجل فقط
  const idb = await openBackupIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(BK_STORE, 'readwrite');
      tx.objectStore(BK_STORE).put(bytes, fileName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('فشل حفظ النسخة الصامتة'));
    });
  } finally {
    idb.close();
  }
}

async function listStoredBackups(): Promise<string[]> {
  if (!hasIdb) return [];
  const idb = await openBackupIdb();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const req = idb.transaction(BK_STORE, 'readonly').objectStore(BK_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String).sort());
      req.onerror = () => reject(req.error ?? new Error('فشل قراءة مخزن النسخ'));
    });
  } finally {
    idb.close();
  }
}

async function deleteStoredBackup(fileName: string): Promise<void> {
  if (!hasIdb) return;
  const idb = await openBackupIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(BK_STORE, 'readwrite');
      tx.objectStore(BK_STORE).delete(fileName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('فشل حذف نسخة قديمة'));
    });
  } finally {
    idb.close();
  }
}

// ============ السجل والاحتفاظ ============

async function insertBackupLog(kind: BackupKind, fileName: string, sizeBytes: number): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO backup_log(kind, file_name, file_size, status, at, user_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
    [kind, fileName, sizeBytes, 'ok', now, getCurrentUserId(), now],
  );
}

/** الاحتفاظ بآخر N نسخة (FR-11-05) — المخزنة فقط؛ سجل اليدوية على الويب يبقى. */
async function applyRetention(): Promise<void> {
  const db = await getDb();
  const n = Number(await getSetting('backup.retention_count'));
  if (!Number.isFinite(n) || n < 1) return;

  if (isWebPlatform) {
    // الويب: النسخ الصامتة المخزنة (auto/pre_restore) تُحذف فوق N مع سجلها.
    // النسخ اليدوية ملفاتها في تنزيلات المتصفح (خارج إدارتنا) — سجلها يبقى.
    const stored = await listStoredBackups();
    for (const fileName of stored.slice(0, Math.max(0, stored.length - n))) {
      await deleteStoredBackup(fileName);
      await db.run('DELETE FROM backup_log WHERE file_name = ? AND kind IN (?, ?)', [
        fileName,
        'auto',
        'pre_restore',
      ]);
    }
    // سجل الأنواع الصامتة يُقلم إلى آخر N ولو ضاعت ملفات المتصفح (تنظيف يدوي/خصوصية)
    await db.run(
      'DELETE FROM backup_log WHERE kind IN (?, ?) AND id NOT IN ' +
        '(SELECT id FROM backup_log WHERE kind IN (?, ?) ORDER BY at DESC, id DESC LIMIT ?)',
      ['auto', 'pre_restore', 'auto', 'pre_restore', n],
    );
    return;
  }

  // الجهاز: ملفات مجلد backups — كل الأنواع (الملفات كلها تحت إدارتنا)
  const FileSystem = await import('expo-file-system/legacy');
  const dir = `${FileSystem.documentDirectory}backups/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists || info.isDirectory !== true) return;
  const files = ((await FileSystem.readDirectoryAsync(dir)) as string[])
    .filter((f) => f.startsWith('finacc-backup-') && f.endsWith('.db'))
    .sort();
  const excess = files.slice(0, Math.max(0, files.length - n));
  for (const fileName of excess) {
    try {
      await FileSystem.deleteAsync(`${dir}${fileName}`, { idempotent: true });
      await db.run('DELETE FROM backup_log WHERE file_name = ?', [fileName]);
    } catch {
      /* ملف مقفل — يبقى للجولة القادمة */
    }
  }
}

// ============ إنشاء نسخة (FR-11-01) ============

/** نسخة يدوية: زر واحد — تنزيل على الويب / ملف مشاركة على الجهاز + سجل دائماً. */
export async function createBackup(kind: BackupKind = 'manual'): Promise<BackupResult> {
  const engine = await getDb();
  if (engine.exportDbBytes === undefined) {
    throw new Error('محرك القاعدة الحالي لا يدعم التصدير — لا يمكن إنشاء النسخة');
  }
  const bytes = await engine.exportDbBytes();
  const fileName = `finacc-backup-${stampLocal()}.db`;
  const sizeBytes = bytes.length;

  if (isWebPlatform) {
    if (kind === 'manual') {
      downloadBytes(bytes, fileName);
    } else {
      await putStoredBackup(fileName, bytes);
    }
  } else {
    // الجهاز: checkpoint حدث داخل exportDbBytes — نكتب الملف في مجلد التطبيق
    const FileSystem = await import('expo-file-system/legacy');
    const dir = `${FileSystem.documentDirectory}backups/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.writeAsStringAsync(`${dir}${fileName}`, bytesToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  await insertBackupLog(kind, fileName, sizeBytes);
  await applyRetention();
  return { fileName, sizeBytes };
}

/** مشاركة ملف النسخة عبر قائمة النظام (FR-11-08) — يعيد مسار الملف أو null. */
export async function shareLatestBackup(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.all<{ file_name: string | null }>(
    "SELECT file_name FROM backup_log WHERE status = 'ok' AND file_name IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1",
  );
  const fileName = rows[0]?.file_name ?? null;
  if (fileName === null) throw new Error('لا توجد نسخة محفوظة لمشاركتها بعد');

  if (isWebPlatform) {
    // على الويب الملف في تنزيلات المتصفح — لا نديره من هنا
    return null;
  }
  const FileSystem = await import('expo-file-system/legacy');
  const path = `${FileSystem.documentDirectory}backups/${fileName}`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) throw new Error(`ملف النسخة «${fileName}» لم يعد موجوداً في مجلد التطبيق`);
  const Sharing = await import('expo-sharing');
  if ((await Sharing.isAvailableAsync()) === false) return path;
  await Sharing.shareAsync(path, {
    mimeType: 'application/x-sqlite3',
    dialogTitle: `نسخة احتياطية ${fileName}`,
  });
  return path;
}

// ============ فحص نسخة الاستعادة (FR-11-02) ============

/**
 * فحص سلامة بايتات نسخة: قاعدة SQLite مقروءة بها جداولنا + إصدار مخطط لا يتجاوز التطبيق.
 * يعيد إصدار مخطط النسخة، ويرفض برسائل عربية واضحة.
 */
export async function verifyBackupBytes(bytes: Uint8Array): Promise<number> {
  const SQL = await initSqlJsRuntime();
  let db: SqlJsDatabase;
  try {
    db = new SQL.Database(bytes);
  } catch {
    throw new Error('الملف المختار ليس ملف قاعدة صالح — تأكد من اختيار نسخة أنشأها «المُحاسِب الشخصي»');
  }
  try {
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('settings', '_migrations', 'company')",
    );
    if (tables.length === 0 || (tables[0]?.values.length ?? 0) < 3) {
      throw new Error('الملف ليس نسخة من قاعدة «المُحاسِب الشخصي» — جداوله الأساسية غير موجودة');
    }
    const res = db.exec('SELECT COALESCE(MAX(version), 0) AS v FROM _migrations');
    const version = Number(res[0]?.values[0]?.[0] ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `نسخة بإصدار مخطط أحدث (${version}) من المدعوم في هذا التطبيق (${SCHEMA_VERSION}) — ` +
          'حدّث التطبيق أولاً ثم استعِد منها (لا يجوز الرجوع لمخطط أقدم)',
      );
    }
    return version;
  } finally {
    db.close();
  }
}

/** اختيار ملف من المستخدم — ويب: input مخفي / جهاز: document-picker. */
async function pickBackupFile(): Promise<Uint8Array | null> {
  if (isWebPlatform) {
    if (typeof document === 'undefined') return null; // بيئة الاختبار
    return await new Promise<Uint8Array | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.db,application/octet-stream,application/x-sqlite3';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file === undefined || file === null) {
          input.remove();
          resolve(null);
          return;
        }
        void file.arrayBuffer().then(
          (buf) => {
            input.remove();
            resolve(new Uint8Array(buf));
          },
          () => {
            input.remove();
            resolve(null);
          },
        );
      });
      input.addEventListener('cancel', () => {
        input.remove();
        resolve(null);
      });
      input.click();
    });
  }

  const DocumentPicker = await import('expo-document-picker');
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  const asset = res.canceled === true ? undefined : res.assets?.[0];
  if (asset === undefined) return null;
  const FileSystem = await import('expo-file-system/legacy');
  const b64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(b64);
}

// ============ الاستعادة (FR-11-02) ============

/** استعادة على الويب: فحص → نسخة أمان → استبدال الاستمرارية → إعادة تحميل. */
async function restoreWeb(bytes: Uint8Array): Promise<void> {
  const version = await verifyBackupBytes(bytes);
  // تسجيل حدث الاستعادة داخل بايتات النسخة الجديدة نفسها (سجل التدقيق append-only
  // في القاعدة القديمة يُستبدل — فنسجّل الحدث حيث يبقى)
  const SQL = await initSqlJsRuntime();
  const db = new SQL.Database(bytes);
  try {
    const now = new Date().toISOString();
    db.run('INSERT INTO audit_log(user_id, action, entity, details, at) VALUES(?, ?, ?, ?, ?)', [
      getCurrentUserId(),
      'restore_backup',
      'backup',
      JSON.stringify({ schemaVersion: version }),
      now,
    ]);
    const newBytes = db.export();
    await createBackup('pre_restore'); // نسخة أمان تلقائية للقاعدة الحالية قبل الاستبدال
    const engine = await getDb();
    if (engine.importDbBytes === undefined) {
      throw new Error('محرك الويب الحالي لا يدعم الاستعادة — أعد تحميل الصفحة وحاول مجدداً');
    }
    await engine.importDbBytes(newBytes);
  } finally {
    db.close();
  }
  if (typeof window !== 'undefined') window.location.reload();
}

/** استعادة من ملف — السياسة كاملة في وصف الوحدة أعلاه. يعيد true إن أُعيد التحميل. */
export async function restoreBackup(): Promise<{ reloaded: boolean }> {
  const bytes = await pickBackupFile();
  if (bytes === null) return { reloaded: false };
  if (isWebPlatform) {
    await restoreWeb(bytes);
    return { reloaded: true };
  }
  const { restoreNative } = await import('./backup-native');
  await restoreNative(bytes);
  return { reloaded: false };
}

// ============ السجل والجدولة (FR-11-04/06) ============

/** سجل النسخ (الأحدث أولاً). */
export async function backupLog(limit = 100): Promise<BackupLogRow[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: number; kind: string; file_name: string | null; file_size: number | null; status: string | null; at: string;
  }>(
    'SELECT id, kind, file_name, file_size, status, at FROM backup_log ORDER BY at DESC, id DESC LIMIT ?',
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    fileName: r.file_name === null ? null : String(r.file_name),
    fileSize: r.file_size === null ? null : Number(r.file_size),
    status: String(r.status ?? 'ok'),
    at: String(r.at),
  }));
}

/** تاريخ آخر نسخة (أي نوع) أو null. */
export async function lastBackupAt(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.all<{ at: string }>('SELECT at FROM backup_log ORDER BY at DESC, id DESC LIMIT 1');
  return rows.length > 0 ? String(rows[0].at) : null;
}

let autoBackupChecked = false;

/**
 * نسخة تلقائية صامتة عند فتح التطبيق إذا مضى المحدد في backup.schedule (FR-11-04) —
 * تُستدعى مرة واحدة لكل جلسة، ولا تكسر الإقلاع أبداً عند أي فشل.
 */
export async function maybeAutoBackup(): Promise<void> {
  if (autoBackupChecked) return;
  autoBackupChecked = true;
  try {
    if (!(await isOnboarded())) return; // قاعدة فارغة قبل الإعداد الأولي — لا نسخ للا شيء
    const schedule = await getSetting('backup.schedule');
    if (schedule === 'off') return;
    const intervalMs = schedule === 'daily' ? 24 * 3600_000 : 7 * 24 * 3600_000;
    const last = await lastBackupAt();
    if (last !== null) {
      const elapsed = Date.now() - Date.parse(last);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < intervalMs) return;
    }
    await createBackup('auto');
  } catch {
    /* النسخ التلقائي مسألة خلفية — لا يعطل الاستخدام */
  }
}

/** إعادة ضبط حارس «مرة لكل جلسة» — للاختبارات فقط. */
export function _resetAutoBackupGuardForTests(): void {
  autoBackupChecked = false;
}
