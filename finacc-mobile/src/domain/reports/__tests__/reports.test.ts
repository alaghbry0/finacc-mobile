import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { createProduct } from '@/domain/inventory';
import { createCustomer } from '@/domain/parties';
import { saveSaleInvoice, getSaleInvoice } from '@/domain/invoicing';
import { createSaleReturn } from '@/domain/returns';
import { createCashTx } from '@/domain/cash';
import { setCurrentUserId } from '@/domain/session-user';
import { todayISO } from '@/utils/format';
import { dec } from '@/utils/money';
import { profitLoss } from '../profit-loss';
import { getDashboard } from '../dashboard';
import { salesByCustomer, salesByProduct, salesByDay } from '../sales-reports';
import { debtAging } from '../aging';
import { productCard, stockSummary } from '../stock-card';
import { startStocktake, setCountedLine, applyStocktake, stocktakeLines } from '@/domain/stocktake';

/**
 * سيناريو التقارير الكامل (الموجة 6-a): بيع نقدي وآجل + مرتجع + مصروف + مسحوبة
 * + جرد بفروق — ثم التحقق الرقمي من قائمة الأرباح (قرار 7 حرفياً) وأعمار الديون
 * (FIFO) والداشبورد وبطاقة الصنف وملخص المخزون.
 *
 * سيناريو الأرقام (العملة الأساس YER بسعر 1، صنف بتكلفة 0.6 وسعر 1):
 *   بيع نقدي اليوم 10 وحدات + آجل 5 (قبل 35 يوماً) + آجل 3 (قبل 10 أيام)
 *   مرتجع 2 • مصروف 1 • مسحوبة 5 • جرد نقص 1 وحدة
 *
 * الملاحظة المحاسبية الموثقة: حركات المخزون تُرحَّل بتاريخ الحفظ الفعلي
 * (moved_at) لا بتاريخ الفاتورة المؤرَّخ رجعياً — فـ COGS «اليوم» يشمل حركات
 * الفواتير المؤرَّخة، بينما «مبيعات اليوم» من issued_at وحده. هذا سلوك
 * الدومين القائم (موجة 4) والتقارير تعكسه بأمانة.
 */

let baseId = 0;
let warehouseId = 0;
let cashboxId = 0;
let salaryCatId = 0;
let productId = 0;
let customerId = 0;

const today = todayISO();

function daysFromISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

beforeAll(async () => {
  await createTestDb();
  setCurrentUserId(1);
  await completeOnboarding({
    companyName: 'متجر التقارير',
    baseCurrencyCode: 'YER',
    pinHash: 'pbkdf2$100000$dGVzdA$dGVzdA',
  });
  const db = await getDb();
  const cur = await db.all<{ id: number; code: string }>('SELECT id, code FROM currency');
  baseId = Number(cur.find((c) => c.code === 'YER')?.id ?? 0);
  warehouseId = Number((await db.all<{ id: number }>('SELECT id FROM warehouse ORDER BY id LIMIT 1'))[0]?.id ?? 0);
  cashboxId = Number((await db.all<{ id: number }>('SELECT id FROM cashbox ORDER BY id LIMIT 1'))[0]?.id ?? 0);
  salaryCatId = Number(
    (await db.all<{ id: number; name: string }>("SELECT id, name FROM expense_category WHERE name = 'رواتب' LIMIT 1"))[0]?.id ?? 0,
  );

  productId = await createProduct({
    name: 'صنف التقارير',
    costPrice: '0.6',
    prices: [{ currencyId: baseId, price: '1' }],
    openingQty: '20',
  });
  customerId = await createCustomer({ name: 'عميل الأعمار' });
});

afterAll(() => {
  setCurrentUserId(null);
  disposeTestDb();
});

// ============ السيناريو المتسلسل ============

describe('reports: السيناريو الكامل', () => {
  let cashSaleId = 0;
  let oldInvoiceId = 0;
  let recentInvoiceId = 0;
  let stocktakeId = 0;

  test('بيع نقدي 10 (تكلفة 6) + مرتجع 2 + مصروف 1 + مسحوبة 5', async () => {
    const sale = await saveSaleInvoice({
      items: [{ productId, qty: '10', unitPrice: '1' }],
      payType: 'cash',
      cashboxId,
      warehouseId,
      currencyId: baseId,
    });
    cashSaleId = sale.invoiceId;
    expect(sale.total).toBe('10');

    const items = (await getSaleInvoice(cashSaleId))!.items;
    await createSaleReturn({
      originalInvoiceId: cashSaleId,
      lines: [{ itemId: items[0]!.id, qty: '2' }],
      direction: 'cash',
      cashboxId,
    });

    await createCashTx({
      txType: 'expense',
      cashboxId,
      currencyId: baseId,
      amount: '1',
      expenseCategoryId: salaryCatId,
      description: 'مصروف اختبار',
    });
    await createCashTx({
      txType: 'owner_draw',
      cashboxId,
      currencyId: baseId,
      amount: '5',
      description: 'مسحوبة اختبار',
    });
  });

  test('فواتير آجلة للأعمار: 35 يوماً (5) و10 أيام (3) + قبض حر 3 يُخصص FIFO للأقدم', async () => {
    const old = await saveSaleInvoice({
      items: [{ productId, qty: '5', unitPrice: '1' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
      issuedAt: daysFromISO(-35),
      managerConfirmedBackdate: true,
    });
    oldInvoiceId = old.invoiceId;

    const recent = await saveSaleInvoice({
      items: [{ productId, qty: '3', unitPrice: '1' }],
      payType: 'credit',
      customerId,
      warehouseId,
      currencyId: baseId,
      issuedAt: daysFromISO(-10),
    });
    recentInvoiceId = recent.invoiceId;

    // قبض على الحساب 3 → FIFO يخصم من فاتورة الـ35 يوماً أولاً
    await createCashTx({
      txType: 'receipt',
      cashboxId,
      currencyId: baseId,
      amount: '3',
      customerId,
      refType: 'on_account',
    });
    expect(oldInvoiceId).toBeGreaterThan(0);
    expect(recentInvoiceId).toBeGreaterThan(0);
  });

  test('جرد نقص 1 وحدة (الرصيد الدفتري 4 → 3 فعلي) بتكلفة لقطة 0.6', async () => {
    stocktakeId = await startStocktake(warehouseId, 'جرد سيناريو التقارير');
    // الرصيد بعد الافتتاحية 20 والبيع 10 والمرتجع 2 والآجلين 5+3 → الدفتري 4
    await setCountedLine(stocktakeId, productId, '3');
    const res = await applyStocktake(stocktakeId, {});
    expect(res.adjustments).toBe(1);
  });

  // ============ قائمة الأرباح (قرار 7 — FR-09-02) ============

  test('P&L للفترة الكاملة: كل البنود بالصيغة الملزمة', async () => {
    const from = daysFromISO(-40);
    const pl = await profitLoss({ dateFrom: from, dateTo: today });

    // المبيعات = 10 + 5 + 3 = 18 (بالأساس) والمرتجع = 2
    expect(pl.sales).toBe('18');
    expect(pl.salesReturns).toBe('2');

    // COGS من حركات البيع (18 وحدة × 0.6) ومرتجعها (2 × 0.6)
    expect(pl.cogs).toBe('10.8');
    expect(pl.cogsReturned).toBe('1.2');

    // عجز الجرد = 1 وحدة × 0.6 (تكلفة اللقطة)
    expect(pl.stocktakeLosses).toBe('0.6');
    expect(pl.stocktakeGains).toBe('0');

    // المصاريف والمسحوبات (AC-19: مستقلة صراحة)
    expect(pl.expenses).toBe('1');
    expect(pl.ownerDraws).toBe('5');
    expect(pl.expensesByCategory.length).toBe(1);
    expect(pl.expensesByCategory[0]!.name).toBe('رواتب');
    expect(pl.expensesByCategory[0]!.amount).toBe('1');

    // الصيغة: (18−2) − (10.8−1.2) + 0 − 0.6 ± 0 = 5.8 ثم − 1 مصاريف = 4.8
    expect(pl.grossProfit).toBe('5.8');
    expect(pl.netProfit).toBe('4.8');
    expect(pl.fxGainLoss).toBe('0');

    // صافي ما بقي للمالك = 4.8 − 5 = −0.2 (سالب — المسحوبات أكبر من الربح)
    expect(pl.netForOwner).toBe('-0.2');
    expect(pl.currencyCode).toBe('YER');
  });

  test('AC-19: المسحوبات ليست ضمن المصاريف بأي شكل', async () => {
    const from = daysFromISO(-40);
    const pl = await profitLoss({ dateFrom: from, dateTo: today });
    // مجموع فئات المصاريف = المصاريف بالضبط (لا تسريب للمسحوبة فيها)
    const catsTotal = pl.expensesByCategory.reduce((acc, c) => acc.plus(dec(c.amount)), dec(0));
    expect(catsTotal.toString()).toBe(pl.expenses);
    expect(pl.expenses).toBe('1');
    expect(pl.ownerDraws).toBe('5');
    expect(pl.netForOwner).toBe(dec(pl.netProfit).minus(dec(pl.ownerDraws)).toString());
  });

  test('P&L لليوم وحده: مبيعات اليوم من issued_at وCOGS من حركات اليوم', async () => {
    const pl = await profitLoss({ dateFrom: today, dateTo: today });
    expect(pl.sales).toBe('10'); // الفواتير المؤرَّخة خارج مبيعات اليوم
    expect(pl.salesReturns).toBe('2');
    // حركات الفواتير المؤرَّخة رجعياً تُرحَّل يوم الحفظ → COGS اليوم = 18×0.6
    expect(pl.cogs).toBe('10.8');
    expect(pl.cogsReturned).toBe('1.2');
    // (10−2) − (10.8−1.2) − 0.6 − 1 = −3.2
    expect(pl.netProfit).toBe('-3.2');
    expect(pl.netForOwner).toBe('-8.2');
  });

  test('P&L بعملة غير الأساس تُرفض في V1 برسالة واضحة', async () => {
    await expect(profitLoss({ dateFrom: today, dateTo: today, currencyId: 999999 })).rejects.toThrow(
      /الأساس/,
    );
  });

  // ============ أعمار الديون (FR-09-05 — FIFO) ============

  test('aging: الفاتورة القديمة 35 يوماً في 31-60 والحديثة 10 أيام في 0-30', async () => {
    const rows = await debtAging();
    const row = rows.find((r) => r.customer === 'عميل الأعمار');
    expect(row).toBeDefined();
    expect(row!.currencyCode).toBe('YER');
    // القديمة 5 خصص منها 3 (FIFO) → 2 في 31-60؛ الحديثة 3 في 0-30
    expect(row!.current).toBe('3');
    expect(row!.d30).toBe('2');
    expect(row!.d60).toBe('0');
    expect(row!.d90).toBe('0');
    expect(row!.total).toBe('5');
  });

  test('aging بتاريخ سابق: قبل القبض الحر كانت القديمة كاملة 5 في 31-60', async () => {
    const rows = await debtAging({ dateTo: daysFromISO(-1) });
    const row = rows.find((r) => r.customer === 'عميل الأعمار');
    // الحديثة (صدرت قبل 10 أيام) موجودة في 0-30 بقيمتها 3
    expect(row!.current).toBe('3');
    // القبض (اليوم) لم يكن بعد بهذا التاريخ → التخصيص مستبعد → كاملة 5
    expect(row!.d30).toBe('5');
    expect(row!.total).toBe('8');
  });

  // ============ مبيعات: عميل/صنف/يوم (FR-09-06) ============

  test('salesByCustomer: العميل النقدي 8 صافياً وعميل الأعمار 8', async () => {
    const { rows, total } = await salesByCustomer({ dateFrom: daysFromISO(-40), dateTo: today });
    const cash = rows.find((r) => r.name === 'عميل نقدي');
    expect(cash).toBeDefined();
    expect(cash!.sales).toBe('10');
    expect(cash!.returns).toBe('2');
    expect(cash!.net).toBe('8');
    expect(cash!.invoices).toBe(1);

    const aged = rows.find((r) => r.name === 'عميل الأعمار');
    expect(aged!.sales).toBe('8');
    expect(aged!.net).toBe('8');
    expect(total).toBe('16');
  });

  test('salesByProduct: الصنف 16 وحدة صافية بقيمة 16', async () => {
    const { rows, total } = await salesByProduct({ dateFrom: daysFromISO(-40), dateTo: today });
    const p = rows.find((r) => r.name === 'صنف التقارير');
    expect(p).toBeDefined();
    expect(p!.qtySold).toBe('18');
    expect(p!.sales).toBe('18');
    expect(p!.returns).toBe('2');
    expect(total).toBe('16');
  });

  test('salesByDay: مقارنة الفترة السابقة بنفس الطول', async () => {
    const res = await salesByDay({ dateFrom: daysFromISO(-6), dateTo: today });
    expect(res.rows.length).toBe(7);
    const todayRow = res.rows.find((r) => r.date === today);
    expect(todayRow!.net).toBe('8'); // 10 − 2 مرتجع
    // الأيام 10/35 خلفت مبيعات في الفترة السابقة أو الحالية حسب التقويم — نتحقق منطقياً:
    const expectedCurrent = res.rows.reduce((acc, r) => acc.plus(dec(r.net)), dec(0));
    const recomputeChange =
      dec(res.prevPeriodSales).greaterThan(0)
        ? expectedCurrent.minus(dec(res.prevPeriodSales)).div(dec(res.prevPeriodSales)).times(100).toDecimalPlaces(1).toString()
        : null;
    expect(res.changePct).toBe(recomputeChange);
  });

  // ============ الداشبورد (FR-09-01) ============

  test('dashboard: أرقام اليوم والصندوق والتنبيهات تطابق الدومين', async () => {
    const d = await getDashboard();

    expect(d.todaySales).toBe('8'); // 10 − 2
    expect(d.todayInvoices).toBe(1);
    // +10 بيع نقدي − 2 مرتجع − 1 مصروف − 5 مسحوبة + 3 قبض حر
    expect(d.netCashBase).toBe('5');
    // أرباح اليوم = P&L اليوم (بما فيه حركات الفواتير المؤرَّخة المُرحَّلة اليوم)
    const todayPl = await profitLoss({ dateFrom: today, dateTo: today });
    expect(d.todayProfit).toBe(todayPl.netProfit);

    // الشهر ونسبة التغير: مرآة SQL مباشرة
    const db = await getDb();
    const monthStartIso = monthStart(today);
    const prevEnd = shiftMonth(today, -1);
    const prevStart = monthStart(prevEnd);
    const q = async (from: string, to: string) => {
      const r = await db.all<{ s: string | number }>(
        `SELECT SUM(CASE WHEN doc_type='sale' THEN total_base ELSE -total_base END) AS s FROM invoice
         WHERE status='completed' AND doc_type IN ('sale','sale_return') AND issued_at >= ? AND issued_at <= ?`,
        [from, to],
      );
      return dec(r[0]?.s ?? 0);
    };
    const expMonth = await q(monthStartIso, today);
    const expPrev = await q(prevStart, prevEnd);
    expect(d.monthSales).toBe(expMonth.toString());
    expect(d.monthSalesChangePct).toBe(
      expPrev.greaterThan(0) ? expMonth.minus(expPrev).div(expPrev).times(100).toDecimalPlaces(1).toString() : null,
    );

    // الرسم: 30 يوماً آخرها اليوم بمبيعاته الصافية
    expect(d.last30.length).toBe(30);
    expect(d.last30[29]!.date).toBe(today);
    expect(d.last30[29]!.sales).toBe('8');

    // أعلى الأصناف: الصنف الوحيد (صافي الشهر — مضمون فيه صافي اليوم 8 على الأقل)
    expect(d.topProducts.length).toBe(1);
    expect(d.topProducts[0]!.name).toBe('صنف التقارير');
    expect(Number(d.topProducts[0]!.qty)).toBeGreaterThanOrEqual(8);
    expect(Number(d.topProducts[0]!.sales)).toBeGreaterThanOrEqual(8);

    // لا تنبيهات في هذا السيناريو
    expect(d.dueInstallmentsCount).toBe(0);
    expect(d.minStockCount).toBe(0);
    expect(d.dueChequesCount).toBe(0);
  });

  // ============ بطاقة صنف + ملخص مخزون (FR-09-03/04) ============

  test('productCard: افتتاحي وحركات برصيد تراكمي وختامي', async () => {
    const card = await productCard(productId, { dateFrom: daysFromISO(-40), dateTo: today });
    // حركة الافتتاحية تسجل وقت إنشاء الصنف (اليوم) → لا شيء قبل الفترة
    expect(card.opening).toBe('0');
    expect(card.lines.length).toBe(6); // opening + sale + return + sale×2 + جرد
    expect(card.closing).toBe('3'); // 20 − 10 + 2 − 5 − 3 − 1
    const all = await productCard(productId, {});
    expect(all.opening).toBe('0');
    expect(all.closing).toBe('3');
    expect(all.lines.length).toBe(6);

    // بنية سطر: نوع + مرجع فاتورة + وارد/صادر + رصيد
    const saleLine = all.lines.find((l) => l.type === 'sale');
    expect(saleLine!.out).toBe('10');
    expect(saleLine!.in).toBe('0');
    expect(saleLine!.unitCost).toBe('0.6');
    const stLine = all.lines.find((l) => l.type === 'stocktake_adjust');
    expect(stLine!.out).toBe('1');
    expect(stLine!.unitCost).toBe('0.6');
  });

  test('productCard بمخزن محدد يعمل (نفس المستودع الوحيد)', async () => {
    const card = await productCard(productId, { warehouseId });
    expect(card.closing).toBe('3');
  });

  test('stockSummary: وارد/صادر/مرتجع/تسوية وختامي', async () => {
    const { rows } = await stockSummary({ dateFrom: daysFromISO(-40), dateTo: today });
    const row = rows.find((r) => r.name === 'صنف التقارير');
    expect(row).toBeDefined();
    expect(row!.opening).toBe('0');
    expect(row!.in).toBe('20'); // حركة الافتتاحية داخل الفترة تُعرض وارداً
    expect(row!.out).toBe('-18'); // بيع 18 (الصادر سالب بإشارة الحركة)
    expect(row!.returns).toBe('2');
    expect(row!.adjust).toBe('-1');
    expect(row!.closing).toBe('3');
  });

  test('stocktakeLines بعد الاعتماد: الفرق محفوظ والجرد مقفل', async () => {
    const lines = await stocktakeLines(stocktakeId);
    const row = lines.find((l) => l.productId === productId)!;
    expect(row.countedQty).toBe('3');
    expect(row.diffQty).toBe('-1');
    expect(row.unitCost).toBe('0.6');
    await expect(applyStocktake(stocktakeId, {})).rejects.toThrow(/معتمد ومقفل/);
  });
});
