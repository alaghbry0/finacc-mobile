import { Linking, Platform } from 'react-native';

/**
 * فتح روابط خارجية عبر المنصة (Task 3-b):
 * - web → window.open (تبويب جديد).
 * - native → Linking.openURL (تطبيق الهاتف/الواتساب).
 */

export async function openURL(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return false;
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** رابط اتصال هاتفي — tel: يعمل على الجهاز، وعلى الويب يُترك للمتصفح. */
export function telURL(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * رابط واتساب wa.me لرقم — يحتاج الصيغة الدولية بلا +:
 * - يبدأ بـ + أو 00 → كما هو (بلا البادئة).
 * - رقم محلي قصير (≤9 خانات) → يُسبق بمفتاح اليمن 967 (سوق التطبيق الأساسي —
 *   قرار عرضي موثق؛ أي رقم أطول يُستخدم كما هو).
 */
export function whatsappURL(phone: string): string {
  let digits = phone.replace(/[^\d]/g, '');
  if (phone.trim().startsWith('+')) {
    // صيغة دولية صريحة
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length > 0 && digits.length <= 9 && !digits.startsWith('967')) {
    digits = `967${digits}`;
  }
  return `https://wa.me/${digits}`;
}
