/**
 * نصوص وحدة التقسيط (الوحدة 05) — الموجة 5-b.
 */
export const installments = {
  // العناوين
  title: 'الأقساط',
  plansTitle: 'خطط التقسيط',
  dueTitle: 'الأقساط المستحقة',
  planDetailTitle: 'خطة التقسيط',
  newPlanTitle: 'تقسيط الفاتورة',

  // بطاقة الخطة
  customerLabel: 'العميل',
  invoiceLabel: 'الفاتورة',
  totalLabel: 'إجمالي الخطة',
  paidLabel: 'المحصّل',
  remainingLabel: 'المتبقي',
  monthsLabel: 'القسط',
  monthlyCycle: 'شهري',
  weeklyCycle: 'أسبوعي',
  nextDueLabel: 'الاستحقاق القادم',
  remainingCount: '{n} قسطاً متبقياً',

  // حالات الخطة
  statusActive: 'نشطة',
  statusCompleted: 'مكتملة',
  statusCancelled: 'ملغاة',

  // حالات القسط
  instPending: 'معلّق',
  instPartial: 'جزئي',
  instPaid: 'مسدد',
  instLate: 'متأخر',

  // جدول الأقساط
  scheduleHeader: 'جدول الأقساط',
  colSeq: '#',
  colDue: 'الاستحقاق',
  colAmount: 'المبلغ',
  colPaid: 'المسدد',
  colStatus: 'الحالة',

  // المستحق اليوم/الأسبوع
  dueTodaySection: 'مستحق اليوم',
  dueWeekSection: 'خلال هذا الأسبوع',
  overdueSection: 'متأخر',
  overdueBadge: 'متأخر {n} يوم',
  noDueTitle: 'لا أقساط مستحقة',
  noDueMessage: 'لا توجد أقساط مستحقة اليوم أو خلال هذا الأسبوع — سيظهر هنا القسط قبل استحقاقه.',
  collectAction: 'تحصيل',
  collectPartial: 'تحصيل جزئي',
  whatsappRemind: 'تذكير واتساب',
  whatsappMessage: 'السلام عليكم {name}، نذكّركم بقسطكم رقم {seq} من {months} بقيمة {amount} {code} المستحق بتاريخ {date} — المتبقي على خطتكم {remaining} {code}. شكراً لتعاونكم.',

  // نموذج إنشاء الخطة (من الفاتورة الآجلة)
  planButton: 'تقسيط',
  formAmountToPlan: 'المبلغ القابل للتقسيط',
  formMonthsLabel: 'عدد الأقساط',
  formDownPaymentLabel: 'الدفعة الأولى',
  formDownPaymentHint: 'تُقبض فوراً وتُخصم من قابل التقسيط',
  formFirstDueLabel: 'أول استحقاق',
  formCycleLabel: 'الدورية',
  formPreviewTitle: 'معاينة الجدول',
  formPreviewNote: 'أقساط متساوية والفرق على القسط الأخير',
  formPreviewEmpty: 'المبلغ القابل للتقسيط صفر بعد الدفعة الأولى — خفّض الدفعة',
  formDownOver: 'الدفعة الأولى أكبر من القابل للتقسيط ({max}) — خفّضها للمتابعة',
  formCashboxLabel: 'صندوق قبض الدفعة الأولى',
  formSave: 'إنشاء الخطة',
  planCreatedToast: 'أُنشئت خطة التقسيط بنجاح',
  installmentCollectedToast: 'حُصّل القسط وسُجّل سند القبض',

  // التحصيل
  collectTitle: 'تحصيل القسط',
  collectMessage: 'سيُنشأ سند قبض بعملة الخطة ({amount} {code}) ويُخصم من رصيد العميل.',
  collectAmountLabel: 'المبلغ',
  collectFullRadio: 'كامل القسط',
  collectCustomRadio: 'مبلغ محدد',
  cashboxLabel: 'صندوق التحصيل',

  // إعادة الجدولة
  rescheduleTitle: 'إعادة جدولة القسط',
  rescheduleMessage: 'تعديل تاريخ الاستحقاق فقط — بلا إعادة توزيع للمبالغ (FR-05-04).',
  rescheduleAction: 'إعادة الجدولة',
  rescheduledToast: 'أُعيدت جدولة القسط',

  // إلغاء الخطة
  cancelPlanTitle: 'إلغاء خطة التقسيط',
  cancelPlanMessage: 'تلغى الأقساط المتبقية وتبقى المسددة كما هي — يتطلب صلاحية المدير ويُقيَّد في سجل التدقيق.',
  cancelPlanAction: 'إلغاء الخطة',
  cancelPlanWord: 'إلغاء',
  planNotFound: 'الخطة غير موجودة — ربما حُذف الرابط، عد للقائمة وأعد المحاولة',
  planCancelledToast: 'أُلغيت الخطة',

  // فراغ/فلاتر
  emptyTitle: 'لا خطط تقسيط بعد',
  emptyMessage: 'افتح فاتورة بيع آجلة مكتملة واضغط «تقسيط» لتحويل دينها إلى أقساط مجدولة.',
  filterAll: 'الكل',
  viewDue: 'المستحق اليوم',
  dueScreenEntry: 'الأقساط المستحقة',
  downPaymentTag: 'دفعة أولى',
  noPhone: 'لا رقم هاتف أو واتساب مسجل لهذا العميل',
  noMatchingBox: 'لا يوجد صندوق بعملة الخطة — أنشئ صندوقاً بعملتها أولاً',
  installmentLabel: 'قسط',
  planOfInvoice: 'خطة فاتورة {no}',
  customerLabelShort: 'العميل',
} as const;
