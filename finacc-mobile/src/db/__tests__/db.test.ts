import { createTestDb, disposeTestDb } from '../test-db';
import { getDb } from '../client';

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  disposeTestDb();
});

describe('الهجرة 0001 + محرك sql.js', () => {
  test('أنشأت 30+ جداول في القاعدة', async () => {
    const db = await getDb();
    const rows = await db.all<{ c: number }>("SELECT count(*) AS c FROM sqlite_master WHERE type='table'");
    expect(rows[0]?.c ?? 0).toBeGreaterThanOrEqual(30);
  });

  test('audit_log محمي بـ triggers (append-only)', async () => {
    const db = await getDb();
    await db.run(
      'INSERT INTO audit_log(user_id, action, entity, entity_id, details, at) VALUES(NULL, ?, NULL, NULL, NULL, ?)',
      ['probe', '2026-01-01T00:00:00.000Z'],
    );
    const inserted = await db.all<{ c: number }>('SELECT count(*) AS c FROM audit_log');
    expect(inserted[0]?.c ?? 0).toBe(1);

    let updateBlocked = false;
    try {
      await db.run('UPDATE audit_log SET action = ? WHERE action = ?', ['hack', 'probe']);
    } catch (e) {
      updateBlocked = e instanceof Error && e.message.includes('append-only');
    }
    expect(updateBlocked).toBe(true);

    let deleteBlocked = false;
    try {
      await db.run('DELETE FROM audit_log');
    } catch (e) {
      deleteBlocked = e instanceof Error && e.message.includes('append-only');
    }
    expect(deleteBlocked).toBe(true);
  });

  test('إدراج عملة وقراءتها', async () => {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, ?, ?, ?)',
      ['YER', 'ريال يمني', 1, 0, 1],
    );
    expect(result.lastInsertRowId).toBe(1);
    const rows = await db.all<{ code: string; name: string; is_base: number }>(
      'SELECT code, name, is_base FROM currency WHERE id = ?',
      [1],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.code).toBe('YER');
    expect(rows[0]?.name).toBe('ريال يمني');
    expect(rows[0]?.is_base).toBe(1);
  });

  test('doc_sequence: UPSERT ذري — استهلاكان متتاليان يعطيان 1 ثم 2', async () => {
    const db = await getDb();
    const upsert =
      'INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, 1) ' +
      'ON CONFLICT(doc_type, year) DO UPDATE SET last_no = last_no + 1 ' +
      'RETURNING last_no';
    const first = await db.all<{ last_no: number }>(upsert, ['INV', 2026]);
    const second = await db.all<{ last_no: number }>(upsert, ['INV', 2026]);
    expect(first[0]?.last_no).toBe(1);
    expect(second[0]?.last_no).toBe(2);
  });

  test('المعاملات: ROLLBACK خارجي يلغي كل شيء', async () => {
    const db = await getDb();
    let failed = false;
    try {
      await db.transaction(async () => {
        await db.run(
          'INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, ?)',
          ['ROLLBK', 2026, 77],
        );
        throw new Error('فشل مقصود');
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    const rows = await db.all<{ c: number }>(
      'SELECT count(*) AS c FROM doc_sequence WHERE doc_type = ?',
      ['ROLLBK'],
    );
    expect(rows[0]?.c ?? -1).toBe(0);
  });

  test('المعاملات المتداخلة: فشل الداخلية لا يمس الخارجية (SAVEPOINT)', async () => {
    const db = await getDb();
    const value = await db.transaction(async () => {
      await db.run('INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, ?)', ['NEST', 2026, 100]);
      let innerFailed = false;
      try {
        await db.transaction(async () => {
          await db.run('UPDATE doc_sequence SET last_no = ? WHERE doc_type = ? AND year = ?', [200, 'NEST', 2026]);
          throw new Error('فشل الداخلية');
        });
      } catch {
        innerFailed = true;
      }
      expect(innerFailed).toBe(true);
      const rows = await db.all<{ last_no: number }>(
        'SELECT last_no FROM doc_sequence WHERE doc_type = ? AND year = ?',
        ['NEST', 2026],
      );
      return rows[0]?.last_no ?? -1;
    });
    expect(value).toBe(100);
  });

  test('الهجرة مسجلة في _migrations', async () => {
    const db = await getDb();
    const rows = await db.all<{ version: number }>('SELECT version FROM _migrations');
    expect(rows[0]?.version).toBe(1);
  });
});
