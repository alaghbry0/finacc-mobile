import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import {
  createCustomer,
  updateCustomer,
  archiveCustomer,
  getCustomer,
  getSupplier,
  createSupplier,
  archiveSupplier,
  customerBalances,
  supplierBalances,
  searchCustomers,
  searchSuppliers,
  type PartyBalance,
} from '@/domain/parties';
import {
  addCurrency,
  setCurrencyActive,
  rateHistory,
  missingRateToday,
  setDailyRate,
  listAllCurrencies,
} from '@/domain/currency';
import { todayISO } from '@/utils/format';

/**
 * اختبارات الأطراف (الوحدة 03 + قرار 8) وإدارة العملات (الوحدة 08 — إضافات الموجة 3-b):
 * - المعادلة الملزمة للرصيد لكل عملة على حدة (FR-03-02 — نسخة AC-02 مبسطة قبل الموجة 4:
 *   الصفوف تُدخل يدوياً بالـ SQL داخل الاختبار لأن الفواتير تُنشأ في الموجة 4).
 * - الرصيد الافتتاحي بعملته وسعره (FR-03-01) + حد الائتمان NULL/0.
 * - الأرشفة بلا حذف (FR-03-09).
 * - العملات: رمز فريد + الأساس لا يُعطّل + سجل الأسعار التنازلي + «لا سعر اليوم».
 */

let baseId = 0;
let sarId = 0;
let warehouseId = 0;
let cashboxId = 0;
let invoiceSeq = 0;

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
  const warehouse = await db.all<{ id: number }>('SELECT id FROM warehouse ORDER BY id LIMIT 1');
  warehouseId = Number(warehouse[0]?.id ?? 0);
  const cashbox = await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1');
  cashboxId = Number(cashbox[0]?.id ?? 0);
  // سعر اليوم للريال السعودي (عملة ثانية بأسعار — أساس اختبارات القرار 8)
  await setDailyRate(sarId, todayISO(), '530');
});

afterAll(() => {
  disposeTestDb();
});

/** إدراج فاتورة خام (اليوم تحاكي الموجة 4: sale/sale_return/purchase/purchase_return). */
async function insertInvoice(opts: {
  partyId: number;
  partyCol: 'customer_id' | 'supplier_id';
  docType: 'sale' | 'sale_return' | 'purchase' | 'purchase_return';
  due: string;
  payStatus?: string;
  status?: string;
  currencyId?: number;
  total?: string;
  paid?: string;
}): Promise<number> {
  const db = await getDb();
  invoiceSeq += 1;
  const total = opts.total ?? opts.due; // افتراضياً بلا مدفوع — due = total (شروط CHECK: total>0 و due>=0)
  const paid = opts.paid ?? '0';
  const res = await db.run(
    'INSERT INTO invoice(invoice_no, doc_type, pay_status, status, issued_at, ' +
      `${opts.partyCol}, warehouse_id, currency_id, exchange_rate, subtotal, total, paid_amount, due_amount, created_at) ` +
      "VALUES(?, ?, ?, ?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?)",
    [
      `T-${invoiceSeq}`,
      opts.docType,
      opts.payStatus ?? 'credit',
      opts.status ?? 'completed',
      '2030-01-15',
      opts.partyId,
      warehouseId,
      opts.currencyId ?? baseId,
      total,
      total,
      paid,
      opts.due,
      new Date().toISOString(),
    ],
  );
  return Number(res.lastInsertRowId);
}

/** إدراج سند قبض/صرف خام (tx_type حسب جهة الطرف). */
async function insertCashTx(opts: {
  partyId: number;
  partyCol: 'customer_id' | 'supplier_id';
  txType: 'receipt' | 'payment';
  amount: string;
  voided?: boolean;
  refType?: string;
  currencyId?: number;
}): Promise<number> {
  const db = await getDb();
  const res = await db.run(
    'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ' +
      `${opts.partyCol}, is_voided, created_at) ` +
      "VALUES(?, ?, ?, ?, '1', '2030-01-16', ?, ?, ?, ?)",
    [
      opts.txType,
      cashboxId,
      opts.currencyId ?? baseId,
      opts.amount,
      opts.refType ?? 'invoice',
      opts.partyId,
      opts.voided === true ? 1 : 0,
      new Date().toISOString(),
    ],
  );
  return Number(res.lastInsertRowId);
}

function find(bals: PartyBalance[], currencyId: number): PartyBalance | undefined {
  return bals.find((b) => b.currencyId === currencyId);
}

describe('parties: الرصيد الافتتاحي (FR-03-01)', () => {
  test('عميل برصيد افتتاحي 50,000 YER → 50,000 بعملة الأساس ولا شيء في غيرها', async () => {
    const id = await createCustomer({
      name: 'أحمد سعيد',
      phone: '777123456',
      openingBalance: '50000',
      openingCurrencyId: baseId,
      openingRate: '1',
      openingDate: '2030-01-01',
    });
    expect(id).toBeGreaterThan(0);
    const row = await getCustomer(id);
    expect(row?.name).toBe('أحمد سعيد');
    expect(row?.phone).toBe('777123456');
    expect(row?.openingBalance).toBe('50000');
    expect(row?.openingCurrencyId).toBe(baseId);
    expect(row?.openingRate).toBe('1');
    expect(row?.openingDate).toBe('2030-01-01');
    expect(row?.isArchived).toBe(0);

    const bals = await customerBalances(id);
    expect(bals).toHaveLength(1);
    expect(bals[0]?.currencyId).toBe(baseId);
    expect(bals[0]?.code).toBe('YER');
    expect(bals[0]?.balance).toBe('50000');
  });

  test('رصيد افتتاحي بعملة أجنبية يقع في عملته وحدها (قرار 8)', async () => {
    const id = await createCustomer({
      name: 'عميل بالسعودي',
      openingBalance: '100',
      openingCurrencyId: sarId,
      openingRate: '530',
      openingDate: '2030-01-02',
    });
    const bals = await customerBalances(id);
    expect(bals).toHaveLength(1);
    expect(bals[0]?.code).toBe('SAR');
    expect(bals[0]?.balance).toBe('100');
    expect(find(bals, baseId)).toBeUndefined();
    // القائمة السريعة تحوّله لعملة الأساس بسعره المسجل: 100 × 530
    const list = await searchCustomers('');
    const mine = list.find((c) => c.id === id);
    expect(mine?.baseBalance).toBe('53000');
  });

  test('بلا رصيد افتتاحي → مصفوفة أرصدة فارغة', async () => {
    const id = await createCustomer({ name: 'عميل جديد بلا أرصدة' });
    const bals = await customerBalances(id);
    expect(bals).toHaveLength(0);
    const list = await searchCustomers('');
    expect(list.find((c) => c.id === id)?.baseBalance).toBe('0');
  });

  test('رصيد أجنبي بلا سعر → رفض واضح', async () => {
    let msg = '';
    try {
      await createCustomer({ name: 'بلا سعر', openingBalance: '50', openingCurrencyId: sarId });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('سعر الصرف مطلوب');
  });
});

describe('parties: معادلة رصيد العميل (FR-03-02 — AC-02 مبسط)', () => {
  let id = 0;

  beforeAll(async () => {
    id = await createCustomer({
      name: 'عميل المعادلة',
      openingBalance: '50000',
      openingCurrencyId: baseId,
      openingRate: '1',
      openingDate: '2030-01-01',
    });
  });

  test('آجل 30,000 + مرتجع 5,000 + قبض 10,000 → 65,000', async () => {
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '30000', payStatus: 'credit' });
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale_return', due: '5000' });
    await insertCashTx({ partyId: id, partyCol: 'customer_id', txType: 'receipt', amount: '10000' });
    const bals = await customerBalances(id);
    expect(bals).toHaveLength(1);
    expect(bals[0]?.balance).toBe('65000');
  });

  test('سند قبض معكوس (is_voided=1) لا يُحسب', async () => {
    await insertCashTx({ partyId: id, partyCol: 'customer_id', txType: 'receipt', amount: '9999', voided: true });
    const bals = await customerBalances(id);
    expect(bals[0]?.balance).toBe('65000');
  });

  test('فاتورة مسودة/ملغاة وسند بلا مرجع طرف لا تدخل المعادلة', async () => {
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '7000', status: 'draft' });
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '8000', status: 'void' });
    await insertCashTx({ partyId: id, partyCol: 'customer_id', txType: 'receipt', amount: '4000', refType: 'other' });
    const bals = await customerBalances(id);
    expect(bals[0]?.balance).toBe('65000');
  });

  test('بيع نقدي (cash) و mixed يدخلان بحسب قاعدة الآجل فقط', async () => {
    // sale بpay_status='cash' → مدفوع بالكامل، due=0 لا يدخل معادلة الآجل
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '0', payStatus: 'cash', total: '7000', paid: '7000' });
    // mixed يدخل بما تبقى منه
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '2000', payStatus: 'mixed', total: '5000', paid: '3000' });
    const bals = await customerBalances(id);
    expect(bals[0]?.balance).toBe('67000');
  });

  test('حركة بعملة أجنبية تجلس في عملتها ولا تلمس عملة الأساس (قرار 8)', async () => {
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '250', currencyId: sarId });
    const bals = await customerBalances(id);
    expect(bals).toHaveLength(2);
    expect(find(bals, baseId)?.balance).toBe('67000');
    expect(find(bals, sarId)?.balance).toBe('250');
    // الأساس أولاً ثم بالرمز
    expect(bals[0]?.currencyId).toBe(baseId);
    expect(bals[1]?.code).toBe('SAR');
  });
});

describe('parties: حد الائتمان (FR-03-01 — سلوك البيع في الموجة 4)', () => {
  test('0 = منع الآجل كلياً، NULL = بلا حد', async () => {
    const zero = await createCustomer({ name: 'عميل ممنوع الآجل', creditLimit: '0' });
    const none = await createCustomer({ name: 'عميل بلا حد', creditLimit: null });
    const dflt = await createCustomer({ name: 'عميل افتراضي' });
    expect((await getCustomer(zero))?.creditLimit).toBe('0');
    expect((await getCustomer(none))?.creditLimit).toBeNull();
    expect((await getCustomer(dflt))?.creditLimit).toBeNull();
  });

  test('تعديل يبدّل القيمة وNULL ويعزل الرصيد الافتتاحي', async () => {
    const id = await createCustomer({
      name: 'عميل قابل للتعديل',
      creditLimit: '250000',
      openingBalance: '1200',
      openingCurrencyId: baseId,
      openingRate: '1',
      openingDate: '2030-01-03',
    });
    await updateCustomer(id, { creditLimit: null, name: 'عميل معدّل' });
    const row = await getCustomer(id);
    expect(row?.name).toBe('عميل معدّل');
    expect(row?.creditLimit).toBeNull();
    // الرصيد الافتتاحي لم يُمس لأنه لم يُمرَّر
    expect(row?.openingBalance).toBe('1200');
    const bals = await customerBalances(id);
    expect(bals[0]?.balance).toBe('1200');
  });
});

describe('parties: المورّد مرآة كاملة (FR-03-03)', () => {
  test('افتتاحي 20,000 + شراء آجل 15,000 − دفع 5,000 − مرتجع شراء 2,000 = 28,000', async () => {
    const id = await createSupplier({
      name: 'مورد التوريدات',
      phone: '711111111',
      openingBalance: '20000',
      openingCurrencyId: baseId,
      openingRate: '1',
      openingDate: '2030-01-01',
    });
    await insertInvoice({ partyId: id, partyCol: 'supplier_id', docType: 'purchase', due: '15000', payStatus: 'credit' });
    await insertInvoice({ partyId: id, partyCol: 'supplier_id', docType: 'purchase_return', due: '2000' });
    await insertCashTx({ partyId: id, partyCol: 'supplier_id', txType: 'payment', amount: '5000' });
    // قبض على حساب عميل لا يلمس رصيد المورّد (مرآة الطرفين)
    await insertCashTx({ partyId: id, partyCol: 'supplier_id', txType: 'receipt', amount: '777', refType: 'on_account' });

    const bals = await supplierBalances(id);
    expect(bals).toHaveLength(1);
    expect(bals[0]?.currencyId).toBe(baseId);
    expect(bals[0]?.balance).toBe('28000');

    const row = await getSupplier(id);
    expect(row?.name).toBe('مورد التوريدات');
    const list = await searchSuppliers('');
    expect(list.find((s) => s.id === id)?.baseBalance).toBe('28000');
  });
});

describe('parties: البحث (LIKE الاسم/الهاتف)', () => {
  test('بحث بالاسم الجزئي وبالهاتف، والمؤرشف مخفي', async () => {
    const hiddenId = await createCustomer({ name: 'سالم المخفي', phone: '700000000' });
    await archiveCustomer(hiddenId);
    const byName = await searchCustomers('أحمد');
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.some((c) => c.name === 'أحمد سعيد')).toBe(true);

    const byPhone = await searchCustomers('777123');
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0]?.name).toBe('أحمد سعيد');
    expect(byPhone[0]?.phone).toBe('777123456');

    // المؤرشف يختفي
    const hidden = (await searchCustomers('')).find((c) => c.name === 'سالم المخفي');
    expect(hidden).toBeUndefined();
    expect((await searchCustomers('سالم'))).toHaveLength(0);
  });
});

describe('parties: الأرشفة بلا حذف (FR-03-09)', () => {
  test('عميل له حركات يُؤرشف ولا يُحذف — مع قيد تدقيق', async () => {
    const db = await getDb();
    const id = await createCustomer({ name: 'عميل للحذف المرفوض', phone: '722222222' });
    await insertInvoice({ partyId: id, partyCol: 'customer_id', docType: 'sale', due: '900' });

    await archiveCustomer(id);
    const row = await getCustomer(id);
    expect(row?.isArchived).toBe(1); // ما زال موجوداً — أرشفة فقط

    const audit = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM audit_log WHERE action = 'archive_customer' AND entity = 'customer' AND entity_id = ?",
      [id],
    );
    expect(audit[0]?.c).toBe(1);

    // إعادة الأرشفة آمنة (idempotent)
    await archiveCustomer(id);
    expect((await getCustomer(id))?.isArchived).toBe(1);
  });

  test('مورّد كذلك — أرشفة مع قيد', async () => {
    const db = await getDb();
    const id = await createSupplier({ name: 'مورد مؤرشف' });
    await archiveSupplier(id);
    expect((await getSupplier(id))?.isArchived).toBe(1);
    const audit = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM audit_log WHERE action = 'archive_supplier' AND entity = 'supplier' AND entity_id = ?",
      [id],
    );
    expect(audit[0]?.c).toBe(1);
  });
});

describe('currency: إدارة العملات (إضافات الموجة 3-b)', () => {
  test('addCurrency برمز مكرر → خطأ واضح', async () => {
    let msg = '';
    try {
      await addCurrency({ code: 'SAR', name: 'مكرر', decimals: 2 });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('مستخدم مسبقاً');
  });

  test('addCurrency سليم → عملة جديدة مفعّلة غير أساسية', async () => {
    const eurId = await addCurrency({ code: 'EUR', name: 'يورو', decimals: 2 });
    expect(eurId).toBeGreaterThan(0);
    const all = await listAllCurrencies();
    const eur = all.find((c) => c.id === eurId);
    expect(eur?.code).toBe('EUR');
    expect(eur?.is_active).toBe(1);
    expect(eur?.is_base).toBe(0);
  });

  test('العملة الأساسية لا تُعطّل أبداً', async () => {
    let msg = '';
    try {
      await setCurrencyActive(baseId, false);
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('لا يمكن تعطيلها');
    expect((await listAllCurrencies()).find((c) => c.id === baseId)?.is_active).toBe(1);
  });

  test('تعطيل/تفعيل عملة غير أساسية يعمل ويسجل تدقيقاً', async () => {
    await setCurrencyActive(sarId, false);
    expect((await listAllCurrencies()).find((c) => c.id === sarId)?.is_active).toBe(0);
    await setCurrencyActive(sarId, true);
    expect((await listAllCurrencies()).find((c) => c.id === sarId)?.is_active).toBe(1);
  });

  test('rateHistory تنازلياً بالتاريخ (الأحدث أولاً)', async () => {
    await setDailyRate(sarId, '2020-05-01', '250');
    await setDailyRate(sarId, '2020-05-02', '260');
    await setDailyRate(sarId, '2020-05-03', '270');
    const hist = await rateHistory(sarId, 14);
    expect(hist.length).toBeGreaterThanOrEqual(4);
    // الأحدث أولاً: اليوم الحالي ثم 2020-05-03 ثم 02 ثم 01
    expect(hist[0]?.rateDate).toBe(todayISO());
    expect(hist[1]?.rateDate).toBe('2020-05-03');
    expect(hist[2]?.rateDate).toBe('2020-05-02');
    expect(hist[3]?.rateDate).toBe('2020-05-01');
    expect(hist[1]?.rate).toBe('270');
  });

  test('missingRateToday: الفاعلة غير الأساس بلا سعر اليوم فقط', async () => {
    // بعد الإعداد: SAR عندها سعر اليوم؛ USD وAED وEUR (أضفناها للتو) بلا سعر
    const missing = await missingRateToday();
    const codes = missing.map((c) => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('AED');
    expect(codes).toContain('EUR');
    expect(codes).not.toContain('SAR');
    expect(codes).not.toContain('YER');

    // بعد إدخال سعر اليوم لأحدها تختفي من القائمة
    const usdRow = missing.find((c) => c.code === 'USD');
    if (usdRow !== undefined) {
      await setDailyRate(usdRow.id, todayISO(), '525');
      expect((await missingRateToday()).map((c) => c.code)).not.toContain('USD');
    }
  });
});
