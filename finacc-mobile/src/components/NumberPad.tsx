import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { Delete } from 'lucide-react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface NumberPadProps {
  /** القيمة الخام كسلسلة أرقام (مثال: "1234" أو "1234.5") */
  value: string;
  onValue: (next: string) => void;
  /** السماح بنقطة عشرية واحدة (افتراضي لا — مناسب للـ PIN والكميات الصحيحة) */
  allowDecimal?: boolean;
  /** أقصى عدد خانات (شاملًا الفاصلة العشرية) */
  maxlength?: number;
  /** عرض شريط القيمة أعلى اللوحة مع فواصل الآلاف اللحظية */
  showDisplay?: boolean;
  /** يُمرَّر عند التضمين داخل BottomSheet */
  dismissible?: boolean;
  /** بادئة/لاحقة تظهر في شريط العرض (رمز عملة مثلاً) */
  suffix?: string;
  /** عنصر إضافي أسفل اللوحة (زر حفظ مثلاً) */
  footer?: ReactNode;
  style?: ViewStyle;
}

/** فواصل آلاف لحظية على قيمة قيد الإدخال (تحافظ على الجزء العشري أثناء الكتابة). */
export function formatInputDisplay(value: string): string {
  const [int, frac] = value.split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

function pressDigit(current: string, digit: string, allowDecimal: boolean, maxlength: number): string {
  if (current.length >= maxlength) return current;
  // لا تكرار الأصفار البادئة
  if (current === '0') return digit === '0' ? '0' : digit;
  return current + digit;
}

function pressDecimal(current: string, allowDecimal: boolean, maxlength: number): string {
  if (!allowDecimal) return current;
  if (current.includes('.')) return current;
  if (current.length >= maxlength) return current;
  return current.length === 0 ? '0.' : current + '.';
}

/**
 * NumberPad (DS-38): لوحة رقمية موحدة 3×4 — 0-9 + نقطة عشرية اختيارية +
 * مسح (long-press على السهم أو زر C عند منع العشري) + سهم تراجع،
 * مع فواصل آلاف لحظية في العرض العلوي. بلا لوحة نظام إطلاقًا.
 */
export function NumberPad({
  value,
  onValue,
  allowDecimal = false,
  maxlength = 15,
  showDisplay = true,
  dismissible: _dismissible = true,
  suffix,
  footer,
  style,
}: NumberPadProps) {
  const keys: Array<{ key: string; label?: string; icon?: ReactNode; onPress: () => void; onLongPress?: () => void; type?: 'digit' | 'util' }> = [
    { key: '1', label: '1', type: 'digit', onPress: () => onValue(pressDigit(value, '1', allowDecimal, maxlength)) },
    { key: '2', label: '2', type: 'digit', onPress: () => onValue(pressDigit(value, '2', allowDecimal, maxlength)) },
    { key: '3', label: '3', type: 'digit', onPress: () => onValue(pressDigit(value, '3', allowDecimal, maxlength)) },
    { key: '4', label: '4', type: 'digit', onPress: () => onValue(pressDigit(value, '4', allowDecimal, maxlength)) },
    { key: '5', label: '5', type: 'digit', onPress: () => onValue(pressDigit(value, '5', allowDecimal, maxlength)) },
    { key: '6', label: '6', type: 'digit', onPress: () => onValue(pressDigit(value, '6', allowDecimal, maxlength)) },
    { key: '7', label: '7', type: 'digit', onPress: () => onValue(pressDigit(value, '7', allowDecimal, maxlength)) },
    { key: '8', label: '8', type: 'digit', onPress: () => onValue(pressDigit(value, '8', allowDecimal, maxlength)) },
    { key: '9', label: '9', type: 'digit', onPress: () => onValue(pressDigit(value, '9', allowDecimal, maxlength)) },
    allowDecimal
      ? { key: 'dot', label: common.decimalSeparator, type: 'util' as const, onPress: () => onValue(pressDecimal(value, allowDecimal, maxlength)) }
      : {
          key: 'clear',
          label: common.clear,
          type: 'util' as const,
          onPress: () => onValue(''),
        },
    { key: '0', label: '0', type: 'digit', onPress: () => onValue(pressDigit(value, '0', allowDecimal, maxlength)) },
    {
      key: 'back',
      icon: <Delete size={26} color={colors.textPrimary} />,
      type: 'util' as const,
      onPress: () => onValue(value.length <= 1 ? '' : value.slice(0, -1)),
      onLongPress: () => onValue(''),
    },
  ];

  return (
    <View style={[s.wrap, style]}>
      {showDisplay ? (
        <View style={s.displayRow} pointerEvents="none">
          <Text style={s.display} numberOfLines={1} adjustsFontSizeToFit>
            {formatInputDisplay(value)}
          </Text>
          {suffix !== undefined ? <Text style={s.suffix}>{suffix}</Text> : null}
        </View>
      ) : null}
      <View style={s.grid}>
        {keys.map((k) => (
          <Pressable
            key={k.key}
            accessibilityRole="button"
            accessibilityLabel={k.label ?? common.backspace}
            onPress={k.onPress}
            onLongPress={k.onLongPress}
            delayLongPress={400}
            style={({ pressed }) => [
              s.key,
              k.type === 'util' && s.keyUtil,
              pressed && s.keyPressed,
            ]}
          >
            {k.icon !== undefined ? (
              k.icon
            ) : (
              <Text style={[s.keyText, k.type === 'util' && s.keyUtilText]}>{k.label}</Text>
            )}
          </Pressable>
        ))}
      </View>
      {footer !== undefined ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  displayRow: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  display: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 30,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  suffix: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  key: {
    width: '30.5%',
    flexGrow: 1,
    minHeight: 56,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyUtil: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.3)',
  },
  keyPressed: {
    opacity: 0.75,
    backgroundColor: colors.border,
  },
  keyText: {
    fontFamily: fonts.numeric,
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  keyUtilText: {
    fontSize: fontSizes.body,
    fontFamily: fonts.bodyBold,
    color: colors.accent,
  },
  footer: {
    marginTop: spacing.md,
  },
});
