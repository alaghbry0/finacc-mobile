/**
 * بديل الويب لكاميرا المسح (قرار بيئة معلَّق في worklog): الكاميرا تعمل على
 * الجهاز فقط؛ في المعاينة الثابتة على الويب يُستخدم الإدخال اليدوي للباركود.
 * Metro يستبدل هذا الملف تلقائياً على منصة web (ولا يُحزم expo-camera إطلاقاً).
 */
export function ScanCamera(_props: { onScanned: (barcode: string) => void }) {
  return null;
}
