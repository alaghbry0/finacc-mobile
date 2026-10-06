import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { createCustomer, customerBalances } from '@/domain/parties';
import { setCurrentUserId } from '@/domain/session-user';
import { saveSaleInvoice } from '@/domain/invoicing';
import { setDailyRate } from '@/domain/currency';
import { todayISO } from '@/utils/format';
import { dec } from '@/utils/money';
import {
  createCashTx,
  listCashTx,
  cashboxBalances,
  cashboxBalance,
  voidCashTx,
  consumeVoucherNo,
  openShift,
  shiftExpected,
  closeShift,
  currentShift,
  lastShift,
  listExpenseCategories,
  customerOpenInvoices,
  type CashTxResult,
} from '../cash';

/**
 * اختبارات وحدة النقدية (FR-04 + قرارات 8/9 + قاعدة 5.4-6):
 * الصناديق وأرصدتها بعملاتها • القبض على فاتورة/على الحساب FIFO • المصروف
 * والمسحوبة • التحويل بين عملتين بفروق الصرف • الإلغاء بالحركة المعاكسة •
 * الوردية بالمعادلة الشاملة • السند المرقّم مرة واحدة • السالب مسموح.
 *
 * ترتيب مقصود (قاعدة واحدة مشتركة): كل النشاط قبل الوردية مؤرَّخ 5 أيام
 * رجوعاً (PAST) حتى تكون نافذة الوردية (اليوم) نظيفة تماماً من أثره —
 * دقة tx_date يومية وهذا هو النمط الحقيقي للاستخدام (وردية اليوم تبدأ
 * بنشاط اليوم).
 */

function daysAgoISO(days: number): string {
  const [y, m, d] = todayISO().split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const PAST = daysAgoISO(5);
const PAST_YEAR = PAST.slice(0, 4);

let baseId = 0;
let sarId = 0;
let warehouseId = 0;
let cashboxId = 0;
let sarCashboxId = 0;
let sideCashboxId = 0;
let shampooId = 0;
let customerId = 0;
let salariesCategoryId = 0;

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
  warehouseId = Number(warehouse[0]!.id);
  const cashbox = await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1');
  cashboxId = Number(cashbox[0]!.id);

  // صندوقان إضافيان: SAR (للتحويل بين عملتين) + YER فرعي (للتحويل بعملة واحدة)
  const now = new Date().toISOString();
  const sarBox = await db.run('INSERT INTO cashbox(name, currency_id, is_default, is_archived, created_at) VALUES(?, ?, 0, 0, ?)', [
    'صندوق الريال السعودي',
    sarId,
    now,
  ]);
  sarCashboxId = Number(sarBox.lastInsertRowId);
  const sideBox = await db.run('INSERT INTO cashbox(name, currency_id, is_default, is_archived, created_at) VALUES(?, ?, 0, 0, ?)', [
    'صندوق فرعي',
    baseId,
    now,
  ]);
  sideCashboxId = Number(sideBox.lastInsertRowId);

  // سعر SAR ليوم التحويل المؤرَّخ (قرار 3: بلا سعر لا حفظ)
  await setDailyRate(sarId, PAST, '250');

  shampooId = await createProduct({
    name: 'شامبو',
    costPrice: '100',
    prices: [{ currencyId: baseId, price: '500' }],
    openingQty: '50',
  });
  customerId = await createCustomer({ name: 'أحمد سعيد' });

  const cats = await listExpenseCategories();
  salariesCategoryId = cats.find((c) => c.name === 'رواتب')?.id ?? cats[0]!.id;
});

afterAll(() => {
  // مهم: تصفير هوية الجلسة العالمية — completeOnboarding تضبطها والملفات اللاحقة
  // (auth/currency) تفترضها null وإلا تسربت بين ملفات bun المتتابعة
  setCurrentUserId(null);
  disposeTestDb();
});

// ============ مساعدات ============

async function customerYerBalance(): Promise<string> {
  const balances = await customerBalances(customerId);
  return balances.find((b) => b.currencyId === baseId)?.balance ?? '0';
}

async function txRow(id: number) {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>('SELECT * FROM cash_tx WHERE id = ?', [id]);
  return rows[0];
}

function creditInvoice(issuedAt: string, qty = '2') {
  return saveSaleInvoice({
    items: [{ productId: shampooId, qty, unitPrice: '500' }],
    payType: 'credit',
    customerId,
    warehouseId,
    currencyId: baseId,
    issuedAt,
  });
}

// ============ 1) قبض تحصيل على فاتورة محددة ============

test('1) قبض على فاتورة محددة: رصيد العميل نقص + الصندوق زاد + تخصيص', async () => {
  const inv = await creditInvoice(PAST);
  expect(inv.total).toBe('1000');
  expect(inv.dueAmount).toBe('1000');
  expect(await customerYerBalance()).toBe('1000');

  const balBefore = dec(await cashboxBalance(cashboxId));
  const r: CashTxResult = await createCashTx({
    txType: 'receipt',
    cashboxId,
    currencyId: baseId,
    amount: '1000',
    customerId,
    refType: 'invoice',
    refId: inv.invoiceId,
    txDate: PAST,
  });
  expect(r.voucherNo).toBeNull(); // لا رقم عند الإنشاء — فقط عند الطباعة (FR-04-10)

  expect(await customerYerBalance()).toBe('0');
  expect(await cashboxBalance(cashboxId)).toBe(balBefore.plus(1000).toString());

  // تخصيص كامل للفاتورة المحددة
  const db = await getDb();
  const allocs = await db.all<{ invoice_id: number; allocated_amount: string }>(
    'SELECT invoice_id, allocated_amount FROM payment_allocation WHERE cash_tx_id = ?',
    [r.id],
  );
  expect(allocs).toHaveLength(1);
  expect(Number(allocs[0]!.invoice_id)).toBe(inv.invoiceId);
  expect(String(allocs[0]!.allocated_amount)).toBe('1000');

  // الدفع الزائد على فاتورة مسددة يُرفض برسالة تسمّي المتبقي
  await expect(
    createCashTx({
      txType: 'receipt',
      cashboxId,
      currencyId: baseId,
      amount: '500',
      customerId,
      refType: 'invoice',
      refId: inv.invoiceId,
      txDate: PAST,
    }),
  ).rejects.toThrow('يتجاوز المتبقي');
});

// ============ 2) قبض حر on_account → FIFO (قاعدة 5.4-6) ============

test('2) قبض حر أكبر من فاتورتين آجلتين: FIFO للأقدم أولاً والباقي رصيد دائن', async () => {
  const inv2 = await creditInvoice(PAST); // الأقدم (بعد فاتورة الاختبار 1 المسددة)
  const inv3 = await creditInvoice(PAST);
  expect(await customerYerBalance()).toBe('2000');

  const r = await createCashTx({
    txType: 'receipt',
    cashboxId,
    currencyId: baseId,
    amount: '2500',
    customerId, // بلا refType → on_account افتراضياً + FIFO
    txDate: PAST,
  });

  // التخصيص: الأقدم أولاً حتى النفاد — 1000 + 1000 والباقي 500 غير مخصص
  const db = await getDb();
  const allocs = await db.all<{ invoice_id: number; allocated_amount: string }>(
    'SELECT invoice_id, allocated_amount FROM payment_allocation WHERE cash_tx_id = ? ORDER BY invoice_id ASC',
    [r.id],
  );
  expect(allocs).toHaveLength(2);
  expect(Number(allocs[0]!.invoice_id)).toBe(inv2.invoiceId);
  expect(String(allocs[0]!.allocated_amount)).toBe('1000');
  expect(Number(allocs[1]!.invoice_id)).toBe(inv3.invoiceId);
  expect(String(allocs[1]!.allocated_amount)).toBe('1000');

  // رصيد العميل دائن بالمتبقي (سالب — FR-09-14)
  expect(await customerYerBalance()).toBe('-500');
  // لا فواتير مفتوحة بعد (كلها مخصصة بالكامل)
  expect(await customerOpenInvoices(customerId)).toHaveLength(0);
});

// ============ 3) مصروف بفئة + مسحوبة مالك ============

test('3) مصروف بفئة → الصندوق نقص، ومسحوبة المالك نقص وليست مصروفاً', async () => {
  expect(salariesCategoryId).toBeGreaterThan(0);

  const balBefore = dec(await cashboxBalance(cashboxId));
  const exp = await createCashTx({
    txType: 'expense',
    cashboxId,
    currencyId: baseId,
    amount: '200',
    expenseCategoryId: salariesCategoryId,
    description: 'راتق الحارس',
    txDate: PAST,
  });
  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(200).toString());
  const expRow = await txRow(exp.id);
  expect(String(expRow!.tx_type)).toBe('expense');
  expect(Number(expRow!.expense_category_id)).toBe(salariesCategoryId);

  // المصروف بلا فئة يُرفض (FR-04-03)
  await expect(
    createCashTx({ txType: 'expense', cashboxId, currencyId: baseId, amount: '10', txDate: PAST }),
  ).rejects.toThrow('فئة');

  const balAfterExpense = dec(await cashboxBalance(cashboxId));
  const draw = await createCashTx({
    txType: 'owner_draw',
    cashboxId,
    currencyId: baseId,
    amount: '500',
    description: 'مسحوبة شخصية',
    txDate: PAST,
  });
  expect(await cashboxBalance(cashboxId)).toBe(balAfterExpense.minus(500).toString());
  const drawRow = await txRow(draw.id);
  expect(String(drawRow!.tx_type)).toBe('owner_draw');
  expect(drawRow!.expense_category_id).toBeNull(); // ليست مصروفاً — بند مستقل في الأرباح (FR-09-02)
});

// ============ 4) تحويل بين صندوقين بعملتين (قرار 8 / FR-04-07) ============

test('4) تحويل YER→SAR: حركتان + settlement_rate + fx_gain_loss + تحويل بعملة واحدة بساق واحدة', async () => {
  const balBefore = dec(await cashboxBalance(cashboxId));

  // (أ) تحويل 10,000 يمني إلى صندوق SAR بسعر اليوم (250) — المبلغ المحوّل محسوب
  const t1 = await createCashTx({
    txType: 'box_transfer',
    cashboxId,
    toCashboxId: sarCashboxId,
    currencyId: baseId,
    amount: '10000',
    txDate: PAST,
  });
  const db = await getDb();
  const legs1 = await db.all<Record<string, unknown>>(
    "SELECT * FROM cash_tx WHERE ref_type = 'transfer' AND ref_id = ? ORDER BY id ASC",
    [t1.id],
  );
  expect(legs1).toHaveLength(2);
  const srcLeg = legs1[0]!;
  const dstLeg = legs1[1]!;
  expect(String(srcLeg.tx_type)).toBe('box_transfer');
  expect(Number(srcLeg.cashbox_id)).toBe(cashboxId);
  expect(Number(srcLeg.to_cashbox_id)).toBe(sarCashboxId);
  expect(Number(srcLeg.currency_id)).toBe(baseId);
  expect(String(srcLeg.amount)).toBe('10000');
  expect(String(srcLeg.exchange_rate)).toBe('1');
  expect(Number(dstLeg.currency_id)).toBe(sarId);
  expect(String(dstLeg.amount)).toBe('40'); // 10,000 × 1 / 250
  expect(String(dstLeg.settlement_rate)).toBe('250');
  expect(String(dstLeg.fx_gain_loss)).toBe('0'); // بالمبلغ المحسوب لا فرق

  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(10000).toString());
  expect(await cashboxBalance(sarCashboxId)).toBe('40');

  // (ب) تحويل بمبلغ مستلم فعلي (فرق صرف حقيقي): 1,000 يمني استُلم 3.5 SAR
  const t2 = await createCashTx({
    txType: 'box_transfer',
    cashboxId,
    toCashboxId: sarCashboxId,
    currencyId: baseId,
    amount: '1000',
    toAmount: '3.5',
    txDate: PAST,
  });
  const legs2 = await db.all<Record<string, unknown>>(
    "SELECT * FROM cash_tx WHERE ref_type = 'transfer' AND ref_id = ? ORDER BY id ASC",
    [t2.id],
  );
  expect(legs2).toHaveLength(2);
  const dst2 = legs2[1]!;
  expect(String(dst2.amount)).toBe('3.5');
  expect(String(dst2.settlement_rate)).toBe('250');
  // فرق الصرف بقيمة الأساس: 3.5×250 − 1000×1 = −125 (خسارة)
  expect(String(dst2.fx_gain_loss)).toBe('-125');

  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(11000).toString());
  expect(await cashboxBalance(sarCashboxId)).toBe('43.5');

  // (ج) تحويل بعملة واحدة = ساق واحدة تكفي الطرفين
  const t3 = await createCashTx({
    txType: 'box_transfer',
    cashboxId,
    toCashboxId: sideCashboxId,
    currencyId: baseId,
    amount: '200',
    txDate: PAST,
  });
  const legs3 = await db.all<Record<string, unknown>>(
    "SELECT * FROM cash_tx WHERE ref_type = 'transfer' AND ref_id = ?",
    [t3.id],
  );
  expect(legs3).toHaveLength(1);
  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(11200).toString());
  expect(await cashboxBalance(sideCashboxId)).toBe('200');

  // أرصدة كل الصناديق بعملاتها (FR-04-06) + قائمة الحركات بأسماء الأطراف وعلم fx
  const balances = await cashboxBalances();
  const main = balances.find((b) => b.id === cashboxId)!;
  const sar = balances.find((b) => b.id === sarCashboxId)!;
  const side = balances.find((b) => b.id === sideCashboxId)!;
  expect(main.currencyCode).toBe('YER');
  expect(main.balance).toBe(balBefore.minus(11200).toString());
  expect(sar.currencyCode).toBe('SAR');
  expect(sar.balance).toBe('43.5');
  expect(side.balance).toBe('200');

  const txs = await listCashTx({ cashboxId: sarCashboxId });
  expect(txs.length).toBeGreaterThanOrEqual(2); // الساقان الواردتان لصندوق SAR
  const fxRow = txs.find((t) => t.id === Number(dst2.id))!;
  expect(fxRow.hasFx).toBe(true);
  expect(fxRow.fxGainLoss).toBe('-125');
  expect(fxRow.direction).toBe('transfer');
});

// ============ 7) السند المرقّم — يُستهلك عند الطباعة الأولى فقط ============

let voucherReceiptId = 0;

test('7) consumeVoucherNo: مرتان نفس الرقم + حركة جديدة برقم متسلسل + PMT لغير القبض', async () => {
  const r1 = await createCashTx({
    txType: 'receipt',
    cashboxId,
    currencyId: baseId,
    amount: '100',
    customerId,
    txDate: PAST, // on_account افتراضياً
  });
  voucherReceiptId = r1.id;

  const first = await consumeVoucherNo(r1.id);
  expect(first).toBe(`RVT-${PAST_YEAR}-00001`);
  const again = await consumeVoucherNo(r1.id);
  expect(again).toBe(first); // لا استهلاك مزدوج أبداً (FR-04-10)

  const r2 = await createCashTx({
    txType: 'receipt',
    cashboxId,
    currencyId: baseId,
    amount: '200',
    customerId,
    txDate: PAST,
  });
  expect(await consumeVoucherNo(r2.id)).toBe(`RVT-${PAST_YEAR}-00002`);

  // غير القبض → PMT
  const exp = await createCashTx({
    txType: 'expense',
    cashboxId,
    currencyId: baseId,
    amount: '50',
    expenseCategoryId: salariesCategoryId,
    txDate: PAST,
  });
  expect(await consumeVoucherNo(exp.id)).toBe(`PMT-${PAST_YEAR}-00001`);

  // الرقم يظهر في الحركة والقائمة
  const row = await txRow(r1.id);
  expect(String(row!.voucher_no)).toBe(first);
  const listed = await listCashTx({});
  expect(listed.find((t) => t.id === r1.id)!.voucherNo).toBe(first);
});

// ============ 5) الإلغاء — حركة معاكسة (FR-04-08) ============

test('5) voidCashTx: معاكسة + is_voided + أثرها زال من رصيد الصندوق وحساب العميل', async () => {
  // بلا صلاحية مدير → رفض
  await expect(voidCashTx(voucherReceiptId, { managerConfirmed: false })).rejects.toThrow('صلاحية المدير');

  const balBefore = dec(await cashboxBalance(cashboxId));
  const customerBefore = await customerYerBalance(); // -500

  // (أ) إلغاء سند القبض الحر (100) من الاختبار 7
  await voidCashTx(voucherReceiptId, { managerConfirmed: true, reason: 'خطأ في المبلغ' });
  const voidedRow = await txRow(voucherReceiptId);
  expect(Number(voidedRow!.is_voided)).toBe(1);

  const db = await getDb();
  const reversals = await db.all<Record<string, unknown>>(
    'SELECT * FROM cash_tx WHERE reversal_of = ?',
    [voucherReceiptId],
  );
  expect(reversals).toHaveLength(1);
  const rev = reversals[0]!;
  expect(String(rev.tx_type)).toBe('payment'); // عكس القبض صرف
  expect(String(rev.amount)).toBe('100');
  expect(Number(rev.is_voided)).toBe(0);

  // الأثر زال من الرصيدين (الزوج مستبعد من الحساب — لا ازدواج خصم عبر المعاكسة)
  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(100).toString());
  expect(await customerYerBalance()).toBe(dec(customerBefore).plus(100).toString()); // -400

  // إلغاء مزدوج → رفض
  await expect(voidCashTx(voucherReceiptId, { managerConfirmed: true })).rejects.toThrow('ملغاة مسبقاً');
  // سند لحركة ملغاة → رفض الطباعة
  await expect(consumeVoucherNo(voucherReceiptId)).rejects.toThrow('ملغاة');

  // (ب) إلغاء مسحوبة مالك (بلا طرف) — عكسها capital_in
  const draw = await createCashTx({ txType: 'owner_draw', cashboxId, currencyId: baseId, amount: '700', txDate: PAST });
  const afterDraw = dec(await cashboxBalance(cashboxId));
  await voidCashTx(draw.id, { managerConfirmed: true });
  expect(await cashboxBalance(cashboxId)).toBe(afterDraw.plus(700).toString());
  const drawRev = await db.all<Record<string, unknown>>('SELECT * FROM cash_tx WHERE reversal_of = ?', [draw.id]);
  expect(String(drawRev[0]!.tx_type)).toBe('capital_in');

  // (ج) الحركة المرتبطة بمستند فاتورة → تُلغى من مستندها فقط (رفض هنا)
  const cashSale = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '1', unitPrice: '300' }],
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: baseId,
    issuedAt: PAST,
  });
  const saleTx = await db.all<{ id: number }>(
    "SELECT id FROM cash_tx WHERE ref_type = 'invoice' AND ref_id = ? AND is_voided = 0",
    [cashSale.invoiceId],
  );
  expect(saleTx).toHaveLength(1);
  await expect(voidCashTx(Number(saleTx[0]!.id), { managerConfirmed: true })).rejects.toThrow('مرتبطة بمستند');

  // (د) إلغاء تحويل يبطل ساقيه معاً
  const tr = await createCashTx({
    txType: 'box_transfer',
    cashboxId,
    toCashboxId: sideCashboxId,
    currencyId: baseId,
    amount: '50',
    txDate: PAST,
  });
  const boxBefore = dec(await cashboxBalance(cashboxId));
  const sideBefore = dec(await cashboxBalance(sideCashboxId));
  await voidCashTx(tr.id, { managerConfirmed: true });
  expect(await cashboxBalance(cashboxId)).toBe(boxBefore.plus(50).toString());
  expect(await cashboxBalance(sideCashboxId)).toBe(sideBefore.minus(50).toString());
  const trLegs = await db.all<{ is_voided: number }>(
    "SELECT is_voided FROM cash_tx WHERE ref_type = 'transfer' AND ref_id = ? AND reversal_of IS NULL",
    [tr.id],
  );
  expect(trLegs.every((l) => Number(l.is_voided) === 1)).toBe(true);
});

// ============ 8) الرصيد السالب مسموح (قرار 9) ============

test('8) صرف أكبر من الرصيد ينجح — الرصيد السالب يعود كما هو', async () => {
  const balBefore = dec(await cashboxBalance(cashboxId));
  const huge = balBefore.plus(5000000).toString();
  const r = await createCashTx({
    txType: 'expense',
    cashboxId,
    currencyId: baseId,
    amount: '5000000',
    expenseCategoryId: salariesCategoryId,
    description: 'صرف استثنائي أكبر من الرصيد',
    txDate: PAST,
  });
  // لا خطأ أبداً — والدالة تعيد الرصيد الجديد لتُحذِّر الواجهة (قرار 9)
  expect(dec(r.newBalance).isNegative()).toBe(true);
  expect(await cashboxBalance(cashboxId)).toBe(balBefore.minus(5000000).toString());
});

// ============ 6) الوردية — المعادلة الشاملة (قرار 9 / FR-04-04) ============

test('6) الوردية: فتح → مبيعات نقدي + مصروف + مسحوبة → إقفال بالعد والفرق يسجل', async () => {
  expect(await currentShift(cashboxId)).toBeNull();

  const shiftId = await openShift(cashboxId, '0');
  expect(shiftId).toBeGreaterThan(0);

  // وردية ثانية على نفس الصندوق → رفض
  await expect(openShift(cashboxId, '0')).rejects.toThrow('مفتوحة بالفعل');

  // نشاط النافذة (اليوم): بيع نقدي 300 + مصروف 50 + مسحوبة 30
  const sale = await saveSaleInvoice({
    items: [{ productId: shampooId, qty: '2', unitPrice: '150' }],
    payType: 'cash',
    cashboxId,
    warehouseId,
    currencyId: baseId, // اليوم
  });
  expect(sale.total).toBe('300');
  await createCashTx({ txType: 'expense', cashboxId, currencyId: baseId, amount: '50', expenseCategoryId: salariesCategoryId });
  await createCashTx({ txType: 'owner_draw', cashboxId, currencyId: baseId, amount: '30' });

  const summary = await shiftExpected(cashboxId, (await currentShift(cashboxId))!.openedAt);
  expect(summary.expectedIn).toBe('300'); // القبض النقدي للفاتورة
  expect(summary.expectedOut).toBe('80'); // 50 مصروف + 30 مسحوبة
  expect(summary.expected).toBe('220'); // الوارد − الصادر

  const open = await currentShift(cashboxId);
  expect(open!.id).toBe(shiftId);
  expect(open!.closedAt).toBeNull();

  // إقفال بعدّ فعلي 200 → عجز 20 (الفرق = العد − [الافتتاحي + المتوقع])
  const res = await closeShift(shiftId, '200', 'عدّ يدوي');
  expect(res.expected).toBe('220');
  expect(res.difference).toBe('-20');

  const closed = await lastShift(cashboxId);
  expect(closed!.id).toBe(shiftId);
  expect(closed!.expected).toBe('220');
  expect(closed!.counted).toBe('200');
  expect(closed!.difference).toBe('-20');
  expect(closed!.notes).toBe('عدّ يدوي');
  expect(closed!.closedAt).not.toBeNull();
  expect(await currentShift(cashboxId)).toBeNull();

  // إقفال مرتين → رفض
  await expect(closeShift(shiftId, '200')).rejects.toThrow('مقفلة مسبقاً');
});
