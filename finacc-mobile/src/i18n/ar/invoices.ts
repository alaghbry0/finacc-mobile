/**
 * نصوص الفواتير المشتركة (تفاصيل/قوائم/إلغاء/مرتجعات) — الموجة 4-b.
 */
export const invoices = {
  // رأس التفاصيل
  invoiceNoLabel: 'رقم الفاتورة',
  issueDate: 'تاريخ الإصدار',
  customerLabel: 'العميل',
  cashCustomer: 'عميل نقدي',
  currencyLabel: 'العملة',
  exchangeRateLabel: 'سعر الصرف',
  rateFallbackBadge: 'سعر صرف تقديري',
  rateFallbackHint: 'استُخدم آخر سعر معروف لغياب سعر اليوم — راجع شاشة أسعار الصرف',

  // جدول البنود
  itemsHeader: 'البنود',
  colProduct: 'الصنف',
  colQty: 'الكمية',
  colPrice: 'السعر',
  colDiscount: 'الخصم',
  colTotal: 'الإجمالي',
  colCost: 'التكلفة',
  colProfit: 'الربح',
  costForManager: 'للمدير فقط',
  profitNote: 'الربح = صافي البند − تكلفتها وقت البيع',
  profitInvoice: 'ربح الفاتورة',
  serviceItem: 'خدمة',

  // الإجماليات
  totalsHeader: 'الإجماليات',
  subtotalLabel: 'المجموع قبل الخصم',
  discountLabel: 'خصم الفاتورة',
  taxLabel: 'الضريبة',
  totalLabel: 'الإجمالي',
  paidLabel: 'المدفوع',
  dueLabel: 'المتبقي',

  // الإجراءات
  printAction: 'طباعة / مشاركة',
  printSheetTitle: 'الطباعة',
  printComingSoon: 'قوالب الطباعة تُوصَّل في الموجة 6 — هذه نسخة المعاينة',
  voidTitle: 'إلغاء الفاتورة',
  voidMessage: (no: string): string =>
    `سيُلغى المستند ${no} وتُنشأ حركات معاكسة كاملة للمخزون والصندوق والأرصدة. الرقم لن يُعاد استخدامه.`,
  voidReasonLabel: 'سبب الإلغاء',
  voidReasonPlaceholder: 'مثال: خطأ في الإدخال',
  voidSuccess: 'أُلغيت الفاتورة وعُكست كل آثارها',
  voidWord: 'إلغاء',

  // تحويل المسودة (FR-02-18)
  convertAction: 'تحويل المسودة إلى مكتملة',
  convertSheetTitle: 'إتمام الفاتورة',
  convertHint: 'اختر طريقة الدفع لاستهلاك الرقم وتطبيق كل الآثار',
  convertSuccess: (no: string): string => `أُكملت الفاتورة ${no} وطُبقت كل آثارها`,

  // مرتجع البيع (ReturnFlow §6.5)
  saleReturnTitle: 'مرتجع بيع',
  saleReturnFrom: 'إرجاع من العميل على الفاتورة',
  saleReturnCashDir: 'نقدي من الصندوق',
  saleReturnAccountDir: 'خصم من حساب العميل',
  saleReturnSaved: (no: string): string => `تم حفظ مرتجع البيع ${no}`,
  saleReturnRestock: 'الكمية تعود للمخزون بتكلفة الأصل',

  // مرتجعات مرتبطة
  linkedReturnsTitle: 'مرتجعات مرتبطة',
  noLinkedReturns: 'لا مرتجعات على هذه الفاتورة',
  viewOriginal: 'عرض الفاتورة الأصلية',

  // حالات عامة
  notFound: 'الفاتورة غير موجودة — قد تكون حُذفت من نسخة أخرى',

  // إضافات Task 4-c (شاشات التفاصيل)
  voidBanner: 'فاتورة ملغاة — الحركات معكوسة والرقم محفوظ',
  draftBanner: 'مسودة — بلا أثر مخزوني ونقدي حتى تحويلها لمكتملة',
  rateLabelShort: 'السعر',
  itemsCountLabel: '{n} بند',
  convertNeedsCustomer: 'إتمام الفاتورة الآجلة يتطلب اختيار عميل — اختر العميل ثم أكمل',
  convertNeedsCashPart: 'أدخل مبلغ الجزء النقدي للفاتورة المختلطة',
  convertNeedsCashbox: 'الجزء النقدي يتطلب اختيار صندوق — اختر الصندوق ثم أكمل',
} as const;
