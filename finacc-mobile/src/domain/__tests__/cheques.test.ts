import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { createCustomer, createSupplier, customerBalances, supplierBalances } from '@/domain/parties';
import { setDailyRate } from '@/domain/currency';
import { saveSaleInvoice } from '@/domain/invoicing';
import { savePurchaseInvoice } from '@/domain/purchasing';
import { setCurrentUserId } from '@/domain/session-user';
import { todayISO } from '@/utils/format';
import { dec } from '@/utils/money';
import {
  createCheque,
  listCheques,
  getCheque,
  markDeposited,
  markCleared,
  markBounced,
  voidCheque,
  dueSoonCheques,
} from '../cheques';

/**
 * اختبارات الوحدة 14 — الشيكات (FR-14-01..06 + AC-17):
 * الشيك قبل cleared لا يمس الصندوق ولا يخصم الدين؛ عند cleared: حركة صندوق
 * + تسوية (مع تخصيص للفاتورة أو FIFO) + فروق صرف للعملات المختلفة + audit.
 */

let baseId = 0;
let sarId = 0;
let warehouseId = 0;
let cashboxId = 0;
let productId = 0;
let customerId = 0;
let supplierId = 0;
let invoiceId = 0; // فاتورة آجلة 12,000 بعملة الأساس
let sarInvoiceId = 0; // فاتورة آجلة SAR 1,000 بسعر 530
let expenseCategoryId = 0;

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
    companyName: 'متجر الشيكات',
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
  const cat = await db.all<{ id: number }>("SELECT id FROM expense_category WHERE name = 'عام' LIMIT 1");
  expenseCategoryId = Number(cat[0]?.id ?? 0);

  productId = await createProduct({
    name: 'صنف الشيكات',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '1000' }],
    openingQty: '50',
  });
  customerId = await createCustomer({ name: 'أحمد سعيد' });
  supplierId = await createSupplier({ name: 'مؤسسة التوريد' });

  // فاتورة بيع آجلة 12,000 بعملة الأساس (12 × 1,000)
  const sale = await saveSaleInvoice({
    items: [{ productId, qty: '12', unitPrice: '1000' }],
    payType: 'credit',
    customerId,
    warehouseId,
    currencyId: baseId,
  });
  invoiceId = sale.invoiceId;

  // سعر SAR بالأمس 530 (لفاتورة آجلة SAR) واليوم 560 (لفروق الصرف — روح AC-18)
  await setDailyRate(sarId, daysFromISO(-1), '530');
  await setDailyRate(sarId, today, '560');
  const sarSale = await saveSaleInvoice({
    items: [{ productId, qty: '1', unitPrice: '1000' }],
    payType: 'credit',
    customerId,
    warehouseId,
    currencyId: sarId,
    issuedAt: daysFromISO(-1),
  });
  sarInvoiceId = sarSale.invoiceId;
});

afterAll(() => {
  setCurrentUserId(null); // نظافة حالة الجلسة المشتركة بين ملفات bun test
  disposeTestDb();
});

// ============ مساعدات ============

async function customerYerBalance(): Promise<string> {
  const balances = await customerBalances(customerId);
  return balances.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

async function cashTxCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ c: number }>(
    "SELECT count(*) AS c FROM cash_tx WHERE ref_type IN ('cheque','invoice','on_account') AND is_voided = 0",
  );
  return rows[0]?.c ?? 0;
}

async function auditCount(action: string, entityId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ c: number }>(
    'SELECT count(*) AS c FROM audit_log WHERE action = ? AND entity = ? AND entity_id = ?',
    [action, 'cheque', entityId],
  );
  return rows[0]?.c ?? 0;
}

// ============ 1) AC-17: دورة شيك وارد كاملة ============

describe('cheques: AC-17 — دورة كاملة (وارد ضد فاتورة آجلة)', () => {
  test('pending: لا أثر مطلقاً على الصندوق ولا على رصيد العميل', async () => {
    const before = await cashTxCount();
    const balanceBefore = await customerYerBalance(); // 12,000
    expect(balanceBefore).toBe('12000');

    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-1001',
      bankName: 'بنك التضامن',
      amount: '2000',
      currencyId: baseId,
      dueDate: daysFromISO(10),
      refInvoiceId: invoiceId,
      notes: 'شيك ضمان الفاتورة',
    });
    expect(id).toBeGreaterThan(0);

    const full = await getCheque(id);
    expect(full?.status).toBe('pending');
    expect(full?.partyName).toBe('أحمد سعيد');
    expect(full?.currencyCode).toBe('YER');
    expect(full?.refInvoiceNo).not.toBeNull();

    // لا حركة صندوق ولا خصم من الرصيد (FR-14-02)
    expect(await cashTxCount()).toBe(before);
    expect(await customerYerBalance()).toBe('12000');
  });

  test('deposited: ما زال بلا أي أثر مالي', async () => {
    const list = await listCheques({ status: 'pending' });
    const id = list[0]!.id;
    await markDeposited(id);
    const full = await getCheque(id);
    expect(full?.status).toBe('deposited');
    expect(await customerYerBalance()).toBe('12000');
    expect(await cashTxCount()).toBe(0);
  });

  test('cleared: سند قبض + تخصيص على الفاتورة + نقص الرصيد + audit', async () => {
    const list = await listCheques({ status: 'deposited' });
    const id = list[0]!.id;
    const { cashTxId } = await markCleared(id, { cashboxId });

    const full = await getCheque(id);
    expect(full?.status).toBe('cleared');
    expect(full?.clearedCashTxId).toBe(cashTxId);

    // سند قبض بعملة الشيك ومبلغه مربوط بالعميل
    const db = await getDb();
    const tx = await db.all<{ tx_type: string; amount: string; currency_id: number; customer_id: number; ref_type: string }>(
      'SELECT tx_type, amount, currency_id, customer_id, ref_type FROM cash_tx WHERE id = ?',
      [cashTxId],
    );
    expect(tx[0]?.tx_type).toBe('receipt');
    expect(String(tx[0]?.amount)).toBe('2000');
    expect(Number(tx[0]?.currency_id)).toBe(baseId);
    expect(Number(tx[0]?.customer_id)).toBe(customerId);
    expect(tx[0]?.ref_type).toBe('invoice');

    // تخصيص 2,000 على الفاتورة
    const alloc = await db.all<{ a: string }>(
      'SELECT COALESCE(SUM(allocated_amount), 0) AS a FROM payment_allocation WHERE invoice_id = ?',
      [invoiceId],
    );
    expect(String(alloc[0]?.a)).toBe('2000');

    // الرصيد نقص 2,000 (12,000 → 10,000)
    expect(await customerYerBalance()).toBe('10000');

    // قيد تدقيق (FR-14-03)
    expect(await auditCount('cheque_cleared', id)).toBe(1);
  });
});

// ============ 2) الارتداد (FR-14-04) ============

describe('cheques: الارتداد — بقاء الدين + مصروف رسم اختياري + audit', () => {
  test('شيك آخر يرتد بمصروف 500: الدين لم يُخصم أصلاً + مصروف مسجل + audit', async () => {
    const balanceBefore = await customerYerBalance(); // 10,000
    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-1002',
      amount: '1000',
      currencyId: baseId,
      dueDate: daysFromISO(5),
    });
    // قبل الارتداد: لا أثر
    expect(await customerYerBalance()).toBe(balanceBefore);

    await markBounced(id, {
      bounceFee: '500',
      expenseCategoryId,
      cashboxId,
    });

    const full = await getCheque(id);
    expect(full?.status).toBe('bounced');
    expect(full?.bouncedAt).not.toBeNull();
    expect(String(full?.bounceFee)).toBe('500');

    // الدين عاد/بقي كما هو (لم يُخصم أي شيء — الشيك قبل cleared ذمة فقط)
    expect(await customerYerBalance()).toBe(balanceBefore);

    // مصروف رسم الارتداد مسجل
    const db = await getDb();
    const fee = await db.all<{ tx_type: string; amount: string; expense_category_id: number; ref_type: string; ref_id: number }>(
      "SELECT tx_type, amount, expense_category_id, ref_type, ref_id FROM cash_tx WHERE tx_type = 'expense' AND ref_type = 'cheque' AND ref_id = ?",
      [id],
    );
    expect(fee).toHaveLength(1);
    expect(String(fee[0]?.amount)).toBe('500');
    expect(Number(fee[0]?.expense_category_id)).toBe(expenseCategoryId);

    expect(await auditCount('cheque_bounced', id)).toBe(1);
  });

  test('ارتداد بدون رسم: يُقبل ولا ينشئ مصروفاً', async () => {
    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-1003',
      amount: '700',
      currencyId: baseId,
      dueDate: daysFromISO(5),
    });
    await markBounced(id, {});
    const full = await getCheque(id);
    expect(full?.status).toBe('bounced');
    expect(String(full?.bounceFee)).toBe('0');
    const db = await getDb();
    const fee = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM cash_tx WHERE ref_type = 'cheque' AND ref_id = ? AND tx_type = 'expense'",
      [id],
    );
    expect(fee[0]?.c).toBe(0);
  });
});

// ============ 3) شيك صادر لمورّد ============

describe('cheques: شيك صادر لمورّد — سند صرف عند التحصيل', () => {
  test('cleared: payment من الصندوق + نقص رصيد المورّد', async () => {
    // فاتورة شراء آجلة 3,000
    const purchase = await savePurchaseInvoice({
      items: [{ productId, qty: '3', unitPrice: '1000' }],
      payType: 'credit',
      supplierId,
      warehouseId,
      currencyId: baseId,
    });
    const before = await supplierBalances(supplierId);
    expect(before.find((b) => b.currencyId === baseId)?.balance).toBe('3000');

    const id = await createCheque({
      direction: 'out',
      partyType: 'supplier',
      partyId: supplierId,
      chequeNo: 'CHK-2001',
      bankName: 'بنك القرض',
      amount: '3000',
      currencyId: baseId,
      dueDate: daysFromISO(3),
      refInvoiceId: purchase.invoiceId,
    });
    expect((await getCheque(id))?.status).toBe('pending');
    // لا أثر قبل التحصيل
    const mid = await supplierBalances(supplierId);
    expect(mid.find((b) => b.currencyId === baseId)?.balance).toBe('3000');

    const { cashTxId } = await markCleared(id, { cashboxId });
    const db = await getDb();
    const tx = await db.all<{ tx_type: string; amount: string; supplier_id: number }>(
      'SELECT tx_type, amount, supplier_id FROM cash_tx WHERE id = ?',
      [cashTxId],
    );
    expect(tx[0]?.tx_type).toBe('payment');
    expect(String(tx[0]?.amount)).toBe('3000');
    expect(Number(tx[0]?.supplier_id)).toBe(supplierId);

    const after = await supplierBalances(supplierId);
    expect(after.find((b) => b.currencyId === baseId)?.balance).toBe('0');
  });
});

// ============ 4) الإلغاء — مدير فقط (FR-14-06) ============

describe('cheques: void بموافقة المدير فقط', () => {
  test('بدون managerConfirmed → رفض عربي، ثم بالموافقة → void + audit', async () => {
    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-3001',
      amount: '400',
      currencyId: baseId,
      dueDate: daysFromISO(15),
    });
    let msg = '';
    try {
      await voidCheque(id, { managerConfirmed: false });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('المدير');
    expect((await getCheque(id))?.status).toBe('pending');

    await voidCheque(id, { managerConfirmed: true });
    const full = await getCheque(id);
    expect(full?.status).toBe('void');
    expect(await auditCount('cheque_void', id)).toBe(1);
  });
});

// ============ 5) المستحق قريباً (FR-14-05 للداشبورد) ============

describe('cheques: dueSoonCheques', () => {
  test('يعيد المعلق/المودَع المستحق خلال النافذة فقط', async () => {
    const nearId = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-4001',
      amount: '250',
      currencyId: baseId,
      dueDate: daysFromISO(3),
    });
    await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-4002',
      amount: '250',
      currencyId: baseId,
      dueDate: daysFromISO(40),
    });
    const rows = await dueSoonCheques(7);
    const nos = rows.map((r) => r.chequeNo);
    expect(nos).toContain('CHK-4001');
    expect(nos).not.toContain('CHK-4002');
    expect(rows.find((r) => r.id === nearId)?.partyName).toBe('أحمد سعيد');
  });
});

// ============ 6) فروق الصرف (روح AC-18) ============

describe('cheques: فروق الصرف عند التسوية بعملة مختلفة', () => {
  test('دين SAR 1,000 بسعر 530 يُسدّى بشيك YER 560,000 بسعر اليوم 560 → ربح 30,000', async () => {
    // رصيد SAR قبل: 1,000
    const before = await customerBalances(customerId);
    expect(before.find((b) => b.currencyId === sarId)?.balance).toBe('1000');

    // قرار 8: أرصدة لكل عملة على حدة — الفرق (30,000) ذهب إلى fx_gain_loss
    // ولم يُدفن في رصيد: دين SAR لا يزال مسجلاً بدولته والقبض مسجل باليمني.
    const yerBefore = await customerYerBalance();
    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-5001',
      amount: '560000',
      currencyId: baseId,
      dueDate: today,
      refInvoiceId: sarInvoiceId,
    });
    const { cashTxId } = await markCleared(id, { cashboxId });

    // fx_gain_loss = القيمة بالأساس اليوم − الدين المسدد بسعر الفاتورة الأصلي
    // = 560,000×1 − 1,000×530 = 30,000
    const db = await getDb();
    const tx = await db.all<{ fx_gain_loss: string; settlement_rate: string | null; amount: string }>(
      'SELECT fx_gain_loss, settlement_rate, amount FROM cash_tx WHERE id = ?',
      [cashTxId],
    );
    expect(dec(tx[0]?.fx_gain_loss ?? '0').toFixed(4)).toBe('30000.0000');
    expect(tx[0]?.settlement_rate).not.toBeNull();

    // التخصيص على فاتورة SAR = 560,000 / 560 = 1,000 SAR (سُدّي الدين بالكامل)
    const alloc = await db.all<{ a: string }>(
      'SELECT COALESCE(SUM(allocated_amount), 0) AS a FROM payment_allocation WHERE invoice_id = ?',
      [sarInvoiceId],
    );
    expect(String(alloc[0]?.a)).toBe('1000');

    // قرار 8: أرصدة لكل عملة على حدة — الفرق (30,000) ذهب إلى fx_gain_loss
    // ولم يُدفن في رصيد: دين SAR لا يزال مسجلاً بدولته والقبض مسجل باليمني.
    const after = await customerBalances(customerId);
    expect(after.find((b) => b.currencyId === sarId)?.balance).toBe('1000');
    // القبض باليمني نقص رصيد اليمني بالضبط بقيمته (560,000)
    expect(dec(await customerYerBalance()).minus(dec(yerBefore)).toFixed(0)).toBe('-560000');
  });
});

// ============ 7) FIFO بدون فاتورة مرجعية (on_account) ============

describe('cheques: شيك بلا مرجع — تخصيص FIFO على الأقدم', () => {
  test('يخصم من أقدم فاتورة مفتوحة بنفس العملة حتى يستنفد', async () => {
    const before = await customerYerBalance();
    const id = await createCheque({
      direction: 'in',
      partyType: 'customer',
      partyId: customerId,
      chequeNo: 'CHK-6001',
      amount: '5000',
      currencyId: baseId,
      dueDate: daysFromISO(1),
    });
    const { cashTxId } = await markCleared(id, { cashboxId });
    const db = await getDb();
    const tx = await db.all<{ ref_type: string }>('SELECT ref_type FROM cash_tx WHERE id = ?', [cashTxId]);
    expect(tx[0]?.ref_type).toBe('on_account');

    // الفاتورة الأصلية (INV الأولى) كان مفتوحاً عليها 10,000 (بعد شيك AC-17) → خص 5,000
    const alloc = await db.all<{ a: string }>(
      'SELECT COALESCE(SUM(allocated_amount), 0) AS a FROM payment_allocation WHERE invoice_id = ?',
      [invoiceId],
    );
    expect(String(alloc[0]?.a)).toBe('7000');

    // الرصيد نقص بقيمة الشيك كاملة (5,000)
    expect(dec(await customerYerBalance()).minus(dec(before)).toFixed(0)).toBe('-5000');
  });
});

// ============ 8) فحوصات الإدخال ============

describe('cheques: فحوصات الإدخال والحماية', () => {
  test('شيك بمبلغ أكبر من المتاح بالفاتورة المرجعية → رفض', async () => {
    let msg = '';
    try {
      await createCheque({
        direction: 'in',
        partyType: 'customer',
        partyId: customerId,
        chequeNo: 'CHK-7001',
        amount: '99999',
        currencyId: baseId,
        dueDate: today,
        refInvoiceId: invoiceId,
      });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg.length).toBeGreaterThan(0);
  });

  test('تحصيل شيك cleared مسبقاً → رفض', async () => {
    const list = await listCheques({ status: 'cleared' });
    const id = list[0]!.id;
    let msg = '';
    try {
      await markCleared(id, { cashboxId });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg.length).toBeGreaterThan(0);
  });

  test('القائمة مرتبة بالاستحقاق وتحمل أسماء الأطراف والعملة', async () => {
    const rows = await listCheques({ limit: 100 });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.dueDate >= rows[i - 1]!.dueDate).toBe(true);
    }
    expect(rows.every((r) => r.partyName.length > 0 && r.currencyCode.length > 0)).toBe(true);
  });
});
