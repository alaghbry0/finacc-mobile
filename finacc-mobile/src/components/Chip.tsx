import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { common } from '@/i18n/ar';

interface ChipProps {
  label: string;
  /** إظهار زر الإغلاق (×) وتفعيل onClose */
  onClose?: () => void;
  onPress?: () => void;
  selected?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
}

/** Chip: شريحة صغيرة قابلة للإغلاق — للفلاتر والاختيارات المتعددة (فوق شاشة البيع). */
export function Chip({ label, onClose, onPress, selected = false, icon, style }: ChipProps) {
  const body = (
    <View style={[s.chip, selected && s.selected, style]}>
      {icon !== undefined ? icon : null}
      <Text style={[s.text, selected && s.textSelected]} numberOfLines={1}>
        {label}
      </Text>
      {onClose !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${common.remove} ${label}`}
          onPress={onClose}
          style={({ pressed }) => [s.close, pressed && s.pressed]}
          hitSlop={8}
        >
          <X size={14} color={selected ? colors.accent : colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );

  if (onPress === undefined) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [pressed && s.pressed]}
    >
      {body}
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.4)',
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  textSelected: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
  },
  close: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -2,
    marginHorizontal: -4,
  },
  pressed: { opacity: 0.85 },
});
