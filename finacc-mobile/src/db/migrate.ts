import type { DbEngine } from './types';
import { migration as migration0001 } from './migrations/0001_init';

/**
 * مشغّل الهجرات:
 * - ينشئ _migrations إن لم تكن موجودة.
 * - يطبق الهجرات الناقصة (كل هجرة داخل transaction خاصة بها).
 * - يرفض الاستعادة من نسخة أحدث (لا Downgrade — SRS §3.3).
 */

interface MigrationFile {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: MigrationFile[] = [migration0001];

const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT);`;

/** أعلى إصدار مخطط يعرفه هذا التطبيق — يُقارن به عند استعادة النسخ (FR-11-02). */
export const SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export async function runMigrations(engine: DbEngine): Promise<void> {
  await engine.exec(MIGRATIONS_TABLE_DDL);
  const applied = await engine.all<{ version: number }>('SELECT version FROM _migrations');
  const appliedSet = new Set(applied.map((row) => row.version));

  const maxKnown = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
  for (const version of appliedSet) {
    if (version > maxKnown) {
      throw new Error(
        `قاعدة البيانات بإصدار مخطط ${version} أحدث من المدعوم (${maxKnown}) — الاستعادة من نسخة أحدث مرفوضة`,
      );
    }
  }

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue;
    await engine.transaction(async () => {
      await engine.exec(m.up);
      await engine.run('INSERT INTO _migrations(version, applied_at) VALUES(?, ?)', [
        m.version,
        new Date().toISOString(),
      ]);
    });
  }
}
