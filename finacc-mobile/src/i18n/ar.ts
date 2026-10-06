/**
 * سجل النصوص العربية — V1: كائن مؤقت واحد (common) بمفاتيح مسطحة نقية.
 * (كل وحدة لاحقة تضيف ملفها الخاص وفق القرار في worklog §i18n).
 */
export const common = {
  appName: 'المُحاسِب الشخصي',
  tagline: 'محاسبة ومخزون — أوفلاين 100%',
  dbCheckTitle: 'فحص قاعدة البيانات',
  tables: 'عدد الجداول',
  migrationVersion: 'إصدار الهجرة المطبق',
  currencies: 'العملات (seed)',
  companies: 'الشركات',
  seedData: 'إنشاء بيانات تجريبية',
  clearData: 'مسح البيانات',
  loading: 'جارٍ تهيئة قاعدة البيانات…',
  errorTitle: 'حدث خطأ',
  engineNote: 'sql.js + IndexedDB في المعاينة — expo-sqlite على الجهاز',
} as const;

export const ar = { common };
