import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { createCustomer, customerBalances } from '@/domain/parties';
import { setDailyRate } from '@/domain/currency';
import { saveSaleInvoice } from '@/domain/invoicing';
import { setCurrentUserId } from '@/domain/session-user';
import { todayISO } from '@/utils/format';
import { dec } from '@/utils/money';
import {
  createInstallmentPlan,
  listPlans,
  getPlan,
  installmentsDue,
  collectInstallment,
  rescheduleInstallment,
  cancelPlan,
} from '../installments';

/**
 * اختبارات الوحدة 05 — التقسيط (FR-05-01..05 + قاعدة التقريب 5.4-9 + AC-05):
 * الجدول أقساط متساوية مقربة لمنازل العملة والفرق على الأخير، والتحصيل
 * سند قبض بعملة الخطة، وإعادة الجدولة تعديل تاريخ فقط + audit.
 */

let baseId = 0;
let sarId = 0;
let warehouseId = 0;
let cashboxId = 0;
let productId = 0;
let customerId = 0;
let inv12k = 0; // فاتورة آجلة 12,000 بعملة الأساس
let inv10kSar = 0; // فاتورة آجلة SAR 10,000
let invCash = 0; // فاتورة نقدية (للرفض)
let invPaid = 0; // فاتورة آجلة سُددت كاملاً (due=0 → رفض)

const today = todayISO();

function addMonths(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر الأقساط',
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
    name: 'صنف الأقساط',
    costPrice: '500',
    prices: [
      { currencyId: baseId, price: '1000' },
      { currencyId: sarId, price: '1000' },
    ],
    openingQty: '100',
  });
  customerId = await createCustomer({ name: 'سالم المقيّد' });

  inv12k = (
    await saveSaleInvoice({
      items: [{ productId, qty: '12', unitPrice: '1000' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
    })
  ).invoiceId;

  await setDailyRate(sarId, today, '530');
  inv10kSar = (
    await saveSaleInvoice({
      items: [{ productId, qty: '10', unitPrice: '1000' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: sarId,
    })
  ).invoiceId;

  invCash = (
    await saveSaleInvoice({
      items: [{ productId, qty: '1', unitPrice: '1000' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
    })
  ).invoiceId;

  const paidRes = await saveSaleInvoice({
    items: [{ productId, qty: '1', unitPrice: '1000' }],
    payType: 'mixed',
    cashPart: '1000',
    customerId,
    cashboxId,
    warehouseId,
    currencyId: baseId,
  });
  invPaid = paidRes.invoiceId; // mixed: due = 0
});

afterAll(() => {
  setCurrentUserId(null); // نظافة حالة الجلسة المشتركة بين ملفات bun test
  disposeTestDb();
});

// ============ مساعدات ============

async function yerBalance(): Promise<string> {
  const balances = await customerBalances(customerId);
  return balances.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

async function auditCount(action: string): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ c: number }>('SELECT count(*) AS c FROM audit_log WHERE action = ?', [action]);
  return rows[0]?.c ?? 0;
}

// ============ 1) AC-05 مبسطاً ============

describe('installments: AC-05 — 12 قسطاً شهرياً + تحصيل 3', () => {
  test('الجدول: 12 قسطاً بـ 1,000 لكل قسط', async () => {
    const { planId, installmentIds } = await createInstallmentPlan({
      invoiceId: inv12k,
      months: 12,
      firstDue: addMonths(today, 1),
    });
    expect(installmentIds).toHaveLength(12);
    const full = await getPlan(planId);
    expect(full?.plan.status).toBe('active');
    expect(full?.installments).toHaveLength(12);
    expect(full?.installments.every((i) => i.amount === '1000' && i.status === 'pending')).toBe(true);
    // تواريخ شهرية متتالية
    expect(full?.installments[1]?.dueDate).toBe(addMonths(today, 2));
    expect(full?.installments[11]?.dueDate).toBe(addMonths(today, 12));
    // لا دفعة أولى → لا سند
    expect(full?.plan.downPayment).toBe('0');
    expect(full?.plan.downPaymentCashTxId).toBeNull();
  });

  test('تحصيل 3 أقساط: 3 سندات قبض + الحالة paid + الرصيد نقص 3,000', async () => {
    const before = await yerBalance(); // 12,000 (نقدي/mixed المسددة لا أثر لها)
    const plans = await listPlans({ customerId });
    const plan = plans.find((p) => p.invoiceId === inv12k)!;

    for (const seq of [1, 2, 3]) {
      const full = await getPlan(plan.id);
      const target = full!.installments.find((i) => i.seq === seq)!;
      const { cashTxId } = await collectInstallment(target.id, { cashboxId });
      expect(cashTxId).toBeGreaterThan(0);
    }

    const db = await getDb();
    const receipts = await db.all<{ c: number; a: string }>(
      "SELECT count(*) AS c, COALESCE(SUM(amount), 0) AS a FROM cash_tx WHERE ref_type = 'installment' AND customer_id = ?",
      [customerId],
    );
    expect(receipts[0]?.c).toBe(3);
    expect(String(receipts[0]?.a)).toBe('3000');

    const full = await getPlan(plan.id);
    const paidStatuses = full!.installments.filter((i) => i.status === 'paid');
    expect(paidStatuses).toHaveLength(3);
    expect(full!.plan.totalPaid).toBe('3000');
    expect(full!.plan.status).toBe('active'); // لم تكتمل بعد

    // الرصيد نقص 3,000
    expect(dec(await yerBalance()).minus(dec(before)).toFixed(0)).toBe('-3000');
  });
});

// ============ 2) قاعدة التقريب 5.4-9 ============

describe('installments: قاعدة التقريب — الفرق على القسط الأخير', () => {
  test('SAR 10,000 على 3 أقساط → 3,333.33 ×2 + 3,333.34 للأخير', async () => {
    const { planId } = await createInstallmentPlan({
      invoiceId: inv10kSar,
      months: 3,
      firstDue: addMonths(today, 1),
    });
    const full = await getPlan(planId);
    const amounts = full!.installments.map((i) => i.amount);
    expect(amounts[0]).toBe('3333.33');
    expect(amounts[1]).toBe('3333.33');
    expect(amounts[2]).toBe('3333.34'); // الفرق على الأخير
    expect(String(amounts.reduce((s, a) => dec(s).plus(dec(a)).toFixed(2), '0'))).toBe('10000.00');
  });
});

// ============ 3) الدفعة الأولى (FR-05-01) ============

describe('installments: الدفعة الأولى المرتبطة بحركة صندوق', () => {
  test('دفعة 2,000 → 10 أقساط بـ 1,000 + سند مرتبط + تخصيص على الفاتورة', async () => {
    // فاتورة آجلة جديدة 12,000
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '12', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;

    let msg = '';
    try {
      await createInstallmentPlan({ invoiceId: inv, months: 10, downPayment: '2000', firstDue: addMonths(today, 1) });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('الصندوق');

    const before = await yerBalance();
    const { planId } = await createInstallmentPlan({
      invoiceId: inv,
      months: 10,
      downPayment: '2000',
      firstDue: addMonths(today, 1),
      cashboxId,
    });
    const full = await getPlan(planId);
    expect(full!.plan.downPayment).toBe('2000');
    expect(full!.plan.downPaymentCashTxId).not.toBeNull();
    expect(full!.installments).toHaveLength(10);
    expect(full!.installments.every((i) => i.amount === '1000')).toBe(true);

    // الدفعة الأولى = قبض مربوط بالخطة + تخصيص على الفاتورة
    const db = await getDb();
    const dpTx = await db.all<{ tx_type: string; amount: string; ref_type: string; ref_id: number }>(
      'SELECT tx_type, amount, ref_type, ref_id FROM cash_tx WHERE id = ?',
      [full!.plan.downPaymentCashTxId!],
    );
    expect(dpTx[0]?.tx_type).toBe('receipt');
    expect(String(dpTx[0]?.amount)).toBe('2000');
    expect(dpTx[0]?.ref_type).toBe('installment');
    expect(Number(dpTx[0]?.ref_id)).toBe(planId);

    const alloc = await db.all<{ a: string }>(
      'SELECT COALESCE(SUM(allocated_amount), 0) AS a FROM payment_allocation WHERE invoice_id = ?',
      [inv],
    );
    expect(String(alloc[0]?.a)).toBe('2000');

    // الرصيد نقص 2,000 فوراً (الدفعة الأولى)
    expect(dec(await yerBalance()).minus(dec(before)).toFixed(0)).toBe('-2000');
  });

  test('دفعة أولى أكبر من القابل للتقسيط → رفض', async () => {
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '5', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    let msg = '';
    try {
      await createInstallmentPlan({
        invoiceId: inv,
        months: 4,
        downPayment: '9999',
        firstDue: addMonths(today, 1),
        cashboxId,
      });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('الدفعة');
  });
});

// ============ 4) الدورية الأسبوعية + إعادة الجدولة (FR-05-04) ============

describe('installments: الدورية الأسبوعية وإعادة الجدولة', () => {
  test('أقساط أسبوعية بفارق 7 أيام + إعادة جدولة بقيد audit', async () => {
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '4', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    const firstDue = addDays(today, 3);
    const { planId } = await createInstallmentPlan({
      invoiceId: inv,
      months: 4,
      firstDue,
      cycle: 'weekly',
    });
    const full = await getPlan(planId);
    expect(full!.installments[0]?.dueDate).toBe(firstDue);
    expect(full!.installments[1]?.dueDate).toBe(addDays(firstDue, 7));
    expect(full!.installments[3]?.dueDate).toBe(addDays(firstDue, 21));

    const before = await auditCount('reschedule_installment');
    const newDate = addDays(firstDue, 30);
    await rescheduleInstallment(full!.installments[2]!.id, newDate);
    const after = await getPlan(planId);
    expect(after!.installments[2]?.dueDate).toBe(newDate);
    expect(await auditCount('reschedule_installment')).toBe(before + 1);
  });
});

// ============ 5) التحصيل الجزئي (FR-05-07 روحها) ============

describe('installments: التحصيل الجزئي', () => {
  test('400 ثم 600 من قسط 1,000 → partial ثم paid', async () => {
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '3', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    const { planId } = await createInstallmentPlan({ invoiceId: inv, months: 3, firstDue: addMonths(today, 1) });
    const full = await getPlan(planId);
    const inst = full!.installments[0]!;

    await collectInstallment(inst.id, { cashboxId, amount: '400' });
    let mid = (await getPlan(planId))!.installments[0]!;
    expect(mid.status).toBe('partial');
    expect(mid.paidAmount).toBe('400');
    expect(mid.paidAt).toBeNull();

    await collectInstallment(inst.id, { cashboxId, amount: '600' });
    const done = (await getPlan(planId))!.installments[0]!;
    expect(done.status).toBe('paid');
    expect(done.paidAmount).toBe('1000');
    expect(done.paidAt).not.toBeNull();
    expect(done.cashTxId).not.toBeNull();
  });
});

// ============ 6) فحوصات الرفض (FR-05-01) ============

describe('installments: فحوصات الإدخال', () => {
  test('التقسيط لفواتير البيع الآجلة فقط: نقدي/mixed-مسددة/مكررة → رفض', async () => {
    const attempts: Array<{ invoiceId: number; months: number; firstDue: string; expectMsg: string }> = [
      { invoiceId: invCash, months: 3, firstDue: addMonths(today, 1), expectMsg: 'آجلة' },
      { invoiceId: invPaid, months: 3, firstDue: addMonths(today, 1), expectMsg: 'آجلة' },
      { invoiceId: inv12k, months: 6, firstDue: addMonths(today, 1), expectMsg: 'نشطة' },
    ];
    for (const a of attempts) {
      let msg = '';
      try {
        await createInstallmentPlan(a);
      } catch (e) {
        msg = e instanceof Error ? e.message : '';
      }
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).toContain(a.expectMsg);
    }
  });
});

// ============ 7) الأقساط المستحقة والمتأخرة (FR-05-02/04) ============

describe('installments: installmentsDue — المستحق والمتأخر', () => {
  test('المستحق اليوم/الأسبوع + المتأخر، وخطط ملغاة لا تظهر', async () => {
    // خطة بقسط متأخر (استحقاق أمس)
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '2', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    const { planId } = await createInstallmentPlan({
      invoiceId: inv,
      months: 2,
      firstDue: addDays(today, -3),
    });

    const dueNow = await installmentsDue({ withinDays: 0 });
    const overdue = dueNow.filter((i) => i.dueDate < today);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue.every((i) => i.dueDate < today && i.status !== 'paid')).toBe(true);

    const withinWeek = await installmentsDue({ withinDays: 7 });
    expect(withinWeek.length).toBeGreaterThanOrEqual(dueNow.length);

    // إلغاء الخطة → تختفي من المستحق
    let msg = '';
    try {
      await cancelPlan(planId, { managerConfirmed: false });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('المدير');
    await cancelPlan(planId, { managerConfirmed: true });
    const after = await installmentsDue({ withinDays: 0 });
    expect(after.find((i) => i.planId === planId)).toBeUndefined();

    const planAfter = (await getPlan(planId))!;
    expect(planAfter.plan.status).toBe('cancelled');
  });
});

// ============ 8) إكمال الخطة ============

describe('installments: اكتمال الخطة عند سداد كل الأقساط', () => {
  test('آخر قسط → status=completed', async () => {
    const inv = (
      await saveSaleInvoice({
        items: [{ productId, qty: '2', unitPrice: '1000' }],
        payType: 'credit',
        customerId,
        warehouseId,
        currencyId: baseId,
      })
    ).invoiceId;
    const { planId } = await createInstallmentPlan({ invoiceId: inv, months: 2, firstDue: today });
    const full = await getPlan(planId);
    for (const inst of full!.installments) {
      await collectInstallment(inst.id, { cashboxId });
    }
    expect((await getPlan(planId))!.plan.status).toBe('completed');
  });
});
