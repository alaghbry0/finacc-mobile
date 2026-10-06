import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createSaleReturn, createPurchaseReturn, returnableLines, getReturnContext, listReturnsFor } from '@/domain/returns';
import { savePurchaseInvoice, getPurchaseInvoice } from '@/domain/purchasing';
import { createProduct } from '@/domain/inventory';
import { createCustomer, createSupplier, customerBalances, supplierBalances } from '@/domain/parties';
import { setCurrentUserId } from '@/domain/session-user';
import { nextDocNumber } from '@/domain/docseq';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';

/**
 * اختبارات المرتجعات المرتبطة (FR-02-07 / FR-02-08 / AC-21 / AC-02) — Task 4-b:
 * - مرتجع بيع كامل آجل: الكمية عادت بتكلفة line_cost الأصلية + رصيد العميل نقص +
 *   صافي الحالتين = الحالة قبل البيع.
 * - الرفض: كمية أكبر من المتبقي (برسالة تسمّي المتبقي) / فاتورة ملغاة / مسودة.
 * - مرتجعات جزئية متتالية لا تتجاوز المتبقي.
 * - مرتجع نقدي: cash_tx payment خارج من الصندوق.
 * - مرتجع شراء: يخرج بسعر الأصل (Snapshot) + WAC المتبقي صحيح + رصيد المورد نقص.
 *
 * ملاحظة: فواتير البيع الأصلية تُزرع هنا بمساعد داخلي يطابق ما ستكتبه وحدة البيع
 * (4-a: invoice + items بـ line_cost + حركة 'sale' سالبة بالـ WAC الجاري) — لأن
 * createSaleReturn يقرأ الجداول مباشرة فهو مستقل عن تنفيذ شاشة البيع.
 */

const YEAR = todayISO().slice(0, 4);

let baseId = 0;
let warehouseId = 0;
let cashboxId = 0;
let customerId = 0;
let supplierId = 0;
let milkId = 0; // تكلفته 100 وكميته 10 افتتاحياً
let sugarId = 0; // 10 @100 افتتاحياً — لاختبار WAC مرتجع الشراء
let svcId = 0;

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر اختبار المرتجعات',
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

  customerId = await createCustomer({ name: 'عميل تجريبي' });
  supplierId = await createSupplier({ name: 'مورد المرتجعات' });

  milkId = await createProduct({
    name: 'حليب',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '150' }],
    openingQty: '10',
    openingWarehouseId: warehouseId,
    openingCost: '100',
  });
  sugarId = await createProduct({
    name: 'سكر',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '140' }],
    openingQty: '10',
    openingWarehouseId: warehouseId,
    openingCost: '100',
  });
  svcId = await createProduct({
    name: 'خدمة توصيل',
    isService: true,
    prices: [{ currencyId: baseId, price: '60' }],
  });
});

afterAll(() => {
  disposeTestDb();
  setCurrentUserId(null); // نظافة حالة الجلسة المشتركة بين ملفات bun test
});

// ============ أدوات مساعدة ============

/** زرع فاتورة بيع مكتملة كما تكتبها وحدة البيع (4-a): خصم مخزون بالـ WAC الجاري + line_cost. */
async function insertSaleInvoice(opts: {
  productId: number;
  qty: string;
  unitPrice: string;
  payStatus: 'cash' | 'credit';
  discountAmount?: string;
}): Promise<{ invoiceId: number; itemId: number; total: string }> {
  const db = await getDb();
  const { docNo } = await nextDocNumber('INV');
  const qty = dec(opts.qty);
  const gross = qty.times(dec(opts.unitPrice));
  const lineNet = gross; // بلا خصم بند
  const disc = dec(opts.discountAmount ?? '0');
  const total = lineNet.minus(disc); // ضريبة 0%
  const prod = await db.all<{ cost_price: string }>('SELECT cost_price FROM product WHERE id = ?', [opts.productId]);
  const wac = dec(prod[0]!.cost_price);
  const lineCost = qty.times(wac);

  const invRes = await db.run(
    'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, customer_id, cashbox_id, warehouse_id, ' +
      'currency_id, exchange_rate, rate_is_fallback, subtotal, discount_amount, tax_rate, tax_amount, total, total_base, ' +
      'paid_amount, due_amount, cost_total, created_at) ' +
      "VALUES(?, 'sale', ?, 'completed', ?, ?, ?, ?, ?, 1, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)",
    [
      docNo,
      opts.payStatus,
      todayISO(),
      customerId,
      opts.payStatus === 'cash' ? cashboxId : null,
      warehouseId,
      baseId,
      moneyStr(lineNet),
      moneyStr(disc),
      moneyStr(total),
      moneyStr(total),
      opts.payStatus === 'cash' ? moneyStr(total) : '0',
      opts.payStatus === 'cash' ? '0' : moneyStr(total),
      moneyStr(lineCost),
      new Date().toISOString(),
    ],
  );
  const invoiceId = Number(invRes.lastInsertRowId);
  const itemRes = await db.run(
    'INSERT INTO invoice_item(invoice_id, product_id, qty, unit_price, discount_percent, discount_amount, tax_percent, line_total, line_cost, created_at) ' +
      'VALUES(?, ?, ?, ?, 0, 0, 0, ?, ?, ?)',
    [invoiceId, opts.productId, moneyStr(qty), opts.unitPrice, moneyStr(lineNet), moneyStr(lineCost), new Date().toISOString()],
  );
  await db.run(
    'INSERT INTO stock_movement(product_id, warehouse_id, movement_type, qty, unit_cost, ref_type, ref_id, moved_at, created_at) ' +
      "VALUES(?, ?, 'sale', ?, ?, 'invoice', ?, ?, ?)",
    [opts.productId, warehouseId, moneyStr(qty.neg()), moneyStr(wac), invoiceId, todayISO(), new Date().toISOString()],
  );
  await db.run(
    'UPDATE stock_level SET qty = qty - ? WHERE product_id = ? AND warehouse_id = ?',
    [moneyStr(qty), opts.productId, warehouseId],
  );
  return { invoiceId, itemId: Number(itemRes.lastInsertRowId), total: moneyStr(total) };
}

function moneyStr(v: ReturnType<typeof dec>): string {
  return v.toFixed(4);
}

async function stockOf(productId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ qty: string | number }>(
    'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId],
  );
  return rows.length === 0 ? '0' : String(rows[0]!.qty);
}

async function productCost(productId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ cost_price: string }>('SELECT cost_price FROM product WHERE id = ?', [productId]);
  return rows[0]!.cost_price;
}

async function customerBalanceBase(): Promise<string> {
  const bals = await customerBalances(customerId);
  return bals.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

async function supplierBalanceBase(): Promise<string> {
  const bals = await supplierBalances(supplierId);
  return bals.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

async function boxBalance(): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ b: string | number }>(
    "SELECT COALESCE(SUM(CASE WHEN tx_type = 'receipt' THEN amount ELSE -amount END), 0) AS b " +
      'FROM cash_tx WHERE is_voided = 0',
  );
  return String(rows[0]?.b ?? '0');
}

// ============ مرتجع البيع (FR-02-07 / AC-02) ============

test('AC-02: مرتجع بيع كامل آجل — الكمية عادت بتكلفة line_cost الأصلية والرصيد نقص وصافي الحالتين = قبل البيع', async () => {
  const stockBefore = await stockOf(milkId);
  const costBefore = await productCost(milkId);
  const balBefore = await customerBalanceBase();

  // بيع آجل 3 @150 (WAC وقتها = 100)
  const sale = await insertSaleInvoice({ productId: milkId, qty: '3', unitPrice: '150', payStatus: 'credit' });
  expect(await stockOf(milkId)).toBe('7');
  expect(await customerBalanceBase()).toBe('450');

  // مرتجع كامل باتجاه «خصم من حساب العميل»
  const ret = await createSaleReturn({
    originalInvoiceId: sale.invoiceId,
    lines: [{ itemId: sale.itemId, qty: '3' }],
    direction: 'account',
    reason: 'اختبار مرتجع كامل',
  });
  expect(ret.invoiceNo).toBe(`SRN-${YEAR}-00001`);
  expect(ret.total).toBe('450');

  // الكمية عادت + بتكلفة line_cost الأصلية (لا WAC الجاري)
  expect(await stockOf(milkId)).toBe(stockBefore);
  const db = await getDb();
  const moves = await db.all<{ qty: string; unit_cost: string }>(
    "SELECT qty, unit_cost FROM stock_movement WHERE movement_type = 'sale_return' AND ref_id = ?",
    [ret.invoiceId],
  );
  expect(moves).toHaveLength(1);
  expect(dec(moves[0]!.qty).toNumber()).toBe(3);
  expect(dec(moves[0]!.unit_cost).toDecimalPlaces(4).toString()).toBe('100');

  // رصيد العميل نقص للمبلغ — صافي الحالتين = قبل البيع
  expect(await customerBalanceBase()).toBe(balBefore);
  // التكلفة المرجحة لم تتغير بمرتجع البيع (FR-02-07: لا WAC الجاري)
  expect(await productCost(milkId)).toBe(costBefore);
});

test('AC-21: رفض مرتجع بكمية أكبر من المباع — برسالة تسمّي الصنف والمتبقي', async () => {
  const sale = await insertSaleInvoice({ productId: milkId, qty: '3', unitPrice: '150', payStatus: 'credit' });
  await expect(
    createSaleReturn({
      originalInvoiceId: sale.invoiceId,
      lines: [{ itemId: sale.itemId, qty: '5' }],
      direction: 'account',
    }),
  ).rejects.toThrow('المتبقي القابل للإرجاع (3)');
});

test('رفض المرتجع على فاتورة ملغاة (AC-21)', async () => {
  const sale = await insertSaleInvoice({ productId: milkId, qty: '1', unitPrice: '150', payStatus: 'cash' });
  const db = await getDb();
  await db.run("UPDATE invoice SET status = 'void' WHERE id = ?", [sale.invoiceId]);
  await expect(
    createSaleReturn({
      originalInvoiceId: sale.invoiceId,
      lines: [{ itemId: sale.itemId, qty: '1' }],
      direction: 'cash',
    }),
  ).rejects.toThrow('ملغاة');
});

test('مرتجعات جزئية متتالية: 4 ثم 4 ثم رفض الثالثة (المتبقي 2)', async () => {
  // منتج مستقل لضبط الكميات بدقة 10 مباع
  const pid = await createProduct({
    name: 'منتج المرتجعات الجزئية',
    costPrice: '20',
    prices: [{ currencyId: baseId, price: '25' }],
    openingQty: '10',
    openingWarehouseId: warehouseId,
    openingCost: '20',
  });
  const sale = await insertSaleInvoice({ productId: pid, qty: '10', unitPrice: '10', payStatus: 'credit' });
  const lines = await returnableLines(sale.invoiceId);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.returnable).toBe('10');

  await createSaleReturn({
    originalInvoiceId: sale.invoiceId,
    lines: [{ itemId: sale.itemId, qty: '4' }],
    direction: 'account',
  });
  await createSaleReturn({
    originalInvoiceId: sale.invoiceId,
    lines: [{ itemId: sale.itemId, qty: '4' }],
    direction: 'account',
  });

  const after = await returnableLines(sale.invoiceId);
  expect(after[0]!.qtyReturned).toBe('8');
  expect(after[0]!.returnable).toBe('2');

  await expect(
    createSaleReturn({
      originalInvoiceId: sale.invoiceId,
      lines: [{ itemId: sale.itemId, qty: '3' }],
      direction: 'account',
    }),
  ).rejects.toThrow('المتبقي القابل للإرجاع (2)');
});

test('مرتجع بيع نقدي اتجاهه cash: cash_tx payment خارج من الصندوق', async () => {
  const before = await boxBalance();
  const sale = await insertSaleInvoice({ productId: milkId, qty: '2', unitPrice: '150', payStatus: 'cash' });
  const ret = await createSaleReturn({
    originalInvoiceId: sale.invoiceId,
    lines: [{ itemId: sale.itemId, qty: '2' }],
    direction: 'cash',
    cashboxId,
  });
  // 300 خرجت من الصندوق للعميل
  expect(dec(await boxBalance()).minus(dec(before)).toNumber()).toBe(-300);

  const db = await getDb();
  const txs = await db.all<{ tx_type: string; amount: string; ref_type: string }>(
    "SELECT tx_type, amount, ref_type FROM cash_tx WHERE ref_id = ?",
    [ret.invoiceId],
  );
  expect(txs).toHaveLength(1);
  expect(txs[0]!.tx_type).toBe('payment');
  expect(dec(txs[0]!.amount).toNumber()).toBe(300);
  expect(txs[0]!.ref_type).toBe('sale_return');

  // فاتورة المرتجع مدفوعة بالكامل ولا دين على العميل
  const row = await getDb();
  const inv = await row.all<{ paid_amount: string; due_amount: string; cashbox_id: number }>(
    'SELECT paid_amount, due_amount, cashbox_id FROM invoice WHERE id = ?',
    [ret.invoiceId],
  );
  expect(dec(inv[0]!.paid_amount).toNumber()).toBe(300);
  expect(dec(inv[0]!.due_amount).toNumber()).toBe(0);
  expect(Number(inv[0]!.cashbox_id)).toBe(cashboxId);
});

test('مرتجع صنف خدمي: بلا حركة مخزون', async () => {
  const db = await getDb();
  const { docNo } = await nextDocNumber('INV');
  const invRes = await db.run(
    'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, customer_id, warehouse_id, currency_id, exchange_rate, subtotal, total, paid_amount, due_amount, cost_total, created_at) ' +
      "VALUES(?, 'sale', 'credit', 'completed', ?, ?, ?, ?, 1, 60, 60, 0, 60, 0, ?)",
    [docNo, todayISO(), customerId, warehouseId, baseId, new Date().toISOString()],
  );
  const itemRes = await db.run(
    'INSERT INTO invoice_item(invoice_id, product_id, qty, unit_price, line_total, line_cost, created_at) VALUES(?, ?, 1, 60, 60, 0, ?)',
    [Number(invRes.lastInsertRowId), svcId, new Date().toISOString()],
  );
  const ret = await createSaleReturn({
    originalInvoiceId: Number(invRes.lastInsertRowId),
    lines: [{ itemId: Number(itemRes.lastInsertRowId), qty: '1' }],
    direction: 'account',
  });
  const moves = await db.all<{ c: number }>(
    "SELECT count(*) AS c FROM stock_movement WHERE ref_id = ?",
    [ret.invoiceId],
  );
  expect(Number(moves[0]!.c)).toBe(0);
  expect(ret.total).toBe('60');
});

// ============ مرتجع الشراء (FR-02-08) ============

test('مرتجع شراء account: يخرج بسعر الأصل (Snapshot) + WAC المتبقي صحيح + رصيد المورد نقص', async () => {
  // سكر: 10 @100. شراء 10 @120 → WAC = 110، الكمية 20
  const pur = await savePurchaseInvoice({
    items: [{ productId: sugarId, qty: '10', unitPrice: '120' }],
    payType: 'credit',
    supplierId,
    warehouseId,
    currencyId: baseId,
  });
  expect(dec(await productCost(sugarId)).toDecimalPlaces(4).toString()).toBe('110');
  expect(await stockOf(sugarId)).toBe('20');
  const balAfterPurchase = await supplierBalanceBase();

  // إرجاع 4 باتجاه «حساب المورد»
  const db = await getDb();
  const items = await db.all<{ id: number }>('SELECT id FROM invoice_item WHERE invoice_id = ?', [pur.invoiceId]);
  const ret = await createPurchaseReturn({
    originalInvoiceId: pur.invoiceId,
    lines: [{ itemId: Number(items[0]!.id), qty: '4' }],
    direction: 'account',
  });
  expect(ret.invoiceNo).toBe(`PRN-${YEAR}-00001`);
  expect(ret.total).toBe('480'); // 4 × 120

  // الكمية خرجت بسعر حركة الشراء الأصلية (Snapshot 120 لا WAC 110)
  const moves = await db.all<{ qty: string; unit_cost: string }>(
    "SELECT qty, unit_cost FROM stock_movement WHERE movement_type = 'purchase_return' AND ref_id = ?",
    [ret.invoiceId],
  );
  expect(moves).toHaveLength(1);
  expect(dec(moves[0]!.qty).toNumber()).toBe(-4);
  expect(dec(moves[0]!.unit_cost).toDecimalPlaces(4).toString()).toBe('120');

  // WAC المتبقي: (20×110 − 4×120)/16 = 107.5
  expect(dec(await productCost(sugarId)).toDecimalPlaces(4).toString()).toBe('107.5');
  expect(await stockOf(sugarId)).toBe('16');

  // رصيد المورد نقص بمبلغ المرتجع (معادلة parties — purchase_return.due)
  expect(dec(balAfterPurchase).minus(dec(await supplierBalanceBase())).toNumber()).toBe(480);

  // المرتجع يظهر في تفاصيل الأصل
  const detail = await getPurchaseInvoice(pur.invoiceId);
  expect(detail!.returns).toHaveLength(1);
  expect(detail!.returns[0]!.invoiceNo).toBe(`PRN-${YEAR}-00001`);
});

test('مرتجع شراء cash: receipt يدخل الصندوق', async () => {
  const before = await boxBalance();
  const pur = await savePurchaseInvoice({
    items: [{ productId: sugarId, qty: '2', unitPrice: '120' }],
    payType: 'cash',
    supplierId: null,
    cashboxId,
    warehouseId,
    currencyId: baseId,
  });
  const afterPurchase = await boxBalance();
  expect(dec(afterPurchase).minus(dec(before)).toNumber()).toBe(-240);

  const db = await getDb();
  const items = await db.all<{ id: number }>('SELECT id FROM invoice_item WHERE invoice_id = ?', [pur.invoiceId]);
  const ret = await createPurchaseReturn({
    originalInvoiceId: pur.invoiceId,
    lines: [{ itemId: Number(items[0]!.id), qty: '2' }],
    direction: 'cash',
    cashboxId,
  });
  expect(dec(await boxBalance()).minus(dec(afterPurchase)).toNumber()).toBe(240);

  const txs = await db.all<{ tx_type: string; amount: string }>(
    "SELECT tx_type, amount FROM cash_tx WHERE ref_id = ? AND ref_type = 'purchase_return'",
    [ret.invoiceId],
  );
  expect(txs).toHaveLength(1);
  expect(txs[0]!.tx_type).toBe('receipt');
  expect(dec(txs[0]!.amount).toNumber()).toBe(240);
});

test('رفض مرتجع شراء بكمية أكبر من المشترى + على فاتورة شراء بيع', async () => {
  const pur = await savePurchaseInvoice({
    items: [{ productId: sugarId, qty: '3', unitPrice: '100' }],
    payType: 'credit',
    supplierId,
    warehouseId,
    currencyId: baseId,
  });
  const db = await getDb();
  const items = await db.all<{ id: number }>('SELECT id FROM invoice_item WHERE invoice_id = ?', [pur.invoiceId]);

  await expect(
    createPurchaseReturn({
      originalInvoiceId: pur.invoiceId,
      lines: [{ itemId: Number(items[0]!.id), qty: '5' }],
      direction: 'account',
    }),
  ).rejects.toThrow('المتبقي القابل للإرجاع (3)');

  // فاتورة بيع لا تُرجع كمرتجع شراء
  const sale = await insertSaleInvoice({ productId: milkId, qty: '1', unitPrice: '150', payStatus: 'credit' });
  await expect(
    createPurchaseReturn({
      originalInvoiceId: sale.invoiceId,
      lines: [{ itemId: sale.itemId, qty: '1' }],
      direction: 'account',
    }),
  ).rejects.toThrow('ليس فاتورة شراء');
});

// ============ القراءة ============

test('getReturnContext: سياق الأصل لشاشة المرتجع', async () => {
  const sale = await insertSaleInvoice({ productId: milkId, qty: '1', unitPrice: '150', payStatus: 'credit' });
  const ctx = await getReturnContext(sale.invoiceId);
  expect(ctx).not.toBeNull();
  expect(ctx!.docType).toBe('sale');
  expect(ctx!.partyName).toBe('عميل تجريبي');
  expect(ctx!.currencyCode).toBe('YER');
  expect(ctx!.total).toBe('150');
  expect(ctx!.dueAmount).toBe('150');
});

test('returnableLines يعرض المباع والمرتجع والمتبقي مع خصم فاتورة الأصل pro-rata', async () => {
  const pid = await createProduct({
    name: 'منتج الخصم النسبي',
    costPrice: '30',
    prices: [{ currencyId: baseId, price: '100' }],
    openingQty: '10',
    openingWarehouseId: warehouseId,
    openingCost: '30',
  });
  const sale = await insertSaleInvoice({ productId: pid, qty: '10', unitPrice: '100', payStatus: 'credit', discountAmount: '200' });
  const db = await getDb();
  const items = await db.all<{ id: number }>('SELECT id FROM invoice_item WHERE invoice_id = ?', [sale.invoiceId]);
  const lines = await returnableLines(sale.invoiceId);
  expect(lines[0]!.returnable).toBe('10');

  const ret = await createSaleReturn({
    originalInvoiceId: sale.invoiceId,
    lines: [{ itemId: Number(items[0]!.id), qty: '4' }],
    direction: 'account',
  });
  // 4 من 10: الصافي 400 − حصة خصم 80 = 320
  expect(ret.total).toBe('320');

  const linked = await listReturnsFor(sale.invoiceId);
  expect(linked).toHaveLength(1);
  expect(linked[0]!.invoiceNo).toBe(ret.invoiceNo);
});
