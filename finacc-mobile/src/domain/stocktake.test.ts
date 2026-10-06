import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { saveSaleInvoice } from '@/domain/invoicing';
import { setCurrentUserId } from '@/domain/session-user';
import { todayISO } from '@/utils/format';
import { profitLoss } from './reports/profit-loss';
import { money } from '@/utils/money';
import {
  applyStocktake,
  listStocktakes,
  setCountedLine,
  startStocktake,
  stocktakeLines,
} from './stocktake';

/**
 * اختبارات الجرد الفعلي (FR-01-08 + AC-04):
 * - زيادة ونقص بحركات بتكلفة لقطة وقت الجرد (لا WAC لاحق).
 * - منع الناقص برسالة تسمّي الصنف (قرار 9 — المنع المطلق للمخزون فقط).
 * - قفل الجرد بعد الاعتماد (status='completed' + رفض أي إعادة).
 * - أثر الزيادة/العجز في قائمة الأرباح (قرار 7: زيادة واردة والعجز خسارة).
 */

let baseId = 0;
let warehouseId = 0;
let cashboxId = 0;
let productId = 0;

const today = todayISO();

beforeAll(async () => {
  await createTestDb();
  setCurrentUserId(1);
  await completeOnboarding({
    companyName: 'متجر الجرد',
    baseCurrencyCode: 'YER',
    pinHash: 'pbkdf2$100000$dGVzdA$dGVzdA',
  });
  const db = await getDb();
  const cur = await db.all<{ id: number; code: string }>('SELECT id, code FROM currency');
  baseId = Number(cur.find((c) => c.code === 'YER')?.id ?? 0);
  warehouseId = Number((await db.all<{ id: number }>('SELECT id FROM warehouse ORDER BY id LIMIT 1'))[0]?.id ?? 0);
  cashboxId = Number((await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1'))[0]?.id ?? 0);

  productId = await createProduct({
    name: 'صنف الجرد',
    costPrice: '2',
    prices: [{ currencyId: baseId, price: '3' }],
    openingQty: '12',
  });
});

afterAll(() => {
  setCurrentUserId(null);
  disposeTestDb();
});

describe('stocktake: الجرد الفعلي (FR-01-08 + AC-04)', () => {
  test('جرد زيادة: 12 → 14 حركة +2 بتكلفة اللقطة 2 والرصيد يتحدث', async () => {
    const st = await startStocktake(warehouseId, 'جرد زيادة');
    let lines = await stocktakeLines(st);
    const row = lines.find((l) => l.productId === productId)!;
    expect(row.bookQty).toBe('12');
    expect(row.countedQty).toBeNull();
    expect(row.diffQty).toBeNull();
    expect(row.unitCost).toBe('2');

    await setCountedLine(st, productId, '14');
    lines = await stocktakeLines(st);
    expect(lines.find((l) => l.productId === productId)!.diffQty).toBe('2');

    const res = await applyStocktake(st, {});
    expect(res.adjustments).toBe(1);

    const db = await getDb();
    const lvl = await db.all<{ qty: string | number }>('SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?', [productId, warehouseId]);
    expect(money(lvl[0]!.qty)).toBe('14');

    const mv = await db.all<{ movement_type: string; qty: string | number; unit_cost: string | number; ref_type: string; ref_id: number }>(
      "SELECT movement_type, qty, unit_cost, ref_type, ref_id FROM stock_movement WHERE movement_type = 'stocktake_adjust' AND ref_id = ?",
      [st],
    );
    expect(mv.length).toBe(1);
    expect(money(mv[0]!.qty)).toBe('2');
    expect(money(mv[0]!.unit_cost)).toBe('2'); // تكلفة اللقطة (AC-04)
    expect(mv[0]!.ref_type).toBe('stocktake');

    // الجرد مقفل: أي إعادة اعتماد تُرفض (AC-04: الجرد قفل الأرصدة)
    await expect(applyStocktake(st, {})).rejects.toThrow(/معتمد ومقفل/);
    await expect(setCountedLine(st, productId, '99')).rejects.toThrow(/معتمد ومقفل/);
  });

  test('جرد نقص: 14 → 13 حركة −1 ويدخل عجزاً في الأرباح', async () => {
    const st = await startStocktake(warehouseId);
    await setCountedLine(st, productId, '13');
    const res = await applyStocktake(st, {});
    expect(res.adjustments).toBe(1);

    const db = await getDb();
    const lvl = await db.all<{ qty: string | number }>('SELECT qty FROM stock_level WHERE product_id = ?', [productId]);
    expect(money(lvl[0]!.qty)).toBe('13');
    expect(res.adjustments).toBe(1);
  });

  test('جرد بلا فروق: لا حركات وadjustments=0', async () => {
    const st = await startStocktake(warehouseId);
    await setCountedLine(st, productId, '13');
    const res = await applyStocktake(st, {});
    expect(res.adjustments).toBe(0);
  });

  test('رفض جرد ينقص تحت الصفر: بيع بعد العدّ ثم الاعتماد يُرفض برسالة تسمّي الصنف', async () => {
    // الكتاب الدفتري الآن 13 — عُدَّ 5، ثم بِع 9 (الرصيد 4) → التسوية −8 تحت الصفر
    const st = await startStocktake(warehouseId);
    await setCountedLine(st, productId, '5');

    await saveSaleInvoice({
      items: [{ productId, qty: '9', unitPrice: '3' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
    });

    await expect(applyStocktake(st, {})).rejects.toThrow(/صنف الجرد.*سالب/);

    // الجرد ما يزال draft — يُصحح العدّ (هذه المرة مطابق للقطة الدفتري: النقص
    // كان هو البيع الذي جرى أثناء العدّ) فيُعتمد بلا تسويات
    await setCountedLine(st, productId, '13');
    const res = await applyStocktake(st, {});
    expect(res.adjustments).toBe(0); // لا فرق → لا حركات → الرصيد يبقى 4
  });

  test('رفض إدخال عدّ سالب مباشرة (لوحة الأرقام لا تسمح، والدومين يتأكد)', async () => {
    const st = await startStocktake(warehouseId);
    await expect(setCountedLine(st, productId, '-2')).rejects.toThrow(/كمية العدّ|سالب/);
  });

  test('أثر الجرد في الأرباح: زيادة 2×2=4 وعجز 1×2=2 (قرار 7)', async () => {
    const pl = await profitLoss({ dateFrom: today, dateTo: today });
    expect(pl.stocktakeGains).toBe('4');
    expect(pl.stocktakeLosses).toBe('2');
  });

  test('سجل الجرد: listStocktakes بالحركات والفروق الكلية', async () => {
    const rows = await listStocktakes();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const first = rows[0]!;
    expect(first.warehouseName.length).toBeGreaterThan(0);
    expect(['draft', 'completed']).toContain(first.status);
    // جرد الزيادة: سطر واحد وحركة واحدة وفرق كلي 2
    const gain = rows.find((r) => r.totalDiff === '2');
    expect(gain).toBeDefined();
    expect(gain!.adjustments).toBe(1);
    expect(gain!.lines).toBe(1);
    const loss = rows.find((r) => r.totalDiff === '-1');
    expect(loss).toBeDefined();
    expect(loss!.adjustments).toBe(1);
    // الفرق الكلي عبر كل السجل = 2 − 1 = 1
    const totalDiff = rows.reduce((acc, r) => acc + Number(r.totalDiff), 0);
    expect(totalDiff).toBe(1);
  });
});
