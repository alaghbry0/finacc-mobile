/**
 * خريطة الترحيل الملزمة (قرار 7 — ملحق و من SRS v1.2 حرفياً).
 *
 * الحسابات التسعة المشتقة (لا CoA ولا قيود يدوية في V1):
 *   CASH الصندوق والبنك (كل الصناديق مجتمعة) • AR المدينون (لكل عملة على حدة)
 *   AP الدائنون (لكل عملة على حدة) • INV المخزون (بقيمة WAC) • COGS تكلفة المبيعات
 *   EXP المصاريف (بفئاتها) • EQ حقوق المالك (رأس المال + المسحوبات)
 *   FX فروق الصرف المحققة ± • CHQ شيكات تحت التحصيل/السحب (ذمة وليست نقوداً)
 *
 * القاعدة المحورية (5.4-8): تقرير الأرباح يُشتق حصراً عبر هذه الخريطة —
 * لا يجوز لأي تقرير أن يجمع الحركات بمنطق خاص.
 *
 * صيغة الربح الملزمة (FR-09-02):
 *   الربح = (المبيعات − مرتجع المبيعات) − (COGS − تكلفة المرتجع) + زيادة الجرد
 *           − عجز الجرد − المصاريف ± فروق الصرف
 *   وصافي ما بقي للمالك = الربح − المسحوبات (بند مستقل خارج المصاريف).
 *
 * اصطلاح القراءة (كما في الملحق و): «X → Y» تعني X دائناً وY مديناً.
 *
 * قرارات تركيب موثقة (المفتاح الواحد قد يمثل حدثاً مركباً):
 * 1) شراء نقدي (CASH→INV) ومرتجع شراء نقدي: طرف النقد في الحركة نفسها — الشراء الآجل
 *    يقيّد AP وقد يسدده لاحقاً سند صرف payment (AP→CASH)؛ لا يجتمعان لنفس الفاتورة.
 * 2) بيع مكتمل: إجمالي المبيعات يُقاس مباشرة من الفواتير المكتملة (لا حركة AR/CASH
 *    للمبيعات) — تحصيل الآجل لاحقاً عبر سند receipt (AR→CASH).
 * 3) الجرد (stocktake_adjust/manual_adjust) محدد الاتجاه: قاعدة أساسية محايدة
 *    (الإشارة وقت الترحيل) + مفتاحان فرعيان _gain/_loss يحددان البندين صراحة.
 * 4) تحويل بين صندوقين/مخزنين: الطرفان من نفس الحساب (CASH→CASH أو INV→INV) —
 *    أثر صافٍ صفري على مستوى الشركة، والفرق العملاتي (إن وجد) عبر FX.
 * 5) employee_advance سلفة موظف (V1.1): أقرب حساب نظامي هو AR (المدينون) — لا حساب موظفين ضمن التسعة.
 * 6) تعارض «opening»: القيمة موجودة في cash_tx وstock_movement معاً ولا يمكن لمفتاح واحد
 *    أن يحمل قاعدتين — فُكّ التعارض بمفتاحين صريحين: «cash_opening» (CASH/EQ) و
 *    «stock_opening» (INV/EQ)، مع دالتين للترجمة الآمنة من قيم الجداول:
 *    cashTxPostingKey() و movementPostingKey() — استخدمهما دائماً بدل القيمة الخام.
 */

export const SYSTEM_ACCOUNTS = ['CASH', 'AR', 'AP', 'INV', 'COGS', 'EXP', 'EQ', 'FX', 'CHQ'] as const;
export type AccountCode = (typeof SYSTEM_ACCOUNTS)[number];

export type PlLine =
  | 'sales'
  | 'sales_return'
  | 'cogs'
  | 'cogs_return'
  | 'stock_gain'
  | 'stock_loss'
  | 'expenses'
  | 'owner_draw'
  | 'capital'
  | 'fx_gain_loss';

export interface PostingRule {
  /** الحسابات المدينة (الأثر الفعلي بحسب تفاصيل الحركة — القائمة هي الإمكان المعلن). */
  debit: AccountCode[];
  /** الحسابات الدائنة. */
  credit: AccountCode[];
  /** بند قائمة الأرباح الذي تغذيه هذه الحركة (null = بلا أثر ربحي). */
  plLine: PlLine | null;
}

/** كل قيم tx_type المسوغة في جدول cash_tx (CHECK في الهجرة 0001). */
export const ALL_CASH_TX_TYPES = [
  'receipt',
  'payment',
  'expense',
  'owner_draw',
  'capital_in',
  'box_transfer',
  'bank_deposit',
  'bank_withdraw',
  'opening',
  'employee_advance',
  'commission_payout',
  'salary_batch',
] as const;

/** كل قيم movement_type المسوغة في جدول stock_movement (CHECK في الهجرة 0001). */
export const ALL_MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'sale_return',
  'purchase_return',
  'stocktake_adjust',
  'manual_adjust',
  'transfer_in',
  'transfer_out',
  'opening',
] as const;

export const POSTING_MAP: Record<string, PostingRule> = {
  // ===== cash_tx — سندات النقدية (ملحق و) =====
  // «قبض تحصيل من عميل: AR → CASH» — تسوية دين (بما فيها القبض الحر on_account بتخصيص FIFO)
  receipt: { debit: ['AR'], credit: ['CASH'], plLine: null },
  // «صرف دفع لمورد: AP → CASH» — تسوية دين
  payment: { debit: ['AP'], credit: ['CASH'], plLine: null },
  // «مصروف: CASH → EXP» — مصاريف (−) شاملة فئاتها
  expense: { debit: ['EXP'], credit: ['CASH'], plLine: 'expenses' },
  // «مسحوبات مالك: CASH → EQ» — بند مستقل خارج المصاريف (قرار 7 حرفياً)
  owner_draw: { debit: ['EQ'], credit: ['CASH'], plLine: 'owner_draw' },
  // «إيداع مالك (رأس مال): CASH → EQ» — سطر رأس المال/الإيداعات
  capital_in: { debit: ['CASH'], credit: ['EQ'], plLine: 'capital' },
  // «تحويل بين صندوقين بعملتين: CASH → CASH + FX للفرق» — فروق صرف ± عند اختلاف العملتين
  box_transfer: { debit: ['CASH'], credit: ['CASH', 'FX'], plLine: 'fx_gain_loss' },
  // إيداع/سحب بنكي داخل حساب CASH (الصندوق والبنك حساب واحد مجمع) — بعملة واحدة
  bank_deposit: { debit: ['CASH'], credit: ['CASH'], plLine: null },
  bank_withdraw: { debit: ['CASH'], credit: ['CASH'], plLine: null },
  // رصيد افتتاحي لصندوق: أصل نقدي مقابل حقوق المالك الافتتاحية
  // (مفتاح «cash_opening» — انظر ملاحظة تعارض «opening» في رأس الملف)
  cash_opening: { debit: ['CASH'], credit: ['EQ'], plLine: null },
  // سلفة موظف (V1.1) — ذمة قابلة للتحصيل ضمن AR (لا حساب موظفين ضمن التسعة)
  employee_advance: { debit: ['AR'], credit: ['CASH'], plLine: null },
  // عمولة مندوب (V2) — مصروف عمولات
  commission_payout: { debit: ['EXP'], credit: ['CASH'], plLine: 'expenses' },
  // دفعة رواتب — «مصاريف (−) شاملة رواتب (بديل V1)» حرفياً من الملحق و
  salary_batch: { debit: ['EXP'], credit: ['CASH'], plLine: 'expenses' },

  // ===== stock_movement — حركات المخزون (ملحق و) =====
  // «شراء نقدي: CASH → INV» و«شراء آجل: AP → INV» — الطرف الدائن بحسب الدفع (لا الاثنان معاً)
  purchase: { debit: ['INV'], credit: ['CASH', 'AP'], plLine: null },
  // «حركة مخزون بيع: INV → COGS» — COGS (+)
  sale: { debit: ['COGS'], credit: ['INV'], plLine: 'cogs' },
  // «مرتجع بيع: INV ← COGS» — يخصم COGS بتكلفة line_cost للفاتورة الأصلية (لا WAC الجاري)
  sale_return: { debit: ['INV'], credit: ['COGS'], plLine: 'cogs_return' },
  // «مرتجع شراء: INV → CASH/AP» — بسعر حركة الشراء الأصلية (Snapshot)
  purchase_return: { debit: ['CASH', 'AP'], credit: ['INV'], plLine: null },
  // «تسوية جرد» — الاتجاه بحسب إشارة الكمية (زيادة INV مديناً / عجز INV دائناً) بتكلفة لقطة الجرد
  stocktake_adjust: { debit: ['INV'], credit: ['INV'], plLine: null },
  stocktake_adjust_gain: { debit: ['INV'], credit: [], plLine: 'stock_gain' },
  stocktake_adjust_loss: { debit: [], credit: ['INV'], plLine: 'stock_loss' },
  // تسوية يدوية — نفس منطق الجرد (القرار 7: زيادة وارد في الربح وعجزه خسارة)
  manual_adjust: { debit: ['INV'], credit: ['INV'], plLine: null },
  manual_adjust_gain: { debit: ['INV'], credit: [], plLine: 'stock_gain' },
  manual_adjust_loss: { debit: [], credit: ['INV'], plLine: 'stock_loss' },
  // تحويل مخزون بين فرعين — كلا الطرفين INV: أثر صافٍ صفري على مستوى الشركة
  transfer_in: { debit: ['INV'], credit: ['INV'], plLine: null },
  transfer_out: { debit: ['INV'], credit: ['INV'], plLine: null },
  // رصيد مخزون افتتاحي — أصل مقابل حقوق المالك الافتتاحية
  // (مفتاح «stock_opening» — انظر ملاحظة تعارض «opening» في رأس الملف)
  stock_opening: { debit: ['INV'], credit: ['EQ'], plLine: null },

  // ===== أحداث خاصة — الشيكات (الوحدة 14 / ملحق و) =====
  // «استلام شيك وارد: AR → CHQ» — ذمة حتى التحصيل
  cheque_in_received: { debit: ['CHQ'], credit: ['AR'], plLine: null },
  // «تحصيل شيك وارد (cleared): CHQ → CASH (+FX إن لزم)» — الشيك لا يمس الصندوق إلا هنا (FR-14-02)
  cheque_in_cleared: { debit: ['CASH', 'FX'], credit: ['CHQ'], plLine: null },
  // «ارتداد شيك وارد (bounced): CHQ → AR + CASH → EXP للرسم» — مصاريف (−) للرسم فقط
  cheque_in_bounced: { debit: ['AR', 'EXP'], credit: ['CHQ', 'CASH'], plLine: 'expenses' },
  // «إصدار شيك صادر: CHQ → AP» — التزام حتى الصرف
  cheque_out_issued: { debit: ['AP'], credit: ['CHQ'], plLine: null },
  // «صرف شيك صادر (cleared): CASH → CHQ»
  cheque_out_cleared: { debit: ['CHQ'], credit: ['CASH'], plLine: null },

  // ===== أحداث خاصة — الفواتير المكتملة =====
  // «بيع مكتمل: يُقاس مباشرة من الفواتير المكتملة» — المبيعات (+)
  sale_completed: { debit: [], credit: [], plLine: 'sales' },
  // مرتجع المبيعات (−) — يُقاس مباشرة من فواتير مرتجع البيع (تماثل المبيعات)
  sale_return_completed: { debit: [], credit: [], plLine: 'sales_return' },
  // شراء مكتمل — نفس ترحيل حركة الشراء (لا أثر ربحي)
  purchase_completed: { debit: ['INV'], credit: ['CASH', 'AP'], plLine: null },
  // مرتجع شراء مكتمل — نفس ترحيل حركة مرتجع الشراء
  purchase_return_completed: { debit: ['CASH', 'AP'], credit: ['INV'], plLine: null },

  // ===== أحداث خاصة — فروق الصرف =====
  // «تسوية بعملة مختلفة: FX» — ربح FX دائناً / خسارة FX مديناً (فروق صرف ±، قرار 8)
  fx_settlement: { debit: ['FX'], credit: ['FX'], plLine: 'fx_gain_loss' },
};

/** جلب قاعدة ترحيل — مفتاح مجهول = خطأ برمجي يوقف التنفيذ (لا تجاهل أبداً). */
export function getPosting(key: string): PostingRule {
  const rule = POSTING_MAP[key];
  if (!rule) {
    throw new Error(
      `مفتاح ترحيل مجهول: «${key}» — لا توجد قاعدة في خريطة الترحيل (ملحق و). ` +
        `المفاتيح المتاحة: ${Object.keys(POSTING_MAP).join('، ')}`,
    );
  }
  return rule;
}

/** مفتاح الخريطة لقيمة tx_type من جدول cash_tx (يفك تعارض opening). */
export function cashTxPostingKey(txType: string): string {
  return txType === 'opening' ? 'cash_opening' : txType;
}

/** مفتاح الخريطة لقيمة movement_type من جدول stock_movement (يفك تعارض opening). */
export function movementPostingKey(movementType: string): string {
  return movementType === 'opening' ? 'stock_opening' : movementType;
}
