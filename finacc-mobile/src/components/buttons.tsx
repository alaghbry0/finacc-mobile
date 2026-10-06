import { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** ارتفاع مخصص (الافتراضي 48 وفق DS-20 — لا تنزل عنه) */
  height?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const BUTTON_MIN_HEIGHT = 48;

/**
 * PrimaryButton (DS-20): خلفية #22D3EE نص داكن عريض نصف قطر 12 ارتفاع 48.
 * SecondaryButton: حدود + نص ثانوي. DangerButton: خلفية حمراء باهتة + نص أحمر (DS-27).
 * جميع الأزرار ≥48 والضغط opacity 0.85 (DS-29).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  height = BUTTON_MIN_HEIGHT,
  style,
  textStyle,
}: ButtonProps) {
  const pressedStyle = ({ pressed }: { pressed: boolean }) => [
    s.base,
    height >= BUTTON_MIN_HEIGHT ? { height } : { height: BUTTON_MIN_HEIGHT },
    s[variant],
    (pressed || loading) && s.pressed,
    (disabled || loading) && s.disabled,
    style,
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={pressedStyle}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.accent} size="small" />
      ) : (
        <Text style={[s.text, s[`${variant}Text` as const], textStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="primary" />;
}

export function SecondaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="secondary" />;
}

export function DangerButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="danger" />;
}

interface IconButtonProps {
  icon: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  size?: number;
  color?: 'default' | 'accent' | 'danger';
  style?: ViewStyle;
}

/** IconButton — هدف لمس ≥48×48 (DS-29) مع حالة ضغط 0.85. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  size = 48,
  color = 'default',
  style,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: radii.md },
        s.iconDefault,
        s[`${color}Icon` as const],
        pressed && s.pressed,
        disabled && s.disabled,
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  text: {
    fontSize: fontSizes.body,
    fontWeight: '700',
    fontFamily: fonts.bodyBold,
    includeFontPadding: false,
  },
  primaryText: { color: colors.bg },
  secondaryText: { color: colors.textSecondary, fontFamily: fonts.bodyMedium },
  dangerText: { color: colors.error, fontFamily: fonts.bodyBold },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  iconDefault: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  defaultIcon: {},
  accentIcon: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  dangerIcon: {
    backgroundColor: colors.extra.errorSoft,
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
});
