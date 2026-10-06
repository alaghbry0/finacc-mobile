import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Box } from 'lucide-react-native';
import { PrimaryButton } from './buttons';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface EmptyStateProps {
  /** رسمة/أيقونة كبيرة (افتراضي صندوق) */
  icon?: ReactNode;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  style?: ViewStyle;
}

/**
 * EmptyState (DS-25): رسمة + جملة + زر إجراء — «لا فواتير بعد — أنشئ أول فاتورة».
 * تُستخدم للقوائم الفارغة أول مرة (بلا فلاتر).
 */
export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[s.wrap, style]}>
      <View style={s.iconCircle}>{icon !== undefined ? icon : <Box size={40} color={colors.muted} />}</View>
      <Text style={s.title}>{title}</Text>
      {message !== undefined ? <Text style={s.message}>{message}</Text> : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <PrimaryButton label={actionLabel} onPress={onAction} />
      ) : null}
      {secondaryActionLabel !== undefined && onSecondaryAction !== undefined ? (
        <Text style={s.secondary} onPress={onSecondaryAction}>
          {secondaryActionLabel}
        </Text>
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
    width: 88,
    height: 88,
    borderRadius: radii.xl,
    backgroundColor: colors.extra.mutedSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
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
    maxWidth: 320,
  },
  secondary: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
    minHeight: 48,
    textAlignVertical: 'center',
    textDecorationLine: 'underline',
  },
});
