import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import {
  MissingRateError,
  getRateSnapshot,
  setDailyRate,
  getLatestRate,
  listActiveCurrencies,
  getBaseCurrency,
  convertToBase,
} from '@/domain/currency';
import { setSetting } from '@/domain/settings';
import { dec } from '@/utils/money';

/**
 * اختبارات العملات (قرار 3 + قرار 8 / FR-08):
 * السعر المفقود يمنع الحفظ إلا مع fx.fallback=last_known، Snapshot بالتاريخ،
 * UPSERT على (currency_id, rate_date)، ورفض الأسعار غير الموجبة.
 */

beforeAll(async () => {
  await createTestDb();
  const db = await getDb();
  await db.run("INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES('YER', 'ريال يمني', 1, 0, 1)");
  await db.run("INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES('SAR', 'ريال سعودي', 0, 2, 1)");
  await db.run("INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES('USD', 'دولار أمريكي', 0, 2, 1)");
  await db.run("INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES('OLD', 'عملة موقوفة', 0, 2, 0)");
});

afterAll(() => {
  disposeTestDb();
});

describe('currency: العملة الأساسية', () => {
  test('rate = 1 دائماً وبلا fallback — حتى بلا أي صفوف أسعار', async () => {
    const snap = await getRateSnapshot(1, '2030-01-01');
    expect(snap.rate).toBe('1');
    expect(snap.rateIsFallback).toBe(false);
  });

  test('getBaseCurrency تعيد اليمني', async () => {
    const base = await getBaseCurrency();
    expect(base.code).toBe('YER');
    expect(base.is_base).toBe(1);
    expect(base.decimals).toBe(0);
  });
});

describe('currency: سياسة السعر المفقود (قرار 3)', () => {
  test('لا سعر للتاريخ والافتراضي off → MissingRateError بمعرف العملة والتاريخ', async () => {
    let err: unknown = null;
    try {
      await getRateSnapshot(2, '2030-06-01');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingRateError);
    expect(err instanceof MissingRateError && err.currencyId).toBe(2);
    expect(err instanceof MissingRateError && err.date).toBe('2030-06-01');
    expect(err instanceof Error && err.message).toContain('لا يوجد سعر صرف');
  });

  test('عملة غير موجودة أصلاً → خطأ عربي واضح', async () => {
    let msg = '';
    try {
      await getRateSnapshot(999, '2030-06-01');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('عملة غير موجودة');
  });
});

describe('currency: setDailyRate + Snapshot', () => {
  test('إدخال سعر يوم ثم قراءته Snapshot مطابقاً', async () => {
    await setDailyRate(2, '2030-05-01', '250');
    const snap = await getRateSnapshot(2, '2030-05-01');
    expect(snap.rate).toBe('250');
    expect(snap.rateIsFallback).toBe(false);
  });

  test('UPSERT: نفس اليوم يحدّث ولا يكرر (UNIQUE currency_id, rate_date)', async () => {
    await setDailyRate(2, '2030-05-01', '255.5');
    const db = await getDb();
    const rows = await db.all<{ c: number }>(
      'SELECT count(*) AS c FROM exchange_rate WHERE currency_id = 2 AND rate_date = ?',
      ['2030-05-01'],
    );
    expect(rows[0]?.c ?? -1).toBe(1);
    const snap = await getRateSnapshot(2, '2030-05-01');
    expect(snap.rate).toBe('255.5');
  });

  test('أسعار أيام مختلفة تُخزن كسجل تاريخي كامل (FR-08-03)', async () => {
    await setDailyRate(2, '2030-05-02', '260');
    const db = await getDb();
    const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM exchange_rate WHERE currency_id = 2');
    expect(rows[0]?.c ?? -1).toBe(2);
  });

  test('رفض صفر/سالب/غير رقمي (zod)', async () => {
    await expect(setDailyRate(2, '2030-05-03', '0')).rejects.toThrow();
    await expect(setDailyRate(2, '2030-05-03', '-5')).rejects.toThrow();
    await expect(setDailyRate(2, '2030-05-03', 'abc')).rejects.toThrow();
    let msg = '';
    try {
      await setDailyRate(2, '2030-05-03', '0');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('أكبر من صفر');
  });

  test('قيد تدقيق fx_edit لكل تعديل سعر (FR-12-04)', async () => {
    const db = await getDb();
    const rows = await db.all<{ c: number }>("SELECT count(*) AS c FROM audit_log WHERE action = 'fx_edit'");
    expect(rows[0]?.c ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('currency: fx.fallback = last_known (قرار 3)', () => {
  test('تفعيله → آخر سعر معروف (حتى التاريخ) مع rateIsFallback=true', async () => {
    await setSetting('fx.fallback', 'last_known');
    const snap = await getRateSnapshot(2, '2030-06-15');
    expect(snap.rate).toBe('260'); // آخر سعر ≤ التاريخ
    expect(snap.rateIsFallback).toBe(true);
  });

  test('لا يوجد أي سعر بتاتاً → MissingRateError حتى مع last_known', async () => {
    let err: unknown = null;
    try {
      await getRateSnapshot(3, '2030-06-15'); // USD بلا أسعار
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingRateError);
  });

  test('إرجاعه إلى off يعيد المنع', async () => {
    await setSetting('fx.fallback', 'off');
    let err: unknown = null;
    try {
      await getRateSnapshot(2, '2030-07-01');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingRateError);
  });
});

describe('currency: getLatestRate', () => {
  test('آخر سعر معروف أو null', async () => {
    expect(await getLatestRate(2)).toBe('260');
    expect(await getLatestRate(3)).toBeNull();
    await setDailyRate(2, '2030-07-10', '270');
    expect(await getLatestRate(2)).toBe('270');
  });
});

describe('currency: listActiveCurrencies + convertToBase', () => {
  test('العملات المفعلة فقط، الأساسية أولاً', async () => {
    const list = await listActiveCurrencies();
    expect(list).toHaveLength(3); // YER + SAR + USD (OLD موقوفة)
    expect(list[0]?.code).toBe('YER');
    const codes = list.map((c) => c.code);
    expect(codes).toContain('SAR');
    expect(codes).not.toContain('OLD');
  });

  test('convertToBase = amount × rate', async () => {
    expect(convertToBase(dec('100'), dec('250')).toString()).toBe('25000');
    expect(convertToBase(dec('0'), dec('250')).isZero()).toBe(true);
  });

  test('العملة الأساسية لا تتأثر بـ last_known حتى مع تفعيله', async () => {
    await setSetting('fx.fallback', 'last_known');
    const snap = await getRateSnapshot(1, '2031-01-01');
    expect(snap.rate).toBe('1');
    expect(snap.rateIsFallback).toBe(false);
    await setSetting('fx.fallback', 'off');
  });
});
