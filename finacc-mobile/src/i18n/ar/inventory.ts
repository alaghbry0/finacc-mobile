/**
 * نصوص وحدة الأصناف والمخزون (الوحدة 01 — FR-01) — تستخدم عبر `ar.inventory`.
 * كل نصوص الشاشات: القائمة، النموذج (إنشاء/تعديل)، بطاقة الصنف، المسح،
 * التنبيهات، الفئات، الوحدات.
 */
import { common } from './common';

export const inventory = {
  // ===== شاشة قائمة الأصناف (تبويب المخزون) =====
  title: 'المخزون والأصناف',
  searchPlaceholder: 'ابحث بالاسم أو الباركود…',
  emptyTitle: 'لا أصناف بعد',
  emptyMessage: 'أضف أول صنف لتتبع مخزونك وأسعار بيعه بكل العملات',
  emptyAction: 'إضافة أول صنف',
  newProduct: 'صنف جديد',
  serviceBadge: 'خدمي',
  noPrice: 'بلا سعر',
  qtyBadge: 'الرصيد',
  manage: 'إدارة',
  alerts: 'التنبيهات',
  categories: 'الفئات',
  units: 'الوحدات',
  itemsCount: '{count} صنفاً',

  // ===== مسح الباركود (FR-01-03) =====
  scanTitle: 'مسح باركود',
  scanCameraHint: 'وجّه الكاميرا نحو الباركود — سيفتح الصنف تلقائياً',
  scanManualPlaceholder: 'أدخل الباركود يدوياً',
  scanManualOpen: 'فتح الصنف',
  scanNotFound: 'لا يوجد صنف فاعل بهذا الباركود — قد يكون مؤرشفاً أو غير مسجل',
  scanCameraFailed: 'تعذّر تشغيل الكاميرا — أدخل الباركود يدوياً',

  // ===== نموذج الصنف (إنشاء/تعديل — FR-01-01) =====
  newTitle: 'صنف جديد',
  editTitle: 'تعديل الصنف',
  sectionBasic: 'البيانات الأساسية',
  sectionPricing: 'التسعير',
  sectionStock: 'المخزون',
  nameLabel: 'اسم الصنف',
  namePlaceholder: 'مثال: حليب المراعي 1 لتر',
  nameRequired: 'اسم الصنف مطلوب — أدخل الاسم كما يُنادى في المتجر',
  barcodeLabel: 'الباركود',
  barcodeHint: 'اتركه فارغاً ليولَّد تلقائياً (EAN-13 داخلي يبدأ بـ 2)',
  generateBarcode: 'توليد باركود',
  categoryLabel: 'الفئة',
  categoryPlaceholder: 'بلا فئة',
  newCategory: '+ فئة جديدة',
  unitLabel: 'وحدة القياس',
  unitPlaceholder: 'بلا وحدة',
  newUnit: '+ وحدة جديدة',
  costPriceLabel: 'سعر التكلفة',
  costPriceHint: 'متوسط تكلفة الشراء — أساس حساب الربح لاحقاً',
  pricesTitle: 'أسعار البيع',
  pricesHint: 'سعر اختياري لكل عملة مفعلة (مستوى التجزئة)',
  priceFor: 'سعر {code}',
  minStockLabel: 'الحد الأدنى للتنبيه',
  minStockHint: 'تنبيه عندما يهبط الرصيد الكلي تحت هذا الحد',
  serviceSwitch: 'صنف خدمي (بلا مخزون)',
  serviceHint: 'يدخل في الفواتير دون أي أثر مخزوني — بلا رصيد ولا حركات',
  openingQtyLabel: 'الكمية الافتتاحية',
  openingQtyHint: 'تُسجل كحركة افتتاحية بتكلفة الصنف',
  openingWarehouseLabel: 'المستودع',
  notesLabel: 'ملاحظات',
  notesPlaceholder: 'تفاصيل إضافية عن الصنف (اختياري)',
  saveProduct: 'حفظ الصنف',
  createdToast: 'أُضيف الصنف بنجاح',
  updatedToast: 'حُفظت التعديلات',

  // ===== شيت فئة جديدة =====
  categorySheetTitle: 'فئة جديدة',
  categoryNameLabel: 'اسم الفئة',
  categoryNamePlaceholder: 'مثال: مشروبات',
  parentCategoryLabel: 'الفئة الأصل',
  noParentCategory: 'فئة رئيسية (بلا أب)',

  // ===== شيت وحدة جديدة =====
  unitSheetTitle: 'وحدة قياس جديدة',
  unitNameLabel: 'اسم الوحدة',
  unitNamePlaceholder: 'مثال: كرتون',
  baseUnitLabel: 'وحدة الأساس',
  noBaseUnit: 'أساسية (بلا أساس)',
  factorLabel: 'معامل التحويل',
  factorHint: 'كم وحدة أساس في هذه الوحدة؟ (كرتون = 24 قطعة)',

  // ===== بطاقة الصنف (§6.5) =====
  cardNotFound: 'الصنف غير موجود',
  cardNotFoundHint: 'ربما حُذف رابطه — عد لقائمة الأصناف',
  qrHint: 'امسح الرمز لفتح بطاقة الصنف',
  stocksTitle: 'الأرصدة بالمخازن',
  totalStockLabel: 'الرصيد الكلي',
  pricesCardTitle: 'أسعار البيع',
  movementsTitle: 'آخر الحركات',
  noMovements: 'لا حركات بعد — تظهر الحركات هنا فور أول شراء أو بيع أو تسوية',
  editButton: common.edit,
  archiveButton: 'أرشفة',
  adjustStockButton: 'تعديل الرصيد',
  archiveTitle: 'أرشفة الصنف',
  archiveMessage:
    'سيختفي «{name}» من القوائم والمسح، لكنه يبقى في التقارير وحركاته محفوظة لا تُحذف، وباركوده يبقى محجوزاً له.',
  archiveWord: 'أرشفة',
  archivedToast: 'أُرشِف الصنف',
  archivedChip: common.statuses.archived,

  // ===== تعديل الرصيد (manual_adjust) =====
  adjustTitle: 'تعديل الرصيد',
  adjustCurrent: 'الرصيد الحالي: {qty}',
  adjustNewQty: 'الكمية الجديدة',
  adjustReason: 'السبب (اختياري)',
  adjustReasonPlaceholder: 'مثال: جرد، تلف، هدية',
  adjustSave: 'تثبيت الرصيد',
  adjustedToast: 'حُدِّث الرصيد وسُجلت الحركة',
  movementTypes: {
    opening: 'افتتاحي',
    purchase: 'شراء',
    sale: 'بيع',
    sale_return: 'مرتجع بيع',
    purchase_return: 'مرتجع شراء',
    stocktake_adjust: 'تسوية جرد',
    manual_adjust: 'تعديل يدوي',
    transfer_in: 'تحويل وارد',
    transfer_out: 'تحويل صادر',
  } as Record<string, string>,
  movementUnknown: 'حركة',

  // ===== شاشة التنبيهات (FR-01-12) =====
  alertsTitle: 'تنبيهات المخزون',
  alertsEmptyTitle: 'كل شيء فوق الحد',
  alertsEmptyMessage: 'لا أصناف تحت حدّها الأدنى الآن — ستظهر التنبيهات هنا فور هبوط أي رصيد',
  minLabel: 'الحد',
  onHandLabel: 'الرصيد',
  shortBy: 'ينقص {qty} عن الحد',

  // ===== شاشة الفئات (FR-01-05) =====
  categoriesTitle: 'فئات الأصناف',
  categoriesEmpty: 'لا فئات بعد — أنشئ فئة لتنظيم أصنافك في شجرة بعمق مستويين',
  addCategory: 'فئة جديدة',
  editCategory: 'تعديل الفئة',
  archiveCategoryTitle: 'أرشفة الفئة',
  archiveCategoryMessage: 'ستختفي «{name}» من قوائم الاختيار. لا يمكن الأرشفة إلا لو لم يكن عليها أصناف فاعلة.',
  categoryArchivedToast: 'أُرشفت الفئة',
  subcategories: 'فئات فرعية',

  // ===== شاشة الوحدات (FR-01-05) =====
  unitsTitle: 'وحدات القياس',
  unitsEmpty: 'لا وحدات بعد — أضف «قطعة» و«كرتون» مع معامل التحويل',
  addUnit: 'وحدة جديدة',
  editUnit: 'تعديل الوحدة',
  unitArchivedToast: 'أُرشفت الوحدة',
  factorDisplay: '1 {name} = {factor} {base}',
  baseUnitNone: 'أساسية',
} as const;
