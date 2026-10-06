/**
 * نصوص كشوف الحساب (FR-03-04) — الموجة 5-c.
 */
export const statement = {
  // العناوين
  titleCustomer: 'كشف حساب عميل',
  titleSupplier: 'كشف حساب مورّد',

  // الفلاتر
  filterSection: 'فترة الكشف',
  fromLabel: 'من تاريخ',
  toLabel: 'إلى تاريخ',
  currencyLabel: 'عملة الكشف',
  currencyHint: 'الكشف يعرض أحداث عملته فقط — بلا تجميع بين عملات',
  applyBtn: 'تطبيق',
  clearFilters: 'مسح الفترة',

  // البطاقات
  openingLabel: 'الرصيد الافتتاحي',
  closingLabel: 'الرصيد الختامي',
  linesCount: '{n} حدثاً',

  // الجدول
  colDate: 'التاريخ',
  colDoc: 'المستند',
  colDebit: 'مدين',
  colCredit: 'دائن',
  colBalance: 'الرصيد',

  // أنواع المستندات
  docSale: 'فاتورة بيع',
  docSaleReturn: 'مرتجع بيع',
  docReceipt: 'سند قبض',
  docPurchase: 'فاتورة شراء',
  docPurchaseReturn: 'مرتجع شراء',
  docPayment: 'سند صرف',
  docCheque: 'شيك',

  // الفراغ والتصدير
  emptyTitle: 'لا أحداث بهذه العملة في الفترة',
  emptyMessage: 'جرّب توسيع الفترة أو مسحها — أو غيّر عملة الكشف إن كانت أحداث الطرف بعملة أخرى.',
  otherCurrencyNote: 'لهذا الطرف أحداث بعملات أخرى لا تظهر في هذا الكشف',
  exportPdf: 'تصدير PDF',
  exportPdfHintReal: 'يُفتح الكشف بنسقة A4 في نافذة الطباعة — احفظه PDF من حوار الطباعة',
  notFound: 'الطرف غير موجود — عد للقائمة وأعد المحاولة',
} as const;
