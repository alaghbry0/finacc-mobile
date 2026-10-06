/**
 * تقرير الأرباح والخسائر (FR-09-02 — قرار 7 بالصيغة الملزمة).
 *
 * الصيغة (ملحق و حرفياً):
 *   الربح = (المبيعات − مرتجع المبيعات) − (COGS − تكلفة المرتجع)
 *           + زيادات الجرد − عجز الجرد − المصاريف ± فروق الصرف
 *   صافي ما بقي للمالك = الربح − المسحوبات (بند مستقل خارج المصاريف — AC-19)
 *
 * القاعدة المحورية (5.4-8): كل بند يُشتق **حصراً عبر خريطة الترحيل**
 * (src/domain/posting-map.ts) — لا منطق تجميع خاص هنا إطلاقاً:
 *   - كل قيم tx_type في cash_tx تُرسم عبر cashTxPostingKey() ونأخذ التي
 *     plLine الخاص بها يساوي بند الأرباح المطلوب (expenses/owner_draw/…).
 *   - كل قيم movement_type في stock_movement تُرسم عبر movementPostingKey()
 *     ونأخذ التي تغذي cogs/cogs_return/stock_gain/stock_loss.
 *   - المبيعات/المرتجعات من أحداث الفواتير المكتملة (sale_completed /
 *     sale_return_completed في الخريطة) بتاريخ الفاتورة issued_at.
 *
 * العملة (قرار V1 موثق في المهمة): عملة التقرير هي **العملة الأساس** حصراً —
 * كل التجميع من أعمدة total_base / unit_cost (التكلفة بالأساس) / amount×rate.
 * تمرير currencyId مختلف عن الأساس يُرفض بخطأ واضح (التحويل بسعر يوم كل حدث → V1.1).
 *
 * ملاحظات اشتقاق موثقة:
 * 1) رسم ارتداد الشيك الوارد: markBounced يسجّله cash_tx من نوع expense
 *    (ref_type='cheque') — يدخل تلقائياً في بند المصاريف عبر الخريطة (الملحق و).
 * 2) فروق الصرف: Σ fx_gain_loss لكل cash_tx غير الملغاة بالفترة (تسوية + تحويل).
 * 3) حركات المخزون تُقاس بتاريخها الفعلي substr(moved_at,1,10) — التأريخ الرجعي
 *    للفواتير مسموح به على الفاتورة، لكن الحركة تسجل بلحظة الحفظ (سلوك الدومين).
 * 4) الفواتير الملغاة (void) تُستبعد، والفواتير المكتملة فقط تدخل المبيعات.
 * 5) المصاريف = بند expenses في الخريطة (شاملة «رواتب» وcommission_payout
 *    المحجوزين مستقبلياً) — المسحوبات owner_draw بند مستقل (AC-19 صراحة).
 */
import { getDb } from '@/db/client';
import { dec, money, roundTo } from '@/utils/money';
import {
  ALL_CASH_TX_TYPES,
  ALL_MOVEMENT_TYPES,
  POSTING_MAP,
  cashTxPostingKey,
  getPosting,
  movementPostingKey,
  type PlLine,
} from '../posting-map';
import { getBaseCurrency } from '../currency';

export interface ProfitLossReport {
  sales: string;
  salesReturns: string;
  cogs: string;
  cogsReturned: string;
  stocktakeGains: string;
  stocktakeLosses: string;
  expenses: string;
  expensesByCategory: { name: string; amount: string }[];
  fxGainLoss: string;
  /** الصيغة الكاملة قبل المصاريف: (المبيعات−المرتجع)−(COGS−تكلفة المرتجع)+زيادات−عجز ±FX. */
  grossProfit: string;
  netProfit: string;
  ownerDraws: string;
  netForOwner: string;
  currencyCode: string;
}

export interface ProfitLossOpts {
  dateFrom: string;
  dateTo: string;
  /** V1: الأساس فقط — أي قيمة أخرى تُرفض برسالة واضحة. */
  currencyId?: number;
}

/** أنواع tx_type التي تغذي بند أرباح معيناً — مشتقة من الخريطة (لا قوائم يدوية). */
function cashTypesForPlLine(line: PlLine): string[] {
  return ALL_CASH_TX_TYPES.filter((t) => getPosting(cashTxPostingKey(t)).plLine === line);
}

/** أنواع movement_type التي تغذي بند أرباح معيناً — مشتقة من الخريطة. */
function movementTypesForPlLine(line: PlLine): string[] {
  return ALL_MOVEMENT_TYPES.filter((t) => getPosting(movementPostingKey(t)).plLine === line);
}

/**
 * أنواع التسوية محددة الاتجاه (جرد + تسوية يدوية): قاعدتها محايدة في الخريطة
 * (plLine=null) ومفتاحاها الفرعيان _gain/_loss هما اللذان يحددان البندين —
 * الاتجاه عند الترحيل بإشارة الكمية (رأس posting-map، ملاحظة 3).
 */
function signedAdjustMovementTypes(): string[] {
  return ALL_MOVEMENT_TYPES.filter((t) => POSTING_MAP[`${movementPostingKey(t)}_gain`] !== undefined);
}

/** عناصر placeholder لقيم IN (?,?) ديناميكية. */
function marks(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

export async function profitLoss(opts: ProfitLossOpts): Promise<ProfitLossReport> {
  const { dateFrom, dateTo } = opts;
  const base = await getBaseCurrency();
  if (opts.currencyId !== undefined && opts.currencyId !== base.id) {
    throw new Error(
      `عملة التقرير في V1 هي الأساس (${base.code}) فقط — التجميع بعملة أخرى بسعر يوم كل حدث توصلها V1.1`,
    );
  }
  const db = await getDb();

  // ===== 1) المبيعات ومرتجعاتها — أحداث الفواتير المكتملة (sale_completed/sale_return_completed) =====
  if (getPosting('sale_completed').plLine !== 'sales' || getPosting('sale_return_completed').plLine !== 'sales_return') {
    throw new Error('خريطة الترحيل لا تطابق بنود المبيعات/المرتجعات — راجع posting-map');
  }
  const invoiceSums = await db.all<{ doc_type: string; s: string | number }>(
    `SELECT doc_type, SUM(total_base) AS s FROM invoice
     WHERE status = 'completed' AND doc_type IN ('sale','sale_return')
       AND issued_at >= ? AND issued_at <= ?
     GROUP BY doc_type`,
    [dateFrom, dateTo],
  );
  const sales = dec(invoiceSums.find((r) => r.doc_type === 'sale')?.s ?? 0);
  const salesReturns = dec(invoiceSums.find((r) => r.doc_type === 'sale_return')?.s ?? 0);

  // ===== 2) COGS وتكلفة المرتجع — من حركات المخزون عبر الخريطة =====
  const cogsTypes = movementTypesForPlLine('cogs'); // ['sale']
  const cogsReturnTypes = movementTypesForPlLine('cogs_return'); // ['sale_return']
  const movementSums = await db.all<{ movement_type: string; s: string | number }>(
    `SELECT movement_type, SUM(ABS(qty) * unit_cost) AS s FROM stock_movement
     WHERE substr(moved_at, 1, 10) >= ? AND substr(moved_at, 1, 10) <= ?
       AND movement_type IN (${marks(cogsTypes.length)}, ${marks(cogsReturnTypes.length)})
     GROUP BY movement_type`,
    [dateFrom, dateTo, ...cogsTypes, ...cogsReturnTypes],
  );
  const cogs = movementSums
    .filter((r) => (cogsTypes as string[]).includes(r.movement_type))
    .reduce((acc, r) => acc.plus(dec(r.s)), dec(0));
  const cogsReturned = movementSums
    .filter((r) => (cogsReturnTypes as string[]).includes(r.movement_type))
    .reduce((acc, r) => acc.plus(dec(r.s)), dec(0));

  // ===== 3) زيادات وعجز الجرد (الأنواع محددة الاتجاه بحسب إشارة الكمية) =====
  const adjustTypes = signedAdjustMovementTypes(); // stocktake_adjust + manual_adjust
  const adjustSums = await db.all<{ sign: number; s: string | number }>(
    `SELECT CASE WHEN qty > 0 THEN 1 ELSE -1 END AS sign, SUM(ABS(qty) * unit_cost) AS s
     FROM stock_movement
     WHERE substr(moved_at, 1, 10) >= ? AND substr(moved_at, 1, 10) <= ?
       AND movement_type IN (${marks(adjustTypes.length)})
     GROUP BY sign`,
    [dateFrom, dateTo, ...adjustTypes],
  );
  const stocktakeGains = dec(adjustSums.find((r) => Number(r.sign) === 1)?.s ?? 0);
  const stocktakeLosses = dec(adjustSums.find((r) => Number(r.sign) === -1)?.s ?? 0);

  // ===== 4) المصاريف + المسحوبات — من cash_tx عبر الخريطة (بالأساس amount×rate) =====
  const expenseTypes = cashTypesForPlLine('expenses'); // expense + commission_payout + salary_batch
  const drawTypes = cashTypesForPlLine('owner_draw'); // owner_draw فقط — AC-19: ليست مصاريف
  const txSums = await db.all<{ tx_type: string; s: string | number }>(
    `SELECT tx_type, SUM(amount * exchange_rate) AS s FROM cash_tx
     WHERE is_voided = 0 AND tx_date >= ? AND tx_date <= ?
       AND tx_type IN (${marks(expenseTypes.length)}, ${marks(drawTypes.length)})
     GROUP BY tx_type`,
    [dateFrom, dateTo, ...expenseTypes, ...drawTypes],
  );
  const expenses = txSums
    .filter((r) => (expenseTypes as string[]).includes(r.tx_type))
    .reduce((acc, r) => acc.plus(dec(r.s)), dec(0));
  const ownerDraws = txSums
    .filter((r) => (drawTypes as string[]).includes(r.tx_type))
    .reduce((acc, r) => acc.plus(dec(r.s)), dec(0));

  // تفصيل المصاريف بالفئات (يشمل رسم ارتداد الشيك — فئة ما سُجل عليها وقت الصرف)
  const byCategory = await db.all<{ name: string; s: string | number }>(
    `SELECT COALESCE(ec.name, 'بلا فئة') AS name, SUM(t.amount * t.exchange_rate) AS s
     FROM cash_tx t LEFT JOIN expense_category ec ON ec.id = t.expense_category_id
     WHERE t.is_voided = 0 AND t.tx_date >= ? AND t.tx_date <= ?
       AND t.tx_type IN (${marks(expenseTypes.length)})
     GROUP BY ec.id ORDER BY s DESC`,
    [dateFrom, dateTo, ...expenseTypes],
  );
  const expensesByCategory = byCategory.map((r) => ({
    name: String(r.name),
    amount: money(roundTo(dec(r.s), 4)),
  }));

  // ===== 5) فروق الصرف المحققة (قرار 8) — كل cash_tx غير الملغاة بالفترة =====
  const fxRows = await db.all<{ s: string | number }>(
    'SELECT SUM(fx_gain_loss) AS s FROM cash_tx WHERE is_voided = 0 AND fx_gain_loss <> 0 AND tx_date >= ? AND tx_date <= ?',
    [dateFrom, dateTo],
  );
  const fxGainLoss = dec(fxRows[0]?.s ?? 0);

  // ===== 6) الصيغة الملزمة =====
  const grossProfit = sales
    .minus(salesReturns)
    .minus(cogs.minus(cogsReturned))
    .plus(stocktakeGains)
    .minus(stocktakeLosses)
    .plus(fxGainLoss);
  const netProfit = grossProfit.minus(expenses);
  const netForOwner = netProfit.minus(ownerDraws);

  return {
    sales: money(roundTo(sales, 4)),
    salesReturns: money(roundTo(salesReturns, 4)),
    cogs: money(roundTo(cogs, 4)),
    cogsReturned: money(roundTo(cogsReturned, 4)),
    stocktakeGains: money(roundTo(stocktakeGains, 4)),
    stocktakeLosses: money(roundTo(stocktakeLosses, 4)),
    expenses: money(roundTo(expenses, 4)),
    expensesByCategory,
    fxGainLoss: money(roundTo(fxGainLoss, 4)),
    grossProfit: money(roundTo(grossProfit, 4)),
    netProfit: money(roundTo(netProfit, 4)),
    ownerDraws: money(roundTo(ownerDraws, 4)),
    netForOwner: money(roundTo(netForOwner, 4)),
    currencyCode: base.code,
  };
}
