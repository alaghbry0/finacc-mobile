import { isNativePlatform } from '@/utils/platform';

/**
 * خدمة الطباعة والمشاركة الفعلية (الوحدة 10):
 * - native: expo-print (طباعة نظام / PDF) + expo-sharing + expo-linking — كلها import
 *   ديناميكي داخل شرط المنصة حتى لا يكسر التصدير الثابت للويب.
 * - web: نافذة جديدة تُكتب بالـ HTML ثم تُستدعى print() — هذه هي نافذة الطباعة
 *   الحقيقية في المتصفح (المعاينة = نفس التبويب الذي يطبع).
 *
 * الطباعة الحرارية BLE (FR-10-03/04): وحدة native تعمل على الجهاز فقط (§3.5) —
 *expo-print هنا هو نفس مسار الرستر عند EAS. على الويب الطابعة = حوار طباعة المتصفح.
 */

const isWeb = !isNativePlatform();

/** فتح HTML في تبويب جديد وكتابته ثم استدعاء الطباعة بعد جاهزية الخط. */
function printViaWindow(html: string): boolean {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  const w = window.open('', '_blank');
  if (w === null) return false;
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    // الطباعة بعد اكتمال التحميل (الخط من Google Fonts يُجلب وقت الطباعة فقط)
    const fire = (): void => {
      window.setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          /* بعض بيئات headless تحجب print() — التبويب نفسه يبقى معاينة صالحة */
        }
      }, 400);
    };
    if (w.document.readyState === 'complete') fire();
    else w.addEventListener('load', fire);
    return true;
  } catch {
    return false;
  }
}

/** بديل iframe مخفي عندما تُحجب النوافذ المنبثقة. */
function printViaIframe(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.inset = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.visibility = 'hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (doc === undefined || doc === null) {
    frame.remove();
    throw new Error('تعذر تجهيز المعاينة للطباعة — أعد المحاولة');
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      /* حجب headless — لا فادح */
    }
    window.setTimeout(() => frame.remove(), 60_000);
  }, 400);
}

/**
 * طباعة HTML فعلياً:
 * - الويب: تبويب جديد يعرض المستند ثم حوار طباعة المتصفح (المستخدم يختار الطابعة
 *   أو «حفظ كـ PDF») — وبديل iframe مخفي إن حُجبت النوافذ.
 * - الجهاز: expo-print printAsync (نظام الطباعة/المشاركة الأصلية).
 */
export async function printHtml(html: string, title?: string): Promise<void> {
  if (isWeb) {
    if (printViaWindow(html)) return;
    printViaIframe(html);
    return;
  }
  const Print = await import('expo-print');
  if (typeof Print.printAsync !== 'function') {
    throw new Error('الطباعة غير متاحة على هذا الجهاز — جرّب المشاركة كملف PDF');
  }
  await Print.printAsync({ html, ...(title !== undefined && title.length > 0 ? { name: title } : {}) });
}

/**
 * مشاركة المستند كملف PDF (FR-10-02/09):
 * - الجهاز: printToFileAsync ثم قائمة مشاركة النظام (واتساب/درايف/بلوتوث…).
 * - الويب: نفس نافذة الطباعة — المستخدم يحفظ PDF من حوار الطباعة.
 */
export async function shareHtmlAsPdf(html: string, fileName: string): Promise<string | null> {
  if (isWeb) {
    await printHtml(html, fileName);
    return null;
  }
  const Print = await import('expo-print');
  if (typeof Print.printToFileAsync !== 'function') {
    throw new Error('توليد PDF غير متاح على هذا الجهاز');
  }
  const { uri } = await Print.printToFileAsync({ html });
  const Sharing = await import('expo-sharing');
  const canShare = (await Sharing.isAvailableAsync()) === true;
  if (!canShare) return uri;
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: fileName,
    UTI: 'com.adobe.pdf',
  });
  return uri;
}

/** أرقام الهاتف فقط (wa.me لا يقبل + أو مسافات). */
function waDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/**
 * إرسال رسالة واتساب (FR-10-02) — مع الملف إن مرّر HTML:
 * - الجهاز: مشاركة ملف PDF أولاً (يختار المستخدم واتساب) ثم فتح محادثة العميل.
 * - الويب: فتح wa.me برسالة نصية (المرفقات تُرفق من داخل واتساب بعد حفظ PDF).
 */
export async function sendWhatsApp(
  phone: string | null,
  message: string,
  opts?: { html?: string; fileName?: string },
): Promise<void> {
  if (opts?.html !== undefined && opts.fileName !== undefined && !isWeb) {
    try {
      await shareHtmlAsPdf(opts.html, opts.fileName);
    } catch {
      /* فشل توليد الملف لا يمنع فتح المحادثة */
    }
  }
  const digits = phone !== null && phone !== undefined ? waDigits(phone) : '';
  const url =
    digits.length > 0
      ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (isWeb) {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    return;
  }
  const Linking = await import('expo-linking');
  await Linking.openURL(url);
}
