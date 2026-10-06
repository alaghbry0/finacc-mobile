/**
 * نصوص وحدة الشيكات (الوحدة 14) — الموجة 5-b.
 */
export const cheques = {
  // العناوين
  title: 'الشيكات',
  tabTitle: 'الشيكات',
  newTitle: 'شيك جديد',
  detailTitle: 'تفاصيل الشيك',
  listTitle: 'كل الشيكات',

  // الاتجاه
  directionIn: 'شيك وارد',
  directionOut: 'شيك صادر',
  directionLabel: 'اتجاه الشيك',
  directionInDesc: 'من عميل — قبض عند التحصيل',
  directionOutDesc: 'لمورّد — صرف عند التحصيل',
  fromCustomer: 'من عميل',
  toSupplier: 'لمورّد',

  // الحقول
  partyLabel: 'الطرف',
  chequeNoLabel: 'رقم الشيك',
  bankNameLabel: 'البنك',
  bankPlaceholder: 'مثال: بنك التضامن',
  amountLabel: 'مبلغ الشيك',
  currencyLabel: 'عملة الشيك',
  issueDateLabel: 'تاريخ الإصدار',
  dueDateLabel: 'تاريخ الاستحقاق',
  dueDateHint: 'تاريخ استلام قيمة الشيك من البنك',
  refInvoiceLabel: 'فاتورة مرجعية',
  refInvoiceHint: 'اختياري — يخصم من الفاتورة عند التحصيل',
  notesLabel: 'ملاحظات',
  rateTodayLabel: 'سعر اليوم',

  // الحالات (StatusChip + نصوص)
  statusPending: 'قيد التحصيل',
  statusDeposited: 'مودَع بالبنك',
  statusCleared: 'محصّل',
  statusBounced: 'مرتد',
  statusVoid: 'ملغى',

  // الاستحقاق
  dueToday: 'مستحق اليوم',
  dueInDays: 'مستحق بعد {n} يوم',
  dueOverdue: 'متأخر {n} يوم',

  // أزرار دورة الحياة
  depositAction: 'إيداع بالبنك',
  clearAction: 'تحصيل ✓',
  bounceAction: 'ارتداد',
  voidAction: 'إلغاء الشيك',
  viewCashTx: 'عرض الحركة النقدية',

  // شيت التحصيل
  clearTitle: 'تحصيل الشيك',
  clearMessage: 'سيُنشأ سند قبض بقيمة الشيك بعملته ({amount} {code}) ويُخصم من دين الطرف عند التحصيل.',
  cashboxLabel: 'صندوق التحصيل',

  // شيت الإيداع
  depositTitle: 'إيداع الشيك بالبنك',
  depositMessage: 'تسجيل الشيك كمودَع — لا أثر مالياً حتى التحصيل الفعلي.',

  // شيت الارتداد
  bounceTitle: 'تسجيل ارتداد الشيك',
  bounceMessage: 'يعود الدين للطرف (لم يُخصم شيء بعد) ويُسجَّل الشيك مرتداً.',
  bounceFeeLabel: 'رسم الارتداد',
  bounceFeeHint: 'اختياري — يُسجَّل مصروفاً من الصندوق',
  bounceCategoryLabel: 'فئة المصروف',

  // شيت الإلغاء
  voidTitle: 'إلغاء الشيك',
  voidMessage: 'إلغاء الشيك نهائياً (بلا أي أثر مالي) — يتطلب صلاحية المدير ويُقيَّد في سجل التدقيق.',

  // الفلاتر
  filterAll: 'الكل',
  filterOpen: 'قيد التتبع',

  // القوائم والفراغ
  emptyTitle: 'لا شيكات بعد',
  emptyMessage: 'سجّل الشيكات الواردة من عملائك والصادرة لمورّديك لتتبع استحقاقها وتحصيلها من هنا.',
  searchHint: 'ابحث برقم الشيك أو البنك أو الطرف',
  viewAll: 'عرض الكل',
  addCheque: 'شيك جديد',
  linkedInvoice: 'فاتورة: {no}',
  noInvoice: 'على الحساب (FIFO)',
  notFound: 'الشيك غير موجود — ربما حُذف الرابط، عد للقائمة وأعد المحاولة',
  noMatchingBox: 'لا يوجد صندوق بهذه العملة — أنشئ صندوقاً بعملة الشيك أولاً',
  bounceFeeRecorded: 'سُجّل الرسم كمصروف نقدي مرتبط بالشيك',
  fieldDate: 'التاريخ',
  voidWord: 'إلغاء',

  // تفاصيل
  clearedTxSection: 'حركة التحصيل',
  fxGainLoss: 'فرق صرف محقق',
  bouncedAtLabel: 'تاريخ الارتداد',
  bounceFeeSection: 'رسم الارتداد',
  clearedToast: 'حُصّل الشيك وأنشئ سند القبض',
  depositedToast: 'سُجّل الشيك كمودَع بالبنك',
  bouncedToast: 'سُجّل الارتداد — عاد الدين للطرف',
  voidedToast: 'أُلغي الشيك',
  createdToast: 'سُجّل الشيك بنجاح — قيد التحصيل',
} as const;
