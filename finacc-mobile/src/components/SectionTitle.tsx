import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { colors, fontSizes, fonts, spacing } from '@/theme';

interface SectionTitleProps {
  title: string;
  /** سطر توضيحي صغير تحت العنوان */
  hint?: string;
  /** رابط إجراء جانبي مثل «عرض الكل» */
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  style?: ViewStyle;
}

/** SectionTitle: عنوان مقطع صغير + إجراء جانبي اختياري (عرض الكل…). */
export function SectionTitle({ title, hint, actionLabel, onAction, icon, style }: SectionTitleProps) {
  return (
    <View style={[s.wrap, style]}>
    <View style={s.row}>
      <View style={s.titleWrap}>
        {icon !== undefined ? icon : null}
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [s.action, pressed && s.pressed]}
          hitSlop={8}
        >
          <Text style={s.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
    {hint !== undefined ? (
      <Text style={s.hint} numberOfLines={2}>
        {hint}
      </Text>
    ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 48,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  action: {
    minHeight: 48,
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  pressed: { opacity: 0.85 },
  wrap: {
    marginBottom: spacing.sm,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
});
