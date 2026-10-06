import { useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { ChevronDown, ChevronUp, CloudOff } from 'lucide-react-native';
import { PrimaryButton } from './buttons';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ErrorStateProps {
  /** «ماذا حدث» بكلمات المستخدم (النموذج المعتمد §6.3) */
  title?: string;
  /** الحل المقترح — إن لم يُمرَّر استُخدم common.errorGeneral */
  message?: string;
  /** تفاصيل تقنية خام (err.message عادة) — تُعرض قابلة للتوسيع */
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

/**
 * ErrorState (DS-33): أيقونة + «ماذا حدث» بكلمات المستخدم + زر إعادة المحاولة
 * + تفاصيل تقنية قابلة للتوسيع — لفشل الطباعة/النسخ/فتح القاعدة.
 */
export function ErrorState({ title, message, detail, retryLabel, onRetry, style }: ErrorStateProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[s.wrap, style]}>
      <View style={s.iconCircle}>
        <CloudOff size={38} color={colors.error} />
      </View>
      <Text style={s.title}>{title ?? common.whatHappened}</Text>
      <Text style={s.message}>{message ?? common.errorGeneral}</Text>
      {onRetry !== undefined ? (
        <PrimaryButton label={retryLabel ?? common.retry} onPress={onRetry} />
      ) : null}
      {detail !== undefined && detail.length > 0 ? (
        <View style={s.detailBox}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [s.detailToggle, pressed && s.pressed]}
            onPress={() => setExpanded((v) => !v)}
          >
            <Text style={s.detailLabel}>{common.technicalDetails}</Text>
            {expanded ? (
              <ChevronUp size={16} color={colors.muted} />
            ) : (
              <ChevronDown size={16} color={colors.muted} />
            )}
          </Pressable>
          {expanded ? <Text style={s.detailText}>{detail}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: radii.xl,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
  },
  detailBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.extra.mutedSoft,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxWidth: 420,
  },
  detailToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  detailLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  detailText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    lineHeight: 17,
    direction: 'ltr',
    textAlign: 'left',
  },
  pressed: { opacity: 0.85 },
});
