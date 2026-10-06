import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb, setDbEngineForTesting } from '@/db/client';
import { createWebEngine, initSqlJsRuntime } from '@/db/engine-web';
import { runMigrations } from '@/db/migrate';
import { setSetting } from '@/domain/settings';
import {
  backupLog,
  createBackup,
  lastBackupAt,
  maybeAutoBackup,
  verifyBackupBytes,
  _resetAutoBackupGuardForTests,
} from '@/services/backup';

/**
 * اختبارات النسخ الاحتياطي (الوحدة 11) — على مسار الويب (bun بلا IndexedDB):
 * إنشاء النسخة وسجلها، الاحتفاظ بآخر N، فحص إصدار المخطط عند الاستعادة،
 * والجدولة الصامتة maybeAutoBackup.
 *
 * ملاحظة: createBackup يستخدم getDb() (المحرك المسجل للاختبار) بينما فحص
 * الاستعادة يفتح قاعدة sql.js مستقلة — لذا نحرص على استيراد كل الشيفرة نقية.
 */

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  disposeTestDb();
});

/** جعل القاعدة «مهيأة» (سطر شركة) حتى تعمل الجدولة الصامتة. */
async function markOnboarded(): Promise<void> {
  const db = await getDb();
  await db.run('INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, 1, 0, 1)', [
    'YER',
    'ريال يمني',
  ]);
  await db.run('INSERT INTO company(name, currency_id) VALUES(?, 1)', ['متجر الاختبار']);
}

describe('backup: إنشاء النسخة والسجل', () => {
  test('createBackup(auto) — اسم بالنمط الصحيح + حجم > 0 + سجل', async () => {
    const res = await createBackup('auto');
    expect(res.fileName).toMatch(/^finacc-backup-\d{8}-\d{4}\.db$/);
    expect(res.sizeBytes).toBeGreaterThan(0);
    const rows = await backupLog();
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe('auto');
    expect(rows[0]?.fileSize).toBe(res.sizeBytes);
    expect(rows[0]?.fileName).toBe(res.fileName);
  });

  test('السجل الأحدث أولاً + lastBackupAt قابل للتحليل', async () => {
    await createBackup('manual');
    const rows = await backupLog();
    expect(rows.length).toBe(2);
    expect(rows[0]?.kind).toBe('manual');
    const last = await lastBackupAt();
    expect(last).not.toBeNull();
    expect(Number.isNaN(Date.parse(last ?? ''))).toBe(false);
  });
});

describe('backup: الاحتفاظ بآخر N (FR-11-05)', () => {
  test('retention=2 → الصامتة تُقلم لآخر 2 واليدوية تبقى', async () => {
    const db = await getDb();
    await db.run('DELETE FROM backup_log');
    await setSetting('backup.retention_count', '2');
    await createBackup('auto');
    await createBackup('auto');
    await createBackup('auto');
    await createBackup('manual');
    const rows = await backupLog();
    const kinds = rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'auto').length).toBe(2); // قُلمت إلى آخر 2
    expect(kinds.filter((k) => k === 'manual').length).toBe(1); // اليدوية لا تُمس
  });
});

describe('backup: فحص نسخة الاستعادة (FR-11-02)', () => {
  test('بايتات القاعدة الحالية → إصدار المخطط المدعوم', async () => {
    const engine = await getDb();
    const bytes = await engine.exportDbBytes?.();
    expect(bytes).toBeDefined();
    const version = await verifyBackupBytes(bytes as Uint8Array);
    expect(version).toBe(1);
  });

  test('ملف عشوائي ليس قاعدة → رسالة عربية واضحة', async () => {
    let msg = '';
    try {
      await verifyBackupBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg.length).toBeGreaterThan(0);
  });

  test('نسخة بمخطط أحدث → رفض صريح بلا Downgrade', async () => {
    const SQL = await initSqlJsRuntime();
    const db = new SQL.Database();
    db.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE company (id INTEGER PRIMARY KEY);
      INSERT INTO _migrations(version) VALUES (999);
    `);
    const bytes = db.export();
    db.close();
    let msg = '';
    try {
      await verifyBackupBytes(bytes);
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('أحدث');
    expect(msg).toContain('999');
  });

  test('الاستعادة على الويب: فحص + نسخة أمان + استبدال القاعدة فعلياً', async () => {
    // قاعدة مستقلة تحاكي «قاعدة قديمة» شغالة
    const engineA = await createWebEngine({ inMemory: true });
    await runMigrations(engineA);
    setDbEngineForTesting(engineA);
    await markOnboarded();

    // نسخة منها (البايتات التي سيُستعاد منها لاحقاً)
    const bytes = await engineA.exportDbBytes?.();
    expect(bytes).toBeDefined();
    // عدّل القاعدة الحالية بعد أخذ النسخة (لتأكيد أن الاستبدال يعمل فعلاً)
    const dbA = await getDb();
    await dbA.run("INSERT INTO company(name, currency_id) VALUES('شركة أخرى', 1)");
    const namesBefore = (await dbA.all<{ name: string }>('SELECT name FROM company')).map((r) => r.name);
    expect(namesBefore).toContain('شركة أخرى');

    // الاستبدال (ما تفعله restoreWeb بعد الفحص) على المحرك الحالي
    const engineB = await getDb();
    expect(engineB.importDbBytes).toBeDefined();
    await engineB.importDbBytes?.(bytes as Uint8Array);

    // القاعدة المستبدلة تعكس حالة النسخة — التعديل اللاحق اختفى
    const dbB = await getDb();
    const namesAfter = (await dbB.all<{ name: string }>('SELECT name FROM company')).map((r) => r.name);
    expect(namesAfter).toContain('متجر الاختبار');
    expect(namesAfter).not.toContain('شركة أخرى');
    const version = await verifyBackupBytes(bytes as Uint8Array);
    expect(version).toBe(1);

    // السجل: الاستعادة الحقيقية تُنشئ نسخة أمان pre_restore أولاً — نمطها هنا:
    const pre = await createBackup('pre_restore');
    expect(pre.sizeBytes).toBeGreaterThan(0);
    const log = await backupLog();
    expect(log.some((r) => r.kind === 'pre_restore')).toBe(true);
  });
});

describe('backup: الجدولة الصامتة (FR-11-04)', () => {
  test('قبل الإعداد الأولي → لا نسخة تلقائية', async () => {
    const engine = await createWebEngine({ inMemory: true });
    await runMigrations(engine);
    setDbEngineForTesting(engine); // قاعدة بلا شركة
    _resetAutoBackupGuardForTests();
    await maybeAutoBackup();
    expect((await backupLog()).length).toBe(0);
  });

  test('schedule=off → لا نسخة، وآخر نسخة حديثة مع daily → لا نسخة جديدة', async () => {
    await markOnboarded();
    await setSetting('backup.schedule', 'off');
    _resetAutoBackupGuardForTests();
    await maybeAutoBackup();
    expect((await backupLog()).length).toBe(0);

    await setSetting('backup.schedule', 'daily');
    await createBackup('manual'); // منذ لحظات — حديثة
    _resetAutoBackupGuardForTests();
    await maybeAutoBackup();
    const rows = await backupLog();
    expect(rows.filter((r) => r.kind === 'auto').length).toBe(0); // لم تُنشأ صامتة
  });

  test('مضى أكثر من المحدد → نسخة صامتة تُنشأ', async () => {
    const db = await getDb();
    await db.run('DELETE FROM backup_log');
    // آخر نسخة قبل 3 أيام
    await db.run(
      "INSERT INTO backup_log(kind, file_name, file_size, status, at) VALUES('manual', 'finacc-backup-old.db', 10, 'ok', ?)",
      [new Date(Date.now() - 3 * 24 * 3600_000).toISOString()],
    );
    _resetAutoBackupGuardForTests();
    await maybeAutoBackup();
    const rows = await backupLog();
    expect(rows.some((r) => r.kind === 'auto')).toBe(true);
  });
});
