/**
 * نصوص وحدة الفوترة — شاشة البيع (§6.5/LDR-1) + PaymentSheet (DS-40) + قائمة الفواتير.
 * صياغة بشرية فصيحة وفق NFR-10 — والقوالب {placeholder} تُعوَّض عبر fill().
 */

export const sales = {
  // ============ شاشة البيع ============
  newTitle: 'فاتورة بيع',
  customerChip: 'عميل نقدي',
  chooseCustomer: 'اختيار العميل',
  cashboxChip: 'الصندوق',
  currencyChip: 'العملة',
  warehouseChip: 'المستودع',

  // شريط المعلّقات (FR-02-13)
  parkedCount: '{n} سلة معلّقة',
  parkedCountPlural: '{n} سلال معلّقة',
  parkedTitle: 'السلال المعلّقة',
  parkedEmpty: 'لا توجد سلال معلّقة — علّق فاتورة جارية بزر «تعليق» وستظهر هنا',
  restore: 'استعادة',
  forget: 'حذف',
  parkDone: 'عُلّقت السلة — استعدها من شريط المعلّقات',

  // مسودة السلة المستعادة (AC-23 / FR-02-13)
  restoredBanner: 'تمت استعادة فاتورتك غير المحفوظة',
  restoredDismiss: 'تجاهل',

  // البنود
  addItem: 'إضافة صنف',
  itemPickerTitle: 'اختيار صنف',
  itemPickerSearch: 'ابحث بالاسم أو امسح الباركود',
  bestSellers: 'الأكثر مبيعاً',
  noPrice: 'بلا سعر مسجّل',
  qtyLabel: 'الكمية',
  priceLabel: 'السعر',
  availableLabel: 'المتاح: {n}',
  serviceTag: 'خدمي',
  lineRemoved: 'حُذف سطر «{name}»',
  cartEmpty: 'الفاتورة فارغة',
  cartEmptyHint: 'أضف أول صنف بالبحث أو مسح الباركود أو من «إضافة صنف»',

  // تجاوز المتاح (FR-02-02)
  overAvailTitle: 'الكمية تتجاوز المتاح',
  overAvailMessage: 'كمية «{name}» المطلوبة {requested} والمتاح منها {available} فقط. ماذا تريد؟',
  addAvailable: 'إضافة كموجود',
  continueAnyway: 'متابعة',

  // الإجماليات
  subtotalLabel: 'المجموع',
  discountLabel: 'الخصم',
  taxLabel: 'الضريبة',
  totalLabel: 'الإجمالي',

  // أزرار الحفظ (LDR-1)
  saveCash: 'حفظ نقدي',
  saveCredit: 'حفظ آجل',
  park: 'تعليق',
  extras: 'إضافات (…)',
  saving: 'جارٍ الحفظ…',

  // الإضافات (…)
  extrasTitle: 'إضافات الفاتورة',
  invoiceDate: 'تاريخ الفاتورة',
  invoiceDiscount: 'خصم على الإجمالي',
  notesInternal: 'ملاحظة داخلية (لا تُطبع)',
  notesPrinted: 'ملاحظة تُطبع مع الفاتورة',
  saveDraft: 'حفظ كمسودة',
  draftDone: 'حُفظت المسودة — أكملها لاحقاً من قائمة الفواتير',

  // ============ PaymentSheet (DS-40) ============
  paymentTitle: 'الدفع',
  amountDue: 'الإجمالي المستحق',
  receivedLabel: 'المستلم',
  changeLabel: 'الباقي',
  remainingLabel: 'المتبقي',
  exactAmount: 'المبلغ بالضبط',
  convertRestCredit: 'تحويل المتبقي آجلاً',
  confirmPayment: 'تأكيد الدفع',
  restCreditOn: 'سيحوَّل المتبقي ({amount}) آجلاً على حساب العميل',
  restCreditNeedsCustomer: 'تحويل المتبقي آجلاً يتطلب اختيار عميل أولاً',

  // ============ الأخطاء والحالات الخاصة ============
  rateTitle: 'لا يوجد سعر صرف لليوم',
  rateHint: 'أدخل سعر اليوم للمتابعة — سيُحفظ ويعاد الحفظ تلقائياً',
  rateSave: 'حفظ ومتابعة',
  creditLimitTitle: 'تجاوز حد الائتمان',
  backdateTitle: 'تأريخ رجعي يتطلب تأكيد المدير',
  backdateMessage: 'التاريخ المختارج يرجع أكثر من الحد المسموح — الاستمرار يُقيَّد في سجل التدقيق. هل تريد المتابعة؟',
  saveFailed: 'تعذّر الحفظ',

  // ============ النجاح ============
  savedToast: 'حُفظت الفاتورة {no}',
  savedTitle: 'حُفظت الفاتورة',
  viewInvoice: 'عرض الفاتورة',
  newInvoice: 'فاتورة جديدة',
  printInvoice: 'طباعة',
  printNow: 'طباعة الآن',
  printLater: 'بقاء في الشاشة',
  printPlaceholder: 'قوالب الطباعة تُوصَّل في الموجة 6',

  // ============ إضافات Task 4-c (تجميع الشاشات) ============
  scanNotFound: 'لا يوجد صنف بهذا الباركود — أضفه من شاشة المخزون أولاً أو صحّح الرقم',
  noPriceAddedWarn: 'أُضيف الصنف بلا سعر بعملة الفاتورة — أدخل السعر الآن ثم أكمل',
  repricedN: 'أُعيد تسعير {n} بند بعملة {code}',
  zeroedN: '{n} بند بلا سعر بعملة {code} — صُفِّر سعره، انقر السعر لتعديله',
  creditNeedsCustomer: 'حفظ آجل يتطلب اختيار عميل أولاً — اختر العميل ثم أعِد المحاولة',
  chooseCashbox: 'اختيار الصندوق',
  chooseCurrency: 'اختيار العملة',
  isBaseCurrency: 'عملة الأساس',
  rateInvalid: 'أدخل سعر صرف صحيحاً أكبر من صفر',
  rateSavedRetry: 'حُفظ سعر اليوم — تستأنف الحفظ تلقائياً',
  notReadyYet: 'جارٍ تجهيز الشاشة…',
  saveAbortedEmpty: 'الفاتورة فارغة — أضف صنفاً واحداً على الأقل قبل الحفظ',

  // ============ اختيار العميل ============
  customerPickerTitle: 'اختيار العميل',
  customerSearch: 'ابحث بالاسم أو الهاتف',
  walkInCustomer: 'عميل نقدي',
  walkInHint: 'بيع مباشر بلا حساب عميل',
  balanceLabel: 'الرصيد',
  noCustomers: 'لا يوجد عملاء مطابقون',

  // ============ قائمة الفواتير ============
  listTitle: 'الفواتير',
  listSearch: 'ابحث برقم الفاتورة أو اسم العميل',
  filterAll: 'الكل',
  typeSale: 'بيع',
  statusCompleted: 'مكتملة',
  statusDraft: 'مسودة',
  statusVoid: 'ملغاة',
  periodFrom: 'من تاريخ',
  periodTo: 'إلى تاريخ',
  noInvoices: 'لا فواتير بعد',
  noInvoicesHint: 'أنشئ أول فاتورة من زر البيع — بيعك الأول على بعد نقرة واحدة',
  noInvoicesAction: 'بيع جديد',
  draftTag: 'مسودة',
  voidTag: 'ملغاة',
  cashCustomerName: 'عميل نقدي',
} as const;

export type SalesTextKey = keyof typeof sales;
