/**
 * نصوص وحدة الشراء (FR-02-08) — Task 4-b.
 */
export const purchases = {
  // الشاشات
  newTitle: 'فاتورة شراء جديدة',
  listTitle: 'فواتير الشراء',
  listEmpty: 'لا توجد فواتير شراء بعد',
  listEmptyHint: 'أنشئ أول فاتورة شراء لتغذية المخزون وتحديث التكلفة المرجحة',

  // المورد
  supplierLabel: 'المورّد',
  cashSupplier: 'مورد نقدي (بدون حساب)',
  supplierSearchPlaceholder: 'ابحث بالمورد بالاسم أو الهاتف',
  quickAddSupplier: 'مورد جديد',
  quickAddSupplierTitle: 'إضافة مورد سريع',
  supplierRequiredHint: 'الشراء الآجل يحتاج مورداً ليقيَّد على حسابه',

  // البنود
  itemsTitle: 'بنود الفاتورة',
  addItem: 'إضافة بند',
  productSearchPlaceholder: 'ابحث بالاسم أو امسح الباركود',
  purchasePrice: 'سعر الشراء',
  currentCost: 'التكلفة الحالية',
  lineTotal: 'إجمالي البند',
  noItemsYet: 'لم تُضف بنود بعد — ابدأ بإضافة صنف',

  // الخصم
  invoiceDiscount: 'خصم رأس الفاتورة',
  invoiceDiscountHint: 'يوزَّع على البنود قبل تحديث التكلفة المرجحة (WAC)',

  // الدفع
  payTypeLabel: 'طريقة الدفع',
  cashPay: 'نقدي',
  creditPay: 'آجل',
  mixedPay: 'مختلط',
  cashPartLabel: 'الجزء النقدي المدفوع الآن',
  cashPartHint: 'الباقي يُقيَّد ديناً على حساب المورد',
  cashboxLabel: 'الصندوق',

  // الملاحظات
  internalNote: 'ملاحظة داخلية',

  // الحفظ
  savePurchase: 'حفظ فاتورة الشراء',
  savedToast: (no: string): string => `تم حفظ فاتورة الشراء ${no}`,
  viewInvoice: 'عرض الفاتورة',

  // القائمة
  filterAll: 'الكل',
  filterCompleted: 'مكتملة',
  filterDraft: 'مسودات',
  filterVoid: 'ملغاة',
  noNumber: 'بلا رقم (مسودة)',

  // التفاصيل
  detailsTitle: 'تفاصيل فاتورة الشراء',
  returnDocTitle: 'تفاصيل مرتجع الشراء',
  warehouse: 'المستودع',
  rateLabel: 'سعر الصرف',
  dueOnSupplier: 'المتبقي على المورد',
  unitCostCol: 'تكلفة الوحدة',
  costNote: 'التكلفة محسوبة بعد توزيع خصم الفاتورة',
  returnAction: 'مرتجع شراء',
  voidAction: 'إلغاء الفاتورة',
  linkedReturns: 'مرتجعات مرتبطة',
  noLinkedReturns: 'لا مرتجعات على هذه الفاتورة',
  originalInvoice: 'فاتورة الأصل',
  voidSuccess: 'أُلغيت فاتورة الشراء وعُكست كل آثارها',

  // مرتجع الشراء (ReturnFlow)
  returnTitle: 'مرتجع شراء',
  returnFrom: 'إرجاع إلى المورد من الفاتورة',
  returnableCol: 'القابل للإرجاع',
  returnDirectionLabel: 'اتجاه استرداد المبلغ',
  returnCashDir: 'نقدي إلى الصندوق',
  returnAccountDir: 'خصم من حساب المورد',
  returnReason: 'سبب المرتجع',
  returnReasonPlaceholder: 'مثال: تلف بالتعبئة',
  returnEstimate: 'الاسترداد التقديري',
  returnEstimateHint: 'نهائي الحفظ يطابق حصة البنود من خصم الفاتورة',
  returnSaved: (no: string): string => `تم حفظ مرتجع الشراء ${no}`,
  nothingToReturn: 'لا يوجد قابل للإرجاع — كل الكميات مرتجعة سابقاً',
  returnExitSnapshot: 'يخرج بسعر حركة الشراء الأصلية (Snapshot)',
} as const;
