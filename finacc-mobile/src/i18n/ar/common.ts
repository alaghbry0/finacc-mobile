/**
 * النصوص المشتركة لكل الوحدات — تُستخدم عبر `ar.common`.
 * قاعدة NFR-10: صياغة بشرية فصيحة (مادة أولية معاد صياغتها، لا نسخ حرفي).
 */
export const common = {
  // التطبيق
  appName: 'المُحاسِب الشخصي',
  tagline: 'محاسبة ومخزون تعمل بلا إنترنت',

  // أزرار وإجراءات عامة
  save: 'حفظ',
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  delete: 'حذف',
  edit: 'تعديل',
  add: 'إضافة',
  back: 'رجوع',
  next: 'التالي',
  previous: 'السابق',
  retry: 'إعادة المحاولة',
  search: 'بحث',
  scanBarcode: 'مسح باركود',
  yes: 'نعم',
  no: 'لا',
  done: 'تم',
  close: 'إغلاق',
  undo: 'تراجع',
  dismiss: 'إخفاء',
  clear: 'مسح',
  clearAll: 'مسح الكل',
  clearFilters: 'مسح الفلاتر',
  seeAll: 'عرض الكل',
  copy: 'نسخ',
  remove: 'إزالة',
  show: 'إظهار',
  hide: 'إخفاء',

  // حالات عامة
  loading: 'جارٍ التحميل…',
  saving: 'جارٍ الحفظ…',
  processing: 'جارٍ التنفيذ…',
  emptyList: 'لا توجد بيانات بعد',
  errorTitle: 'حدث خطأ',
  errorGeneral: 'تعذّر إتمام العملية. حاول مرة أخرى، وإن تكرر الأمر أعد تشغيل التطبيق.',
  whatHappened: 'ماذا حدث؟',
  technicalDetails: 'التفاصيل التقنية',
  showDetails: 'إظهار التفاصيل',
  hideDetails: 'إخفاء التفاصيل',
  noResults: 'لا توجد نتائج مطابقة لهذه المعايير',
  noResultsHint: 'جرّب تعديل كلمات البحث أو مسح الفلاتر المطبَّقة.',
  offlineBanner: 'تعمل بلا إنترنت — بياناتك محفوظة على جهازك ولا يتعطّل شيء',
  comingSoonTitle: 'تحت الإنشاء',
  comingSoonMessage: 'هذه الشاشة قيد التطوير وستتوفر في التحديث القادم.',
  permissionBlockedTitle: 'هذه الشاشة تتطلب صلاحية المدير',
  permissionBlockedMessage: 'لا تتوفر لديك صلاحية عرض هذه الشاشة. تواصل مع مدير المنشأة لمنحك الصلاحية.',
  requestAccess: 'طلب الصلاحية',

  // الحقول والتحقق
  requiredField: 'هذا الحقل مطلوب',
  optionalField: 'اختياري',
  invalidNumber: 'أدخل رقمًا صحيحًا',
  invalidDate: 'أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD',

  // مفاتيح محاسبية عامة
  amount: 'المبلغ',
  quantity: 'الكمية',
  price: 'السعر',
  total: 'الإجمالي',
  currency: 'العملة',
  currencies: 'العملات',
  date: 'التاريخ',
  today: 'اليوم',
  minusDay: '− يوم',
  plusDay: '+ يوم',
  notes: 'ملاحظات',
  customer: 'العميل',
  supplier: 'المورّد',

  // لوحة أرقام NumberPad
  decimalSeparator: '.',
  clearNumber: 'مسح الرقم',
  backspace: 'حذف خانة',

  // تأكيد خطر ConfirmSheet
  confirmDangerTitle: 'إجراء لا يمكن الرجوع فيه',
  typeWordToConfirm: 'اكتب كلمة «{word}» في الحقل لتفعيل زر التأكيد',
  typedWordMismatch: 'الكلمة غير مطابقة — اكتبها كما هي تمامًا',

  // العملات (أساسية للأختيارات)
  currencyYER: 'ريال يمني',
  currencySAR: 'ريال سعودي',
  currencyUSD: 'دولار أمريكي',
  currencyAED: 'درهم إماراتي',

  // التاريخ (ميلادي بأسماء عربية وأرقام لاتينية)
  months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  weekdays: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  formatDate: (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m === null) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const w = common.weekdays[d.getDay()] ?? '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = common.months[d.getMonth()] ?? '';
    return `${w} ${day} ${month} ${d.getFullYear()}`;
  },

  // حالات المستندات (StatusChip DS-26 — نص دائمًا لا لون فقط)
  statuses: {
    cash: 'نقدي',
    credit: 'آجل',
    mixed: 'مختلط',
    partial: 'مدفوع جزئيًا',
    pending: 'معلّق',
    draft: 'مسودة',
    cancelled: 'ملغى',
    void: 'مبطل',
    paid: 'مدفوع',
    overdue: 'متأخر',
    active: 'نشط',
    archived: 'مؤرشف',
    deposited: 'مودَع',
    cleared: 'محصّل',
    bounced: 'مرتد',
  },
} as const;

/** تعويض بسيط للقوالب {placeholder} — بلا مكتبات. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m,
  );
}
