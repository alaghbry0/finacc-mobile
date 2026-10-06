import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Lock } from 'lucide-react-native';
import { PrimaryButton } from './buttons';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface PermissionBlockedProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onRequestAccess?: () => void;
  style?: ViewStyle;
}

/** PermissionBlocked (DS-36): قفل + «هذه الشاشة تتطلب صلاحية المدير» + زر طلب الدخول (تُفعَّل في V1.1). */
export function PermissionBlocked({
  title,
  message,
  actionLabel,
  onRequestAccess,
  style,
}: PermissionBlockedProps) {
  return (
    <View style={[s.wrap, style]}>
      <View style={s.iconCircle}>
        <Lock size={38} color={colors.warning} />
      </View>
      <Text style={s.title}>{title ?? common.permissionBlockedTitle}</Text>
      <Text style={s.message}>{message ?? common.permissionBlockedMessage}</Text>
      {onRequestAccess !== undefined ? (
        <PrimaryButton label={actionLabel ?? common.requestAccess} onPress={onRequestAccess} />
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
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
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
});
