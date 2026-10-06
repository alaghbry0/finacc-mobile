import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import {
  assertPeriodOpen,
  assertBackdateAllowed,
  FiscalPeriodClosedError,
  BackdateConfirmationRequiredError,
} from '@/domain/fiscal';
import { setSetting } from '@/domain/settings';

/** تاريخ ISO محلي قبل n يوماً من اليوم. */
function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  disposeTestDb();
});

describe('fiscal: assertPeriodOpen (قاعدة 5.4-11)', () => {
  test('سنة مغلقة → FiscalPeriodClosedError برسالة عربية', async () => {
    const db = await getDb();
    await db.run(
      "INSERT INTO fiscal_year(year, start_date, end_date, status, created_at) VALUES(2026, '2026-01-01', '2026-12-31', 'closed', '2026-01-01T00:00:00.000Z')",
    );
    let err: unknown = null;
    try {
      await assertPeriodOpen('2026-06-15');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FiscalPeriodClosedError);
    expect(err instanceof FiscalPeriodClosedError && err.year).toBe(2026);
    expect(err instanceof FiscalPeriodClosedError && err.date).toBe('2026-06-15');
    expect(err instanceof Error && err.message).toContain('سنة مالية مقفلة');
  });

  test('سنة مفتوحة → تمر', async () => {
    const db = await getDb();
    await db.run(
      "INSERT INTO fiscal_year(year, start_date, end_date, status, created_at) VALUES(2027, '2027-01-01', '2027-12-31', 'open', '2027-01-01T00:00:00.000Z')",
    );
    await assertPeriodOpen('2027-03-03'); // لا يرمي شيئاً
  });

  test('تاريخ خارج أي سنة معرفة → يمر (بلا قيود)', async () => {
    await assertPeriodOpen('2028-05-05');
  });

  test('تاريخ بصيغة خاطئة → خطأ عربي', async () => {
    let msg = '';
    try {
      await assertPeriodOpen('2027/03/03');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('تاريخ غير صالح');
  });
});

describe('fiscal: assertBackdateAllowed (قرار 6)', () => {
  test('45 يوماً راجعة (الحد 30) بلا تأكيد → BackdateConfirmationRequiredError', async () => {
    const date = isoDaysAgo(45);
    let err: unknown = null;
    try {
      await assertBackdateAllowed(date);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BackdateConfirmationRequiredError);
    expect(err instanceof BackdateConfirmationRequiredError && err.daysBack).toBe(45);
    expect(err instanceof BackdateConfirmationRequiredError && err.limit).toBe(30);
    expect(err instanceof Error && err.message).toContain('تأكيد المدير');
  });

  test('نفس التاريخ مع managerConfirmed=true → يمر + قيد تدقيق backdate_confirmed', async () => {
    const db = await getDb();
    const date = isoDaysAgo(45);
    await assertBackdateAllowed(date, { managerConfirmed: true });
    const rows = await db.all<{ c: number }>("SELECT count(*) AS c FROM audit_log WHERE action = 'backdate_confirmed'");
    expect(rows[0]?.c ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('10 أيام راجعة → تمر مباشرة بلا تأكيد', async () => {
    await assertBackdateAllowed(isoDaysAgo(10));
  });

  test('تاريخ مستقبلي → يمر', async () => {
    await assertBackdateAllowed('2099-01-01');
  });

  test('رفع الحد إلى 60 → 45 يوماً تمر بلا تأكيد (إعداد dating.max_backdate_days)', async () => {
    await setSetting('dating.max_backdate_days', '60');
    await assertBackdateAllowed(isoDaysAgo(45));
    await setSetting('dating.max_backdate_days', '30');
  });

  test('31 يوماً راجعة بالحد 30 → ترفض (الحد شامل لا متجاوز)', async () => {
    let err: unknown = null;
    try {
      await assertBackdateAllowed(isoDaysAgo(31));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BackdateConfirmationRequiredError);
  });
});
