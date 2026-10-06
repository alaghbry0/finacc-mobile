/**
 * نصوص وحدة العملات وأسعار الصرف (الوحدة 08 / الموجة 3-b — شاشة الإعدادات).
 */
export const currency = {
  title: 'العملات وأسعار الصرف',
  subtitle: 'أسعار يدوية لكل يوم — لقطة ثابتة على كل مستند',
  addCurrency: 'إضافة عملة',
  addCurrencyCode: 'الرمز (SAR)',
  addCurrencyCodeHint: '2–8 أحرف لاتينية كبيرة — مثل USD',
  addCurrencyName: 'الاسم',
  addCurrencyNamePlaceholder: 'مثال: يورو',
  addCurrencyDecimals: 'المنازل العشرية',
  addCurrencyDecimalsHint: '0 للريال اليمني، 2 لمعظم العملات',

  baseBadge: 'أساسية',
  inactiveBadge: 'موقوفة',
  activeLabel: 'مفعّلة',
  activateLabel: 'تفعيل',

  todayRate: 'سعر اليوم',
  todayRateDate: 'اليوم',
  noRateToday: 'لا سعر اليوم — أدخله',
  editRate: 'تعديل السعر',
  enterRate: 'إدخال السعر',
  rateSuffix: 'لكل 1 من هذه العملة',
  lastKnownRate: 'آخر سعر معروف',
  historySection: 'آخر الأسعار',
  historyEmpty: 'لا أسعار مسجلة بعد',
  moreHistory: 'سجل الأسعار',

  rateSavedToast: 'تم حفظ سعر اليوم',
  currencyAddedToast: 'تمت إضافة العملة',
  baseNoDisable: 'العملة الأساسية لا يمكن تعطيلها',

  missingRatesBanner: 'عملات بلا سعر اليوم — أدخل سعرها قبل أي حركة بها',
  baseTag: 'عملة الأساس',
  pickHint: 'غير الأساس؟ يلزم سعر اليوم وقت الحفظ',
} as const;
