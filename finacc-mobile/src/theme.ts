/**
 * نظام التصميم — الألوان DS-01→DS-11 حرفياً من SRS §6.1 + المسافات والأنصاف.
 */

export const colors = {
  /** DS-01 خلفية الشاشة الأساسية */
  bg: '#0F172A',
  /** DS-02 خلفية البطاقات والعناصر المرتفعة */
  card: '#1E293B',
  /** DS-03 حدود/فواصل خفيفة */
  border: '#334155',
  /** DS-04 اللون التمييزي الأساسي */
  accent: '#22D3EE',
  /** DS-05 تدرّج الهيدر/الشعار (من → إلى) */
  gradientFrom: '#06B6D4',
  gradientTo: '#0EA5E9',
  /** DS-06 نجاح/قبض/وارد */
  success: '#34D399',
  /** DS-07 خطأ/صرف/منتهي */
  error: '#F87171',
  /** DS-08 تحذير/آجل/قسط مستحق */
  warning: '#FBBF24',
  /** DS-09 نص أساسي */
  textPrimary: '#F1F5F9',
  /** DS-10 نص ثانوي/تسميات */
  textSecondary: '#CBD5E1',
  /** DS-11 ثيم فاتح (يتبع النظام — داكن افتراضي في V1) */
  light: { bg: '#F8FAFC', card: '#FFFFFF', accent: '#0891B2', text: '#0F172A' },
  /** رمادي «معلّق» من قواعد دلالة الألوان (§6.1) */
  muted: '#64748B',
  /**
   * خلفيات باهتة (12% شفافية) لشريحات الحالة والأزرار الخطرة — DS-26/DS-27.
   * تُستخدم كخلفية مع نص بلون الدلالة الكامل (تباين عالٍ فوقها).
   */
  extra: {
    successSoft: 'rgba(52, 211, 153, 0.12)',
    errorSoft: 'rgba(248, 113, 113, 0.12)',
    warningSoft: 'rgba(251, 191, 36, 0.12)',
    accentSoft: 'rgba(34, 211, 238, 0.12)',
    mutedSoft: 'rgba(100, 116, 139, 0.16)',
  },
} as const;

/** خلفية باهتة لأي لون دلالي (للاستخدامات الديناميكية خارج extra الثابتة). */
export function softTint(hex: string, alpha = 0.12): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** DS-12/DS-13: Tajawal للواجهة + IBM Plex Sans Arabic للأرقام والمبالغ */
export const fonts = {
  body: 'Tajawal_400Regular',
  bodyMedium: 'Tajawal_500Medium',
  bodyBold: 'Tajawal_700Bold',
  numeric: 'IBMPlexSansArabic_600SemiBold',
} as const;

/** DS-15: أحجام متدرجة — الحد الأدنى المطلق 12px */
export const fontSizes = {
  display: 28,
  title: 20,
  body: 15,
  caption: 13,
  micro: 12,
} as const;
