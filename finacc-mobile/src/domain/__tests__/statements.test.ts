import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { createCustomer, createSupplier, customerBalances } from '@/domain/parties';
import { setDailyRate } from '@/domain/currency';
import { saveSaleInvoice } from '@/domain/invoicing';
import { savePurchaseInvoice as savePurchase } from '@/domain/purchasing';
import { createCheque, markCleared } from '../cheques';
import { todayISO } from '@/utils/format';
import { setCurrentUserId } from '@/domain/session-user';
import { customerStatement, supplierStatement } from '../statements';

/**
 * اختبارات كشف حساب الطرف (FR-03-04 + AC-18 روحها):
 * الكشف بعملة واحدة يتوازن دائماً بعد تسوية كاملة بنفس العملة، وأحداث
 * العملات الأخرى لا تُجمع في رقم واحد (قرار 8) — لكل عملة كشفها.
 */

let baseId = 0;
let sarId = 0;
let warehouseId = 0;
let cashboxId = 0;
let productId = 0;
let customerId = 0;
let supplierId = 0;

const today = todayISO();

function daysFromISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر الكشوف',
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

  productId = await createProduct({
    name: 'صنف الكشوف',
    costPrice: '500',
    prices: [
      { currencyId: baseId, price: '1000' },
      { currencyId: sarId, price: '1000' },
    ],
    openingQty: '100',
  });
  customerId = await createCustomer({ name: 'كاشف الحساب' });
  supplierId = await createSupplier({ name: 'مورّد الكشوف' });
});

afterAll(() => {
  setCurrentUserId(null); // نظافة حالة الجلسة المشتركة بين ملفات bun test
  disposeTestDb();
});

// ============ مساعدات: سندات يدوية (كما في اختبار معادلة الرصيد 3-b) ============

async function insertReceipt(opts: {
  customerId?: number;
  supplierId?: number;
  amount: string;
  currencyId: number;
  date: string;
  refType?: string;
}): Promise<number> {
  const db = await getDb();
  const res = await db.run(
    'INSERT INTO cash_tx(tx_type, cashbox_id, currency_id, amount, exchange_rate, tx_date, ref_type, ref_id, ' +
      'customer_id, supplier_id, is_voided, description, created_at) ' +
      "VALUES(?, ?, ?, ?, '1', ?, ?, NULL, ?, ?, 0, ?, ?)",
    [
      opts.supplierId !== undefined ? 'payment' : 'receipt',
      cashboxId,
      opts.currencyId,
      opts.amount,
      opts.date,
      opts.refType ?? 'on_account',
      opts.customerId ?? null,
      opts.supplierId ?? null,
      'سند اختبار',
      opts.date + 'T10:00:00.000Z',
    ],
  );
  return Number(res.lastInsertRowId);
}

// ============ 1) روح AC-18: التسوية بنفس العملة تتوازن ============

describe('statements: كشف بعملة واحدة يتوازن دائماً (نفس العملة)', () => {
  test('فاتورة آجلة 5,000 SAR + تحصيل 5,000 SAR → افتتاحي 0، مدين 5,000، دائن 5,000، إغلاق 0', async () => {
    await setDailyRate(sarId, today, '530');
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '5', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: sarId,
      })
    ).invoiceId;
    await insertReceipt({ customerId, amount: '5000', currencyId: sarId, date: today });

    const st = await customerStatement(customerId, { currencyId: sarId });
    expect(st.currencyCode).toBe('SAR');
    expect(st.opening).toBe('0');
    expect(st.lines).toHaveLength(2);

    const invoiceLine = st.lines.find((l) => l.docType === 'sale')!;
    expect(invoiceLine.debit).toBe('5000');
    expect(invoiceLine.credit).toBe('0');
    expect(invoiceLine.balance).toBe('5000');
    expect(invoiceLine.refId).toBe(inv);

    const receiptLine = st.lines.find((l) => l.docType === 'receipt')!;
    expect(receiptLine.credit).toBe('5000');
    expect(receiptLine.balance).toBe('0');

    expect(st.closing).toBe('0');
    // مطابقة معادلة رصيد الأطراف (3-b)
    const balances = await customerBalances(customerId);
    expect(balances.find((b) => b.currencyId === sarId)?.balance).toBe('0');
  });

  test('كشف YER لنفس الطرف: «لا أحداث بهذه العملة» + إشارة أحداث أخرى', async () => {
    const st = await customerStatement(customerId, { currencyId: baseId });
    expect(st.lines).toHaveLength(0);
    expect(st.closing).toBe('0');
    expect(st.hasOtherCurrencyEvents).toBe(true);
  });
});

// ============ 2) كشف مختلط: كل عملة ترى أحداثها فقط ============

describe('statements: أحداث بعملتين — كل كشف بعملته', () => {
  test('YER: فاتورة 3,000 + قبض 1,000 / SAR: لا يرى أحداث YER', async () => {
    await saveSaleInvoice({
      items: [{ productId, qty: '3', unitPrice: '1000' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
    });
    await insertReceipt({ customerId, amount: '1000', currencyId: baseId, date: today });

    const yer = await customerStatement(customerId, { currencyId: baseId });
    // أحداث YER: الفاتورة 3,000 مدين + قبض 1,000 دائن (أحداث SAR السابقة غير مرئية هنا)
    const sumDebit = yer.lines.reduce((s, l) => s + Number(l.debit), 0);
    const sumCredit = yer.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(sumDebit).toBe(3000);
    expect(sumCredit).toBe(1000);
    expect(yer.closing).toBe('2000');

    const sar = await customerStatement(customerId, { currencyId: sarId });
    const sarDocs = sar.lines.filter((l) => l.docType === 'sale' || l.docType === 'sale_return');
    expect(sarDocs.reduce((s, l) => s + Number(l.debit), 0)).toBe(5000);
    expect(sar.lines.every((l) => Number(l.debit) + Number(l.credit) >= 0)).toBe(true);
  });
});

// ============ 3) فلترة الفترة + الرصيد الافتتاحي المتحرك ============

describe('statements: فلترة الفترة (dateFrom/dateTo) والرصيد الافتتاحي', () => {
  test('أحداث ما قبل dateFrom تُطوى في الافتتاحي، وما بعد dateTo تُستبعد', async () => {
    const oldDate = daysFromISO(-30);
    const futureDate = daysFromISO(20);
    const midDate = daysFromISO(-5);

    // فاتورة قديمة 2,000 + قبض قديم 500 + فاتورة حديثة 1,000
    await saveSaleInvoice({
      items: [{ productId, qty: '2', unitPrice: '1000' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
      issuedAt: oldDate,
    });
    await insertReceipt({ customerId, amount: '500', currencyId: baseId, date: oldDate });
    await saveSaleInvoice({
      items: [{ productId, qty: '1', unitPrice: '1000' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
      issuedAt: midDate,
    });
    // حدث بعد dateTo (فاتورة مستقبلية — نستخدم قبض بتاريخ مستقبلي)
    await insertReceipt({ customerId, amount: '777', currencyId: baseId, date: futureDate });

    const st = await customerStatement(customerId, {
      currencyId: baseId,
      dateFrom: daysFromISO(-10),
      dateTo: today,
    });
    // الافتتاحي = أحداث YER قبل dateFrom فقط: فاتورة 2,000 − قبض 500 = 1,500
    expect(st.opening).toBe('1500');
    // سطور الفترة: القبض 1,000 (اختبار 2) + الفاتورة الحديثة 1,000 (مدين) + فاتورة القسم 3,000 (اختبار 2 كان قبل dateFrom؟ لا: بتاريخ اليوم)
    // الأحداث ضمن الفترة: قبض 1,000 + فاتورة 3,000 + فاتورة 1,000 (midDate)
    const docs = st.lines.filter((l) => l.docType === 'sale');
    expect(docs.reduce((s, l) => s + Number(l.debit), 0)).toBe(4000);
    expect(st.lines.every((l) => l.date >= daysFromISO(-10) && l.date <= today)).toBe(true);
    // الإغلاق = 1,500 + 4,000 − 1,000 = 4,500 (القبض المستقبلي 777 مستبعد)
    expect(st.closing).toBe('4500');
    // مطابقة الرصيد الكلي (بلا فلاتر) مع معادلة الأطراف
    const full = await customerStatement(customerId, { currencyId: baseId });
    const balances = await customerBalances(customerId);
    expect(full.closing).toBe(balances.find((b) => b.currencyId === baseId)?.balance);
  });
});

// ============ 4) الرصيد الافتتاحي للطرف ============

describe('statements: الرصيد الافتتاحي المسجل بعملته', () => {
  test('عميل برصيد افتتاحي 1,000 YER → الكشف يفتح به', async () => {
    const c2 = await createCustomer({ name: 'عميل افتتاحي', openingBalance: '1000', openingCurrencyId: baseId });
    const st = await customerStatement(c2, { currencyId: baseId });
    expect(st.opening).toBe('1000');
    expect(st.lines).toHaveLength(0);
    expect(st.closing).toBe('1000');
  });
});

// ============ 5) الشيكات في الكشف (FR-03-04 + FR-14-05) ============

describe('statements: الشيكات — لا تظهر قبل التحصيل وتظهر دائنة عند cleared', () => {
  test('شيك pending لا يظهر؛ بعد cleared يظهر سطر دائن بقيمة الشيك', async () => {
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '4', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    const chequeId = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'ST-9001',
      amount: '4000',
      currencyId: baseId,
      dueDate: today,
      refInvoiceId: inv,
    });

    // قبل التحصيل: الشيك ذمة فقط (لا سطر في الكشف)
    const before = await customerStatement(customerId, { currencyId: baseId });
    expect(before.lines.find((l) => l.refId === chequeId)).toBeUndefined();
    const beforeClosing = Number(before.closing);

    await markCleared(chequeId, { cashboxId });

    const after = await customerStatement(customerId, { currencyId: baseId });
    const chequeLine = after.lines.find((l) => l.refId === chequeId);
    expect(chequeLine).toBeDefined();
    expect(chequeLine!.credit).toBe('4000');
    expect(chequeLine!.docType).toBe('cheque');
    expect(Number(after.closing)).toBe(beforeClosing - 4000);
  });
});

// ============ 6) كشف المورّد ============

describe('statements: كشف المورّد (دائن للشراء، مدين للسداد والمرتجع)', () => {
  test('شراء آجل 2,000 + سداد 2,000 → إغلاق 0', async () => {
    await savePurchase({
      items: [{ productId, qty: '2', unitPrice: '1000' }],
      payType: 'credit',
      supplierId,
      warehouseId,
      currencyId: baseId,
    });
    await insertReceipt({ supplierId, amount: '2000', currencyId: baseId, date: today });

    const st = await supplierStatement(supplierId, { currencyId: baseId });
    const purchaseLine = st.lines.find((l) => l.docType === 'purchase')!;
    expect(purchaseLine.credit).toBe('2000'); // فاتورة الشراء دائن (علينا)
    const paymentLine = st.lines.find((l) => l.docType === 'payment')!;
    expect(paymentLine.debit).toBe('2000');
    expect(st.closing).toBe('0');
  });
});

// ============ 7) حماية الإدخال ============

describe('statements: حماية الإدخال', () => {
  test('طرف غير موجود → رسالة عربية', async () => {
    let msg = '';
    try {
      await customerStatement(99999, { currencyId: baseId });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('عميل');
  });

  test('مورّد غير موجود → رسالة عربية', async () => {
    let msg = '';
    try {
      await supplierStatement(99999, { currencyId: baseId });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('مورّد');
  });
});
