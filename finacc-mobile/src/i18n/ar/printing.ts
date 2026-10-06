/** نصوص وحدة الطباعة والمشاركة (الوحدة 10) — الموجة 6-b. */
export const printing = {
  // شيت خيارات الطباعة (تفاصيل الفاتورة)
  sheetTitle: 'الطباعة والمشاركة',
  paperLabel: 'حجم الورق',
  paperHint: 'الافتراضي من إعدادات الطباعة — 80mm هو الأشهر للطابعات الحرارية',
  paperReceipt58: 'إيصال 58mm',
  paperReceipt80: 'إيصال 80mm',
  paperA4: 'A4 كامل',
  detailedLabel: 'القالب',
  detailedShort: 'مختصر (إيصال)',
  detailedFull: 'مفصّل (أسعار وخصومات)',
  detailedHint: 'المختصر للكاشير السريع والمفصّل يظهر السعر والخصم والمستودع',
  printNowAction: 'معاينة وطباعة',
  printBusy: 'يُجهَّز المستند…',
  whatsappAction: 'مشاركة واتساب',
  whatsappNoPhone: 'لا يحفظ هذا الطرف رقم هاتف — ستفتح محادثة واتساب بلا رقم لاختيار جهة الاتصال',
  printDone: 'فُتحت نافذة الطباعة',
  printFailed: 'تعذر فتح الطباعة — أعد المحاولة',
  printSavedNote: 'يُحفظ اختيارك للورق والقالب تلقائياً',
  thermalNote:
    'الطابعة الحرارية (بلوتوث/رستر) تعمل على الجهاز فقط — في المعاينة تُفتح نافذة طباعة المتصفح (يمكن حفظ PDF)',

  // الطباعة عند الحفظ (sales/new)
  savedPrintAsk: 'طباعة الآن؟',
  savedPrintNow: 'طباعة الآن',
  savedPrintLater: 'لاحقاً',

  // السند
  voucherPrintFailed: 'تعذر طباعة السند — أعد المحاولة',

  // كشف الحساب
  statementPrintFailed: 'تعذر تصدير الكشف — أعد المحاولة',

  // الوردية
  printShiftReport: 'طباعة تقرير الوردية',
  shiftPrintFailed: 'تعذر طباعة تقرير الوردية — أعد المحاولة',
} as const;
