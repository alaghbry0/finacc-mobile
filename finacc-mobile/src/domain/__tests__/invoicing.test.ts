import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct, adjustStock } from '@/domain/inventory';
import { createCustomer, customerBalances } from '@/domain/parties';
import { setDailyRate, MissingRateError } from '@/domain/currency';
import { setSetting } from '@/domain/settings';
import { todayISO } from '@/utils/format';
import { dec } from '@/utils/money';
import {
  saveSaleInvoice,
  convertDraftToCompleted,
  voidInvoice,
  getSaleInvoice,
  listInvoices,
  StockShortageError,
  CreditLimitConfirmationRequiredError,
} from '../invoicing';

/**
 * اختبارات آلة حالات فاتورة البيع الملزمة (جدول 5.4-2 + FR-02):
 * كل انتقال باختبار مستقل — والحفظ الذرّي (قاعدة 5.4-4) يُختبر بالنقص
 * والمتوازي (100 فاتورة عبر Promise.all).
 *
 * ترتيب الاختبارات مقصود (قاعدة بيانات واحدة مشتركة لكل الملف):
 * المخزون يتناقص عبر السيناريوهات، والأرقام تُستهلك تسلسلياً.
 */

const YEAR = todayISO().slice(0, 4);

let baseId = 0;
let sarId = 0;
let usdId = 0;
let warehouseId = 0;
let cashboxId = 0;
let shampooId = 0;
let serviceId = 0;
let customerId = 0;

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر الاختبار',
    baseCurrencyCode: 'YER',
    pinHash: 'pbkdf2$100000$dGVzdA$dGVzdA',
  });
  const db = await getDb();
  const currencies = await db.all<{ id: number; code: string }>('SELECT id, code FROM currency');
  baseId = Number(currencies.find((c) => c.code === 'YER')?.id ?? 0);
  sarId = Number(currencies.find((c) => c.code === 'SAR')?.id ?? 0);
  usdId = Number(currencies.find((c) => c.code === 'USD')?.id ?? 0);
  const warehouse = await db.all<{ id: number }>('SELECT id FROM warehouse ORDER BY id LIMIT 1');
  warehouseId = Number(warehouse[0]?.id ?? 0);
  const cashbox = await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1');
  cashboxId = Number(cashbox[0]?.id ?? 0);

  // منتجان: «شامبو» تكلفة 100 وسعر 150 (رصيد 10) + «خدمة توصيل» خدمي
  shampooId = await createProduct({
    name: 'شامبو',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '150' }],
    openingQty: '10',
  });
  serviceId = await createProduct({
    name: 'خدمة توصيل',
    isService: true,
    prices: [{ currencyId: baseId, price: '1000' }],
  });
  customerId = await createCustomer({ name: 'أحمد سعيد' });
});

afterAll(() => {
  disposeTestDb();
});

// ============ مساعدات ============

async function stockOf(productId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ qty: string | number }>(
    'SELECT qty FROM stock_level WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId],
  );
  return String(rows[0]?.qty ?? 0);
}

async function invoiceRow(id: number) {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>('SELECT * FROM invoice WHERE id = ?', [id]);
  return rows[0];
}

async function movementsOf(invoiceId: number) {
  const db = await getDb();
  return db.all<{ id: number; movement_type: string; qty: string; unit_cost: string }>(
    "SELECT id, movement_type, qty, unit_cost FROM stock_movement WHERE ref_type = 'invoice' AND ref_id = ?",
    [invoiceId],
  );
}

async function cashTxOf(invoiceId: number) {
  const db = await getDb();
  return db.all<{
    id: number; tx_type: string; amount: string; is_voided: number; reversal_of: number | null; currency_id: number;
  }>(
    "SELECT id, tx_type, amount, is_voided, reversal_of, currency_id FROM cash_tx WHERE ref_type = 'invoice' AND ref_id = ?",
    [invoiceId],
  );
}

/**
 * رصيد الصندوق (قبض − صرف) بعملة الأساس.
 * الحركات المعاكسة (reversal_of) مستبعدة — هي سجل عكس لحركة ملغاة (is_voided=1)
 * والزوج معاً يترك أثراً صفرياً في الرصيد ويبقى في السجل للتدقيق.
 */
async function cashboxBalance(): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ t: string | number | null }>(
    "SELECT COALESCE(SUM(CASE WHEN tx_type = 'receipt' THEN amount ELSE -amount END), 0) AS t " +
      'FROM cash_tx WHERE cashbox_id = ? AND is_voided = 0 AND reversal_of IS NULL AND currency_id = ?',
    [cashboxId, baseId],
  );
  return String(rows[0]?.t ?? 0);
}

function baseSaleItems() {
  return [{ productId: shampooId, qty: '2', unitPrice: '150' }];
}

// ============ 1) حفظ نقدي ============

test('1) حفظ نقدي: رقم مستهلك + خصم مخزون + قبض + تخصيص + رصيد الصندوق', async () => {
  const r = await saveSaleInvoice({
    items: baseSaleItems(),
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: baseId,
  });

  expect(r.invoiceNo).toBe(`INV-${YEAR}-00001`);
  expect(r.payStatus).toBe('cash');
  expect(r.total).toBe('300');
  expect(r.dueAmount).toBe('0');

  const inv = await invoiceRow(r.invoiceId);
  expect(inv?.status).toBe('completed');
  expect(inv?.pay_status).toBe('cash');
  expect(String(inv?.paid_amount)).toBe('300');
  expect(String(inv?.due_amount)).toBe('0');
  expect(String(inv?.total_base)).toBe('300');
  expect(String(inv?.cost_total)).toBe('200'); // 2 × تكلفة 100

  // المخزون نقص: 10 − 2 = 8
  expect(await stockOf(shampooId)).toBe('8');

  // حركة مخزون sale بكمية سالبة وتكلفة اللقطة
  const moves = await movementsOf(r.invoiceId);
  expect(moves.length).toBe(1);
  expect(moves[0]?.movement_type).toBe('sale');
  expect(String(moves[0]?.qty)).toBe('-2');
  expect(String(moves[0]?.unit_cost)).toBe('100');

  // قبض في الصندوق + تخصيص كامل
  const txs = await cashTxOf(r.invoiceId);
  expect(txs.length).toBe(1);
  expect(txs[0]?.tx_type).toBe('receipt');
  expect(String(txs[0]?.amount)).toBe('300');
  expect(Number(txs[0]?.is_voided)).toBe(0);
  const db = await getDb();
  const alloc = await db.all<{ allocated_amount: string }>(
    'SELECT allocated_amount FROM payment_allocation WHERE invoice_id = ?',
    [r.invoiceId],
  );
  expect(alloc.length).toBe(1);
  expect(String(alloc[0]?.allocated_amount)).toBe('300');

  // رصيد الصندوق زاد بالمجموع
  expect(await cashboxBalance()).toBe('300');
});

// ============ 2) حفظ آجل ============

test('2) حفظ آجل: لا صندوق + رصيد العميل زاد بعملة الفاتورة + الخدمي بلا حركة', async () => {
  const r = await saveSaleInvoice({
    items: [
      { productId: shampooId, qty: '1', unitPrice: '150' },
      { productId: serviceId, qty: '1', unitPrice: '1000' },
      { productId: null, lineDesc: 'تغليف هدايا', qty: '1', unitPrice: '500' },
    ],
    payType: 'credit',
    customerId,
    warehouseId,
    currencyId: baseId,
  });

  expect(r.invoiceNo).toBe(`INV-${YEAR}-00002`);
  expect(r.total).toBe('1650');
  expect(r.dueAmount).toBe('1650');

  // لا حركة صندوق إطلاقاً
  expect((await cashTxOf(r.invoiceId)).length).toBe(0);

  // حركة مخزون واحدة فقط (الشامبو) — الخدمي والسطر الحر بلا أثر
  const moves = await movementsOf(r.invoiceId);
  expect(moves.length).toBe(1);
  expect(await stockOf(shampooId)).toBe('7');

  // رصيد العميل زاد بالمجموع بعملة الفاتورة
  const balances = await customerBalances(customerId);
  const base = balances.find((b) => b.currencyId === baseId);
  expect(base?.balance).toBe('1650');
});

// ============ 3) مختلط ============

test('3) مختلط (نقدي 60%): قبض بالجزء فقط + due للباقي + رصيد العميل بالباقي', async () => {
  const r = await saveSaleInvoice({
    items: baseSaleItems(),
    payType: 'mixed',
    cashPart: '180',
    customerId,
    cashboxId,
    warehouseId,
    currencyId: baseId,
  });

  expect(r.invoiceNo).toBe(`INV-${YEAR}-00003`);
  expect(r.payStatus).toBe('mixed');
  expect(r.total).toBe('300');
  expect(r.dueAmount).toBe('120');

  const inv = await invoiceRow(r.invoiceId);
  expect(String(inv?.paid_amount)).toBe('180');
  expect(String(inv?.due_amount)).toBe('120');

  // القبض بالجزء النقدي فقط
  const txs = await cashTxOf(r.invoiceId);
  expect(txs.length).toBe(1);
  expect(String(txs[0]?.amount)).toBe('180');
  const db = await getDb();
  const alloc = await db.all<{ allocated_amount: string }>(
    'SELECT allocated_amount FROM payment_allocation WHERE invoice_id = ?',
    [r.invoiceId],
  );
  expect(String(alloc[0]?.allocated_amount)).toBe('180');

  expect(await stockOf(shampooId)).toBe('5');
  // رصيد الصندوق: 300 (نقدي سابق) + 180
  expect(await cashboxBalance()).toBe('480');
  // رصيد العميل: 1650 (آجل سابق) + 120 (المتبقي هنا)
  const balances = await customerBalances(customerId);
  expect(balances.find((b) => b.currencyId === baseId)?.balance).toBe('1770');
});

// ============ 4) مسودة ثم تحويل ============

test('4) مسودة بلا رقم ولا أثر → التحويل يستهلك رقماً ويطبق كل الآثار', async () => {
  const d = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '1', unitPrice: '150' }],
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: baseId,
    saveAsDraft: true,
  });

  expect(d.invoiceNo).toBeNull();
  const inv = await invoiceRow(d.invoiceId);
  expect(inv?.status).toBe('draft');
  expect(inv?.invoice_no).toBeNull();
  // لا حركات ولا نقد ولا تخصيص
  expect((await movementsOf(d.invoiceId)).length).toBe(0);
  expect((await cashTxOf(d.invoiceId)).length).toBe(0);
  const db = await getDb();
  const allocCount = await db.all<{ c: number }>(
    'SELECT count(*) AS c FROM payment_allocation WHERE invoice_id = ?',
    [d.invoiceId],
  );
  expect(Number(allocCount[0]?.c)).toBe(0);
  // المخزون لم يتأثر (5)
  expect(await stockOf(shampooId)).toBe('5');

  // التحويل
  const r = await convertDraftToCompleted(d.invoiceId);
  expect(r.invoiceNo).toBe(`INV-${YEAR}-00004`);
  expect(r.total).toBe('150');
  expect(r.dueAmount).toBe('0');

  const after = await invoiceRow(d.invoiceId);
  expect(after?.status).toBe('completed');
  expect(String(after?.invoice_no)).toBe(`INV-${YEAR}-00004`);
  expect(String(after?.issued_at)).toBe(todayISO());
  expect(after?.converted_at).toBeTruthy();
  expect(String(after?.paid_amount)).toBe('150');

  // الآثار اكتملت: مخزون 4 + قبض 150
  expect(await stockOf(shampooId)).toBe('4');
  expect((await movementsOf(d.invoiceId)).length).toBe(1);
  const txs = await cashTxOf(d.invoiceId);
  expect(txs.length).toBe(1);
  expect(String(txs[0]?.amount)).toBe('150');
});

// ============ 5) تحويل بنقص مخزون ============

test('5) تحويل بنقص مخزون → رفض بتسمية الصنف والكمية + رجوع المعاملة كاملة', async () => {
  const d = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '5', unitPrice: '150' }],
    payType: 'credit',
    customerId,
    warehouseId,
    currencyId: baseId,
    saveAsDraft: true,
  });
  expect(d.invoiceNo).toBeNull();

  // خصم يدوي قبل التحويل: 4 → 2
  await adjustStock({ productId: shampooId, warehouseId, newQty: '2', reason: 'اختبار' });
  expect(await stockOf(shampooId)).toBe('2');

  let err: unknown;
  try {
    await convertDraftToCompleted(d.invoiceId);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(StockShortageError);
  const shortage = err as StockShortageError;
  expect(shortage.productName).toBe('شامبو');
  expect(shortage.requested).toBe('5');
  expect(shortage.available).toBe('2');
  expect(shortage.message).toContain('شامبو');
  expect(shortage.message).toContain('5');
  expect(shortage.message).toContain('2');

  // المعاملة كلها رجعت: الصف لم يتغير والمخزون كما هو
  const inv = await invoiceRow(d.invoiceId);
  expect(inv?.status).toBe('draft');
  expect(inv?.invoice_no).toBeNull();
  expect(await stockOf(shampooId)).toBe('2');
  expect((await movementsOf(d.invoiceId)).length).toBe(0);
});

// ============ 6) نقص المخزون عند الحفظ المباشر ============

test('6) حفظ مباشر بنقص مخزون → StockShortageError بنفس النمط', async () => {
  let err: unknown;
  try {
    await saveSaleInvoice({
      items: [{ productId: shampooId, qty: '10', unitPrice: '150' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
    });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(StockShortageError);
  const shortage = err as StockShortageError;
  expect(shortage.productName).toBe('شامبو');
  expect(shortage.requested).toBe('10');
  expect(shortage.available).toBe('2');
  expect(shortage.message).toContain('خفّض الكمية أو احذف الزيادة');
  // لا صف أُنشئ ولا مخزون تغير
  expect(await stockOf(shampooId)).toBe('2');
});

// ============ 7) الإلغاء void ============

test('7) الإلغاء: مخزون ونقدية ورصيد عادت + الرقم لا يُعاد + مرتجع بعده مرفوض', async () => {
  const db = await getDb();

  // 7-أ: إلغاء الفاتورة النقدية الأولى (INV-00001)
  await voidInvoice(1, { managerConfirmed: true, reason: 'اختبار الإلغاء' });

  // المخزون عاد: 2 + 2 = 4
  expect(await stockOf(shampooId)).toBe('4');
  // حركات معاكسة موجبة بنفس التكلفة
  const moves = await movementsOf(1);
  expect(moves.length).toBe(2);
  const reversal = moves.find((m) => dec(String(m.qty)).greaterThan(0));
  expect(reversal?.movement_type).toBe('sale');
  expect(String(reversal?.unit_cost)).toBe('100');

  // النقدية عكسية: الأصلية is_voided=1 + حركة معاكسة payment بنفس المبلغ
  const txs = await cashTxOf(1);
  expect(txs.length).toBe(2);
  const original = txs.find((t) => t.reversal_of === null);
  const opposite = txs.find((t) => t.reversal_of !== null);
  expect(original && Number(original.is_voided)).toBe(1);
  expect(opposite?.tx_type).toBe('payment');
  expect(String(opposite?.amount)).toBe('300');
  // رصيد الصندوق: 630 (بعد تحويل المسودة) − 300 = 330
  expect(await cashboxBalance()).toBe('330');

  // 7-ب: إلغاء الفاتورة الآجلة → رصيد العميل عاد (1770 − 1650 = 120)
  await voidInvoice(2, { managerConfirmed: true });
  const balances = await customerBalances(customerId);
  expect(balances.find((b) => b.currencyId === baseId)?.balance).toBe('120');

  // الفاتورة الملغاة تبقى ظاهرة بحالتها
  const voided = await invoiceRow(2);
  expect(voided?.status).toBe('void');
  expect(String(voided?.invoice_no)).toBe(`INV-${YEAR}-00002`);

  // 7-ج: مرتجع مكتمل مرتبط بالفاتورة الثالثة → إلغاؤها مرفوض
  await db.run(
    "INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, original_invoice_id, customer_id, " +
      'warehouse_id, currency_id, exchange_rate, subtotal, total, paid_amount, due_amount, created_at) ' +
      "VALUES('SRN-T', 'sale_return', 'cash', 'completed', ?, 3, ?, ?, ?, '1', 300, 300, 300, 0, ?)",
    [todayISO(), customerId, warehouseId, baseId, new Date().toISOString()],
  );
  let err: unknown;
  try {
    await voidInvoice(3, { managerConfirmed: true });
  } catch (e) {
    err = e;
  }
  expect((err as Error)?.message).toContain('المرتجعات');

  // 7-د: الرقم لا يُعاد — فاتورة جديدة تأخذ رقماً جديداً لا يعيد 1 ولا 2
  const r = await saveSaleInvoice({
    items: [{ productId: null, lineDesc: 'خدمة متنوعة', qty: '1', unitPrice: '100' }],
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: baseId,
  });
  expect(r.invoiceNo).toBe(`INV-${YEAR}-00005`);

  // إلغاء بلا تأكيد مدير → رفض
  let err2: unknown;
  try {
    await voidInvoice(3, { managerConfirmed: false });
  } catch (e) {
    err2 = e;
  }
  expect((err2 as Error)?.message).toContain('المدير');
});

// ============ 8) صافي ≤ 0 وخصم أكبر من المجموع ============

test('8) صافي ≤ 0 → رفض، وخصم أكبر من المجموع → رفض', async () => {
  await expect(
    saveSaleInvoice({
      items: [{ productId: null, lineDesc: 'بند مجاني', qty: '1', unitPrice: '0' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
    }),
  ).rejects.toThrow('صافي الفاتورة صفر أو سالب');

  await expect(
    saveSaleInvoice({
      items: baseSaleItems(),
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
      invoiceDiscount: '500',
    }),
  ).rejects.toThrow('أكبر من مجموع البنود');
});

// ============ 9) حد الائتمان ============

test('9) حد الائتمان: صفر يمنع الآجل، وقيمة مع warn تتطلب تأكيداً ثم تنجح', async () => {
  const cust0 = await createCustomer({ name: 'عميل نقدي فقط', creditLimit: '0' });
  await expect(
    saveSaleInvoice({
      items: [{ productId: shampooId, qty: '1', unitPrice: '150' }],
      payType: 'credit',
      customerId: cust0,
      warehouseId,
      currencyId: baseId,
    }),
  ).rejects.toThrow('الآجل');

  const cust100 = await createCustomer({ name: 'عميل محدود', creditLimit: '100' });
  await expect(
    saveSaleInvoice({
      items: [{ productId: shampooId, qty: '1', unitPrice: '150' }],
      payType: 'credit',
      customerId: cust100,
      warehouseId,
      currencyId: baseId,
    }),
  ).rejects.toBeInstanceOf(CreditLimitConfirmationRequiredError);

  // إعادة الحفظ بالعلم → ينجح
  const r = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '1', unitPrice: '150' }],
    payType: 'credit',
    customerId: cust100,
    warehouseId,
    currencyId: baseId,
    creditLimitConfirmed: true,
  });
  expect(r.invoiceNo).toBe(`INV-${YEAR}-00006`);
  expect(r.dueAmount).toBe('150');

  // وضع block: التجاوز مرفوض دائماً حتى مع التأكيد
  await setSetting('parties.credit_limit_action', 'block');
  await expect(
    saveSaleInvoice({
      items: [{ productId: shampooId, qty: '1', unitPrice: '150' }],
      payType: 'credit',
      customerId: cust100,
      warehouseId,
      currencyId: baseId,
      creditLimitConfirmed: true,
    }),
  ).rejects.toThrow('حد الائتمان');
  await setSetting('parties.credit_limit_action', 'warn');

  // رصيد العميل المحدود = 150 في عملة الأساس
  const balances = await customerBalances(cust100);
  expect(balances.find((b) => b.currencyId === baseId)?.balance).toBe('150');
});

// ============ 10) عملة أجنبية ============

test('10) SAR بسعر اليوم → total_base = total×rate، وبلا سعر → MissingRateError بلا حفظ', async () => {
  // USD بلا سعر اليوم → MissingRateError ولا يُحفظ شيء بسعر 1
  await expect(
    saveSaleInvoice({
      items: [{ productId: shampooId, qty: '1', unitPrice: '10' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: usdId,
    }),
  ).rejects.toBeInstanceOf(MissingRateError);

  const db = await getDb();
  const usdCount = await db.all<{ c: number }>(
    'SELECT count(*) AS c FROM invoice WHERE currency_id = ?',
    [usdId],
  );
  expect(Number(usdCount[0]?.c)).toBe(0);

  // SAR بسعر اليوم 530
  await setDailyRate(sarId, todayISO(), '530');
  const r = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '1', unitPrice: '100' }],
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: sarId,
  });
  expect(r.invoiceNo).toBe(`INV-${YEAR}-00007`);
  expect(r.total).toBe('100');

  const inv = await invoiceRow(r.invoiceId);
  expect(String(inv?.exchange_rate)).toBe('530');
  expect(String(inv?.total_base)).toBe('53000');
  expect(Number(inv?.rate_is_fallback)).toBe(0);

  // القبض بعملة الفاتورة (SAR)
  const txs = await cashTxOf(r.invoiceId);
  expect(txs.length).toBe(1);
  expect(Number(txs[0]?.currency_id)).toBe(sarId);
});

// ============ 11) آجل بلا عميل ============

test('11) آجل بلا عميل → خطأ عربي واضح', async () => {
  await expect(
    saveSaleInvoice({
      items: baseSaleItems(),
      payType: 'credit',
      warehouseId,
      currencyId: baseId,
    }),
  ).rejects.toThrow('عميل');
});

// ============ 12) الذرّية: 100 فاتورة متوازية ============

test('12) 100 فاتورة متوازية: أرقام فريدة بلا فجوات ولا كسور مخزون', async () => {
  const penId = await createProduct({
    name: 'قلم',
    costPrice: '1',
    prices: [{ currencyId: baseId, price: '5' }],
    openingQty: '300',
  });

  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      saveSaleInvoice({
        items: [{ productId: penId, qty: '1', unitPrice: '5' }],
        payType: 'cash',
        cashboxId,
        warehouseId,
        currencyId: baseId,
      }),
    ),
  );

  const nos = results.map((r) => r.invoiceNo ?? '');
  expect(new Set(nos).size).toBe(100);
  const seqs = nos.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
  expect(seqs[0]).toBe(8); // آخر رقم مستهلك كان 7
  expect(seqs[99]).toBe(107);
  for (let i = 1; i < 100; i++) {
    expect(seqs[i]! - seqs[i - 1]!).toBe(1);
  }

  // المخزون نقص بالضبط 100 بلا كسور ولا سالب
  expect(await stockOf(penId)).toBe('200');
  const db = await getDb();
  const negatives = await db.all<{ c: number }>('SELECT count(*) AS c FROM stock_level WHERE qty < 0');
  expect(Number(negatives[0]?.c)).toBe(0);
});

// ============ الاستعلام (getSaleInvoice / listInvoices) ============

test('استعلام الفاتورة الكاملة والقائمة بالفلاتر', async () => {
  // آخر فاتورة نقدية ناجحة من الاختبار 12
  const list = await listInvoices({ docType: 'sale', status: 'completed', limit: 5 });
  expect(list.length).toBeGreaterThan(0);
  expect(list[0]?.invoiceNo).toBeTruthy();
  expect(list[0]?.currencyCode).toBe('YER');

  const full = await getSaleInvoice(list[0]!.id);
  expect(full).not.toBeNull();
  expect(full?.invoice.status).toBe('completed');
  expect(full?.items.length).toBe(1);
  expect(full?.items[0]?.productId).not.toBeNull();
  expect(full?.warehouseName).toBeTruthy();
  expect(full?.allocations.length).toBe(1);
  expect(full?.allocations[0]?.amount).toBe('5');

  // بحث بالرقم
  const byNo = await listInvoices({ q: `INV-${YEAR}-00001` });
  expect(byNo.length).toBe(1);
  expect(byNo[0]?.invoiceNo).toBe(`INV-${YEAR}-00001`);
  expect(byNo[0]?.status).toBe('void');

  // بحث باسم العميل
  const byCustomer = await listInvoices({ customerId, status: 'completed' });
  expect(byCustomer.length).toBe(2); // 00003 مختلطة + 00006 آجلة

  // المسودات فقط
  const drafts = await listInvoices({ status: 'draft' });
  expect(drafts.length).toBe(1); // مسودة اختبار 5 (رفض تحويلها)
  expect(drafts[0]?.invoiceNo).toBeNull();
});
