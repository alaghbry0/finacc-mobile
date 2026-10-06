import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';

export interface ScreenHeaderAction {
  icon: ReactNode;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}

interface ScreenProps {
  /** عنوان كبير أعلى الشاشة (يُخفى الهيدر كليًا إن لم يُمرَّر) */
  title?: string;
  /** سطر توضيحي تحت العنوان */
  subtitle?: string;
  /** يظهر زر رجوع (سهم لليمين في RTL) — مرِّر onBack لتفعيله */
  onBack?: () => void;
  /** أزرار إجراءات يسار الهيدر (RTL) */
  actions?: ScreenHeaderAction[];
  /** جعل المحتوى قابلًا للتمرير */
  scroll?: boolean;
  /** حشوة أفقية افتراضية 16 */
  padded?: boolean;
  /** إظهار منطقة الأمان العلوية (افتراضي نعم) */
  topInset?: boolean;
  children: ReactNode;
  /** شريط سفلي ثابت (فوق منطقة الأمان السفلية) */
  footer?: ReactNode;
  style?: ViewStyle;
}

const NO_INSET: Edge[] = [];
const ALL_INSET: Edge[] = ['top', 'left', 'right', 'bottom'];

/**
 * Screen — غلاف كل شاشات التطبيق: خلفية DS-01 + SafeArea + هيدر اختياري
 * (عنوان كبير + رجوع + أزرار إجراءات) + محتوى قابل للتمرير + footer ثابت.
 * RTL تلقائي (التطبيق كله RTL) — زر الرجوع سهم لليمين.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  scroll = true,
  padded = true,
  topInset = true,
  children,
  footer,
  style,
}: ScreenProps) {
  const body = scroll ? (
    <ScrollView
      style={s.grow}
      contentContainerStyle={[s.scrollContent, padded && s.padded, !footer && { paddingBottom: spacing.xxl }]}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[s.grow, padded && s.padded]}>{children}</View>
  );

  return (
    <SafeAreaView style={s.safe} edges={topInset ? ALL_INSET : NO_INSET}>
      <View style={[s.root, style]}>
        {title !== undefined || onBack !== undefined || (actions !== undefined && actions.length > 0) ? (
          <View style={[s.header, !padded && s.headerFlush]}>
            <View style={s.headerRow}>
              {onBack !== undefined ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={common.back}
                  onPress={onBack}
                  style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
                  hitSlop={4}
                >
                  {/* في RTL: السابق/الرجوع سهم لليمين */}
                  <ChevronRight size={26} color={colors.textPrimary} />
                </Pressable>
              ) : null}
              <View style={s.titleWrap}>
                {title !== undefined ? <Text style={s.title} numberOfLines={2}>
                  {title}
                </Text> : null}
                {subtitle !== undefined ? <Text style={s.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text> : null}
              </View>
              {actions !== undefined && actions.length > 0 ? (
                <View style={s.actionsRow}>
                  {actions.map((a, i) => (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      onPress={a.onPress}
                      disabled={a.disabled}
                      style={({ pressed }) => [s.actionBtn, pressed && s.pressed, a.disabled && s.disabled]}
                      hitSlop={4}
                    >
                      {a.icon}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        {body}
        {footer !== undefined ? <View style={s.footer}>{footer}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  grow: { flex: 1 },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerFlush: { paddingHorizontal: 0 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleWrap: { flex: 1, justifyContent: 'center' },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  scrollContent: { flexGrow: 1 },
  padded: { paddingHorizontal: spacing.lg },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
