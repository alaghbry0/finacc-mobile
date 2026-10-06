/**
 * استعادة النسخة على الجهاز (native فقط) — ملف منفصل حتى لا يُحزَّم expo-sqlite
 * في تصدير الويب (Metro يحلل كل الاستيرادات الديناميكية).
 * على الويب يستخدم Metro اللاحقة platform: backup-native.web.ts (stub).
 */
import { getDb, setDbEngineForTesting } from '@/db/client';
import { SCHEMA_VERSION } from '@/db/migrate';
import { getCurrentUserId } from '@/domain/session-user';
import { createBackup } from './backup';

function bytesToBase64Local(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
export async function restoreNative(bytes: Uint8Array): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const SQLite = await import('expo-sqlite');

  // قاعدة مؤقتة للفحص من ملف فعلي
  const tmpName = 'finacc-restore-tmp.db';
  const tmpPath = `${FileSystem.documentDirectory}SQLite/${tmpName}`;
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}SQLite/`, { intermediates: true });
  await FileSystem.writeAsStringAsync(tmpPath, bytesToBase64Local(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  const tmp = await SQLite.openDatabaseAsync(tmpName);
  try {
    const rows = await tmp.getAllAsync<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM _migrations');
    const version = Number(rows[0]?.v ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `نسخة بإصدار مخطط أحدث (${version}) من المدعوم (${SCHEMA_VERSION}) — حدّث التطبيق أولاً ثم استعِد`,
      );
    }
    // تسجيل حدث الاستعادة داخل النسخة نفسها (سجل القاعدة الحالية سيُستبدل)
    await tmp.runAsync(
      'INSERT INTO audit_log(user_id, action, entity, details, at) VALUES(?, ?, ?, ?, ?)',
      [
        getCurrentUserId(),
        'restore_backup',
        'backup',
        JSON.stringify({ schemaVersion: version }),
        new Date().toISOString(),
      ],
    );
  } finally {
    await tmp.closeAsync();
  }

  await createBackup('pre_restore'); // نسخة أمان قبل الاستبدال (FR-11-02)

  const engine = await getDb();
  await engine.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  await engine.close?.();
  const mainPath = `${FileSystem.documentDirectory}SQLite/finacc.db`;
  await FileSystem.deleteAsync(`${mainPath}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${mainPath}-shm`, { idempotent: true });
  await FileSystem.moveAsync({ from: tmpPath, to: mainPath });

  // القاعدة القديمة في الذاكرة أُغلقت — أعد تهيئة الاتصال على الملف الجديد،
  // والحالة المنطقية في الذاكرة قديمة لذا يلزم إعادة تشغيل التطبيق (يُخبر به المستخدم).
  setDbEngineForTesting(null);
}

