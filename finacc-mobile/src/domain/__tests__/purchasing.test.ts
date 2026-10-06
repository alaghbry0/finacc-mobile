import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import {
  savePurchaseInvoice,
  voidPurchaseInvoice,
  listPurchaseInvoices,
  getPurchaseInvoice,
  type SavePurchaseInput,
} from '@/domain/purchasing';
import { createProduct } from '@/domain/inventory';
import { createSupplier, supplierBalances } from '@/domain/parties';
import { setCurrentUserId } from '@/domain/session-user';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';

/**
 * اختبارات وحدة الشراء (FR-02-08 + قاعدة WAC 5.4-3 + FR-02-15) — Task 4-b:
 * - AC-03: توزيع خصم رأس فاتورة الشراء pro-rata قبل تحديث WAC
 *   (أ) من صفر: شراء 10 @100 بخصم 10% → unit_cost_net=90 → WAC=90
 *   (ب) مزج: قديم 10@100 + شراء 10 بـ 90 → WAC=95 بدقة 4 منازل
 * - شراء آجل → رصيد المورد زاد؛ نقدي → الصندوق نقص + سند payment
 * - إلغاء (void): المخزون رجع + WAC عاد للقيمة القديمة + النقدية عُكست
 * - المسودة بلا رقم وبلا أثر
 */

const YEAR = todayISO().slice(0, 4);

let baseId = 0;
let warehouseId = 0;
let cashboxId = 0;
let supplierId = 0;
let productA = 0; // رصيد افتتاحي 10 @100
let productB = 0; // بلا رصيد
let serviceP = 0;

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر اختبار الشراء',
    baseCurrencyCode: 'YER',
    pinHash: 'pbkdf2$100000$dGVzdA$dGVzdA',
  });
  const db = await getDb();
  const currencies = await db.all<{ id: number; code: string }>('SELECT id, code FROM currency');
  baseId = Number(currencies.find((c) => c.code === 'YER')?.id ?? 0);
  const wh = await db.all<{ id: number }>('SELECT id FROM warehouse ORDER BY id LIMIT 1');
  warehouseId = Number(wh[0]!.id);
  const box = await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1');
  cashboxId = Number(box[0]!.id);

  supplierId = await createSupplier({ name: 'مورد تجريبي' });
  productA = await createProduct({
    name: 'منتج أ',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '150' }],
    openingQty: '10',
    openingWarehouseId: warehouseId,
    openingCost: '100',
  });
  productB = await createProduct({
    name: 'منتج ب',
    costPrice: '0',
    prices: [{ currencyId: baseId, price: '200' }],
  });
  serviceP = await createProduct({
    name: 'خدمة تركيب',
    isService: true,
    prices: [{ currencyId: baseId, price: '500' }],
  });
});

afterAll(() => {
  disposeTestDb();
  setCurrentUserId(null); // نظافة حالة الجلسة المشتركة بين ملفات bun test
});

// ============ أدوات مساعدة ============

async function productRow(id: number) {
  const db = await getDb();
  const rows = await db.all<{ cost_price: string; name: string }>(
    'SELECT cost_price, name FROM product WHERE id = ?',
    [id],
  );
  return rows[0]!;
}

async function stockOf(productId: number, warehouse: number): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ qty: string | number }>(
    'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouse],
  );
  return rows.length === 0 ? '0' : String(rows[0]!.qty);
}

/** رصيد الصندوق كما ستحسبه وحدة النقدية (قبض − صرف، غير الملغاة فقط). */
async function boxBalance(): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ b: string | number }>(
    "SELECT COALESCE(SUM(CASE WHEN tx_type = 'receipt' THEN amount ELSE -amount END), 0) AS b " +
      'FROM cash_tx WHERE is_voided = 0',
  );
  return String(rows[0]?.b ?? '0');
}

async function supplierBalanceBase(): Promise<string> {
  const bals = await supplierBalances(supplierId);
  return bals.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

function purchaseInput(over: Partial<SavePurchaseInput>): SavePurchaseInput {
  return {
    items: [],
    payType: 'credit',
    supplierId,
    warehouseId,
    currencyId: baseId,
    ...over,
  };
}

// ============ AC-03: توزيع خصم الفاتورة قبل WAC ============

test('AC-03(أ): شراء من صفر 10 @100 بخصم فاتورة 10% → WAC = 90 (لا 100)', async () => {
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productB, qty: '10', unitPrice: '100' }],
      invoiceDiscount: '100',
    }),
  );
  expect(res.invoiceNo).toBe(`PUR-${YEAR}-00001`);
  expect(res.total).toBe('900'); // 1000 − 100 خصم
  expect(res.dueAmount).toBe('900'); // آجل كامل

  // WAC = 90 (خصم الفاتورة وزِّع على البند قبل التحديث)
  const p = await productRow(productB);
  expect(dec(p.cost_price).toDecimalPlaces(4).toString()).toBe('90');
  expect(await stockOf(productB, warehouseId)).toBe('10');

  const db = await getDb();
  const moves = await db.all<{ qty: string; unit_cost: string }>(
    "SELECT qty, unit_cost FROM stock_movement WHERE product_id = ? AND movement_type = 'purchase'",
    [productB],
  );
  expect(moves).toHaveLength(1);
  expect(dec(moves[0]!.qty).toNumber()).toBe(10);
  expect(dec(moves[0]!.unit_cost).toDecimalPlaces(4).toString()).toBe('90');

  // invoice_item.line_cost = التكلفة الصافية للسطر (الموزَّع)
  const items = await db.all<{ line_cost: string }>(
    'SELECT line_cost FROM invoice_item WHERE invoice_id = ?',
    [res.invoiceId],
  );
  expect(dec(items[0]!.line_cost).toNumber()).toBe(900);

  // الشراء الآجل زاد رصيد المورد بالمجموع
  expect(dec(await supplierBalanceBase()).toNumber()).toBe(900);
});

test('AC-03(ب): مزج — قديم 10@100 + شراء 10 بـ 90 (بعد توزيع) → WAC = 95 بدقة 4 منازل', async () => {
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productA, qty: '10', unitPrice: '100' }],
      invoiceDiscount: '100',
    }),
  );
  expect(res.invoiceNo).toBe(`PUR-${YEAR}-00002`);

  const p = await productRow(productA);
  // (10×100 + 10×90) / 20 = 95
  expect(dec(p.cost_price).toDecimalPlaces(4).toString()).toBe('95');
  expect(await stockOf(productA, warehouseId)).toBe('20');

  // رصيد المورد: 900 + 900
  expect(dec(await supplierBalanceBase()).toNumber()).toBe(1800);
});

// ============ الدفع النقدي والمختلط ============

test('شراء نقدي: الصندوق نقص + سند payment مرتبط بالفاتورة بلا أثر على رصيد المورد', async () => {
  const before = await boxBalance();
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productB, qty: '5', unitPrice: '100' }],
      payType: 'cash',
      supplierId: null,
      cashboxId,
    }),
  );
  expect(res.dueAmount).toBe('0');
  expect(res.total).toBe('500');
  expect(dec(await boxBalance()).minus(dec(before)).toNumber()).toBe(-500);

  const db = await getDb();
  const txs = await db.all<{ tx_type: string; amount: string; supplier_id: number | null; is_voided: number }>(
    "SELECT tx_type, amount, supplier_id, is_voided FROM cash_tx WHERE ref_type = 'invoice' AND ref_id = ?",
    [res.invoiceId],
  );
  expect(txs).toHaveLength(1);
  expect(txs[0]!.tx_type).toBe('payment');
  expect(dec(txs[0]!.amount).toNumber()).toBe(500);
  expect(txs[0]!.supplier_id).toBeNull(); // قرار موثق: لا إسناد للمورد في الجزء الفوري

  // رصيد المورد لم يتغير (لم يُقيَّد AP أصلاً)
  expect(dec(await supplierBalanceBase()).toNumber()).toBe(1800);
});

test('شراء مختلط: جزء نقدي يخرج من الصندوق والباقي دين على المورد', async () => {
  const before = await boxBalance();
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productB, qty: '4', unitPrice: '100' }],
      payType: 'mixed',
      cashPart: '150',
      cashboxId,
    }),
  );
  expect(res.total).toBe('400');
  expect(res.dueAmount).toBe('250');
  expect(dec(await boxBalance()).minus(dec(before)).toNumber()).toBe(-150);
  // رصيد المورد: 1800 + 250
  expect(dec(await supplierBalanceBase()).toNumber()).toBe(2050);
});

// ============ المسودة (قرار 2) ============

test('مسودة الشراء: بلا رقم وبلا أثر مخزوني أو نقدي', async () => {
  const stockBefore = await stockOf(productB, warehouseId);
  const boxBefore = await boxBalance();
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productB, qty: '7', unitPrice: '100' }],
      payType: 'credit',
      saveAsDraft: true,
    }),
  );
  expect(res.invoiceNo).toBeNull();
  expect(res.dueAmount).toBe('0');
  expect(await stockOf(productB, warehouseId)).toBe(stockBefore);
  expect(await boxBalance()).toBe(boxBefore);

  const db = await getDb();
  const moves = await db.all<{ c: number }>(
    "SELECT count(*) AS c FROM stock_movement WHERE ref_type = 'invoice' AND ref_id = ?",
    [res.invoiceId],
  );
  expect(Number(moves[0]!.c)).toBe(0);

  const row = await getPurchaseInvoice(res.invoiceId);
  expect(row?.status).toBe('draft');
});

test('الصنف الخدمي في الشراء: بلا حركة مخزون مع إدراجه كبند', async () => {
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [
        { productId: productB, qty: '1', unitPrice: '50' },
        { productId: serviceP, qty: '1', unitPrice: '500' },
      ],
      payType: 'credit',
    }),
  );
  const db = await getDb();
  const moves = await db.all<{ c: number }>(
    "SELECT count(*) AS c FROM stock_movement WHERE ref_id = ? AND product_id = ?",
    [res.invoiceId, serviceP],
  );
  expect(Number(moves[0]!.c)).toBe(0);
  expect(res.total).toBe('550');
});

// ============ فحوصات الرفض ============

test('رفض: آجل بلا مورد / نقدي بلا صندوق / مختلط بلا جزء نقدي', async () => {
  await expect(
    savePurchaseInvoice(
      purchaseInput({
        items: [{ productId: productB, qty: '1', unitPrice: '10' }],
        payType: 'credit',
        supplierId: null,
      }),
    ),
  ).rejects.toThrow('تتطلب اختيار مورّد');

  await expect(
    savePurchaseInvoice(
      purchaseInput({
        items: [{ productId: productB, qty: '1', unitPrice: '10' }],
        payType: 'cash',
        cashboxId: null,
      }),
    ),
  ).rejects.toThrow('اختيار صندوق');

  await expect(
    savePurchaseInvoice(
      purchaseInput({
        items: [{ productId: productB, qty: '1', unitPrice: '10' }],
        payType: 'mixed',
        cashPart: undefined,
        cashboxId,
      }),
    ),
  ).rejects.toThrow('الجزء النقدي');
});

// ============ الإلغاء (FR-02-15) ============

test('void: المخزون رجع + WAC عاد للقيمة القديمة + النقدية عُكست + رفض تكرار الإلغاء', async () => {
  // الحالة: منتج أ = 20 @95 (بعد AC-03-ب). شراء نقدي جديد 10 @100 بخصم 100 → 90
  const before = await boxBalance();
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productA, qty: '10', unitPrice: '100' }],
      invoiceDiscount: '100',
      payType: 'cash',
      supplierId: null,
      cashboxId,
    }),
  );
  // WAC = (20×95 + 10×90)/30 = 2800/30 = 93.3333
  let p = await productRow(productA);
  expect(dec(p.cost_price).toDecimalPlaces(4).toString()).toBe('93.3333');
  expect(await stockOf(productA, warehouseId)).toBe('30');
  expect(dec(await boxBalance()).minus(dec(before)).toNumber()).toBe(-900);

  await voidPurchaseInvoice(res.invoiceId, { managerConfirmed: true, reason: 'اختبار إلغاء' });

  // المخزون رجع والـ WAC عاد للقيمة قبل الشراء (95)
  expect(await stockOf(productA, warehouseId)).toBe('20');
  p = await productRow(productA);
  expect(dec(p.cost_price).toDecimalPlaces(4).toString()).toBe('95');

  // النقدية عُكست (السند أُبطل)
  expect(await boxBalance()).toBe(before);
  const db = await getDb();
  const txs = await db.all<{ is_voided: number }>(
    "SELECT is_voided FROM cash_tx WHERE ref_type = 'invoice' AND ref_id = ?",
    [res.invoiceId],
  );
  expect(txs).toHaveLength(1);
  expect(Number(txs[0]!.is_voided)).toBe(1);

  // الفاتورة ظاهرة بحالة ملغاة والرقم لم يُعَد
  const row = await getPurchaseInvoice(res.invoiceId);
  expect(row?.status).toBe('void');
  expect(row?.invoiceNo).toBe(res.invoiceNo);

  await expect(voidPurchaseInvoice(res.invoiceId, { managerConfirmed: true })).rejects.toThrow('ملغاة مسبقاً');
  await expect(voidPurchaseInvoice(res.invoiceId, { managerConfirmed: false })).rejects.toThrow('تأكيد المدير');
});

test('void آجل: رصيد المورد رجع تلقائياً', async () => {
  const res = await savePurchaseInvoice(
    purchaseInput({
      items: [{ productId: productB, qty: '2', unitPrice: '100' }],
      payType: 'credit',
    }),
  );
  const balWith = await supplierBalanceBase();
  await voidPurchaseInvoice(res.invoiceId, { managerConfirmed: true });
  const balAfter = await supplierBalanceBase();
  expect(dec(balWith).minus(dec(balAfter)).toNumber()).toBe(200);
});

// ============ القوائم ============

test('listPurchaseInvoices: بالفلاتر وبالبنود وعدّادها', async () => {
  const all = await listPurchaseInvoices({});
  expect(all.length).toBeGreaterThanOrEqual(7);
  const completedOnly = await listPurchaseInvoices({ status: 'completed' });
  expect(completedOnly.every((r) => r.status === 'completed')).toBe(true);
  const drafts = await listPurchaseInvoices({ status: 'draft' });
  expect(drafts.every((r) => r.invoiceNo === null)).toBe(true);

  const first = all.find((r) => r.invoiceNo === `PUR-${YEAR}-00001`);
  expect(first).toBeDefined();
  expect(first!.supplierName).toBe('مورد تجريبي');
  expect(first!.currencyCode).toBe('YER');
  expect(first!.itemCount).toBe(1);

  const byNo = await listPurchaseInvoices({ q: `PUR-${YEAR}-00002` });
  expect(byNo).toHaveLength(1);
  expect(byNo[0]!.total).toBe('900');
});
