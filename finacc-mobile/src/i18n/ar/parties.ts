/**
 * نصوص وحدة الأطراف — العملاء والموردون (الوحدة 03 / الموجة 3-b).
 * ملاحظة نطاق موثقة: كشف الحساب التفصيلي (FR-03-04) مؤجل للموجة 5،
 * واستيراد العملاء من Excel (FR-03-08) مؤجل — كلاهما مذكور في worklog.
 */
export const parties = {
  // العناوين العامة
  title: 'العملاء والموردون',
  customers: 'العملاء',
  suppliers: 'الموردون',
  addCustomer: 'إضافة عميل',
  addSupplier: 'إضافة مورّد',
  newCustomer: 'عميل جديد',
  newSupplier: 'مورّد جديد',
  editCustomer: 'تعديل العميل',
  editSupplier: 'تعديل المورّد',
  customerFile: 'ملف العميل',
  supplierFile: 'ملف المورّد',

  // البحث والقوائم
  searchPlaceholder: 'ابحث بالاسم أو الهاتف…',
  listCustomersHint: 'الرصيد الظاهر بعملة الأساس — الأرصدة الأخرى داخل ملف الطرف',
  emptyCustomersTitle: 'لا عملاء بعد',
  emptyCustomersMessage: 'أضف أول عميل لتتبّع أرصدته وفواتيره وتحصيلاته.',
  emptyCustomersAction: 'أضف أول عميل',
  emptySuppliersTitle: 'لا موردين بعد',
  emptySuppliersMessage: 'أضف أول مورّد لتتبّع مستحقاتك ومشترياتك منه.',
  emptySuppliersAction: 'أضف أول مورّد',

  // الحقول (FR-03-01)
  name: 'الاسم',
  namePlaceholder: 'مثال: أحمد سعيد',
  phone: 'الهاتف',
  phoneHint: 'يستخدم للاتصال والتذكيرات',
  whatsapp: 'واتساب',
  whatsappHint: 'اتركه فارغاً لاستخدام رقم الهاتف',
  address: 'العنوان',
  area: 'المنطقة',
  notes: 'ملاحظات',

  // حد الائتمان (FR-03-01 — المعنى المحسوم)
  creditLimit: 'حد الائتمان',
  creditLimitNoLimit: 'بلا حد',
  creditLimitValue: 'قيمة محددة',
  creditLimitHint: 'بلا حد = السماح بالآجل دون سقف. أدخل 0 لمنع البيع الآجل كلياً.',
  creditLimitZeroLabel: 'ممنوع الآجل (0)',
  creditLimitNoLimitLabel: 'بلا حد',

  // الرصيد الافتتاحي (FR-03-01)
  openingSection: 'الرصيد الافتتاحي',
  openingBalance: 'المبلغ',
  openingCurrency: 'العملة',
  openingRate: 'سعر الصرف',
  openingDate: 'التاريخ',
  openingHintCustomer: 'موجب = مدين على العميل (دين سابق للتطبيق).',
  openingHintSupplier: 'موجب = دائن مستحق للمورّد.',
  openingRateMissing: 'أدخل سعر الصرف لعملة غير الأساس',

  // الملف — الأرصدة (قرار 8 / FR-03-02)
  balancesSection: 'الأرصدة لكل عملة',
  noBalancesTitle: 'لا أرصدة بعد',
  noBalancesMessage: 'سيظهر الرصيد هنا مع أول فاتورة أو سند أو رصيد افتتاحي.',
  debit: 'مدين',
  credit: 'دائن',
  settled: 'متزن',
  debitOnCustomer: 'مدين عليه',
  owedToSupplier: 'مستحق له',
  baseBalanceOnly: 'بعملة الأساس',

  // الملف — معلومات وأزرار
  infoSection: 'البيانات',
  call: 'اتصال',
  whatsappCall: 'واتساب',
  noPhone: 'لا رقم هاتف مسجل',
  archive: 'أرشفة',
  archiveTitle: 'أرشفة الطرف؟',
  archiveMessage:
    'يختفي الطرف من القوائم ولا يُحذف أبداً — أرصدته وحركاته محفوظة كاملة (قاعدة FR-03-09: لا حذف لطرف له حركات).',
  archivedToast: 'تمت الأرشفة — البيانات محفوظة',
  savedToast: 'تم الحفظ بنجاح',
  edit: 'تعديل',
  createdAt: 'أُضيف في',

  // كشف الحساب (FR-03-04 — الموجة 5-b)
  statementSoonTitle: 'كشف الحساب',
  statementSoonMessage: 'كشف الحساب التفصيلي متاح بعد أول فاتورة — الموجة القادمة.',
  statementAction: 'كشف الحساب',

  // شاشة كشف الحساب
  statementTitle: 'كشف حساب {name}',
  statementCurrencyLabel: 'عملة الكشف',
  statementFromLabel: 'من تاريخ',
  statementToLabel: 'إلى تاريخ',
  statementOpening: 'الرصيد الافتتاحي',
  statementClosing: 'الرصيد الختامي',
  statementColDate: 'التاريخ',
  statementColDoc: 'المستند',
  statementColDebit: 'مدين',
  statementColCredit: 'دائن',
  statementColBalance: 'الرصيد',
  statementEmptyTitle: 'لا أحداث بهذه العملة',
  statementEmptyMessage: 'ليس لهذا الطرف حركات بعملة الكشف المختارة خلال الفترة — جرّب عملة أخرى.',
  statementOtherCurrencies: 'توجد أحداث لهذا الطرف بعملات أخرى غير معروضة هنا — لكل عملة كشفها المستقل.',
  statementExportPdf: 'تصدير PDF',
  statementExportSoon: 'تصدير PDF متاح في الموجة القادمة (6) — نسخة النص كاملة على الشاشة الآن.',
  statementApply: 'تطبيق الفترة',
  statementClearPeriod: 'كامل الفترة',
  docSale: 'فاتورة بيع',
  docSaleReturn: 'مرتجع بيع',
  docReceipt: 'سند قبض',
  docCheque: 'شيك محصّل',
  docPurchase: 'فاتورة شراء',
  docPurchaseReturn: 'مرتجع شراء',
  docPayment: 'سند صرف',
} as const;
