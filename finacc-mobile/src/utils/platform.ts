/**
 * كشف المنصة بلا استيراد react-native — استيراده في أعلى الملف يكسر bun test
 * (حزم RN بـ Flow لا يهضمها bun). نفس نتيجة Platform.OS عملياً:
 * - الجهاز: global.navigator.product === 'ReactNative' (يضبطه setUpNavigator) ولا DOM.
 * - المتصفح: document معرف (وnavigator.product فيه 'Gecko').
 * - الاختبارات (bun): لا navigator أصلاً → مسار الويب.
 */
export function isNativePlatform(): boolean {
  const g = globalThis as { navigator?: { product?: string }; document?: unknown };
  return g.navigator?.product === 'ReactNative' && g.document === undefined;
}
