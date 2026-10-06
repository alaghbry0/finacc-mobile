import { useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { BottomSheet, Field, NumberPad, PrimaryButton } from '@/components';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface AmountPadFieldProps {
  label: string;
  /** القيمة الخام كسلسلة أرقام (مثل "12500" أو "12.5") — '' تعني غير مدخل */
  value: string;
  onValue: (next: string) => void;
  /** لاحقة عرض (رمز عملة أو وحدة) */
  suffix?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  allowDecimal?: boolean;
  /** عنوان شيت الإدخال (افتراضي = label) */
  sheetTitle?: string;
  /** أقصى عدد خانات (شامل الفاصلة) */
  maxlength?: number;
  style?: ViewStyle;
}

/** فواصل آلاف لحظية على قيمة قيد الإدخال (تحافظ على الجزء العشري أثناء الكتابة). */
function formatGrouped(v: string): string {
  const [int, frac] = v.split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/**
 * AmountPadField: حقل مبلغ/كمية قابل للنقر يفتح NumberPad داخل BottomSheet —
 * نمط الإدخال المعتمد لكل الأرقام في التطبيق (لا لوحة نظام). القيمة تُعرض
 * بفواصل آلاف بخط IBM Plex مع tabular-nums (DS-18n).
 */
export function AmountPadField({
  label,
  value,
  onValue,
  suffix,
  hint,
  error,
  required,
  placeholder,
  allowDecimal = true,
  sheetTitle,
  maxlength = 15,
  style,
}: AmountPadFieldProps) {
  const [open, setOpen] = useState(false);
  const has = value !== '' && value !== undefined && value !== null;
  return (
    <Field label={label} error={error} hint={hint} required={required} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [s.row, pressed && s.pressed, error != null && s.rowError]}
      >
        <Text style={[s.value, !has && s.placeholder]} numberOfLines={1} adjustsFontSizeToFit>
          {has ? formatGrouped(value) : (placeholder ?? '—')}
        </Text>
        {suffix !== undefined && has ? <Text style={s.suffix}>{suffix}</Text> : null}
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label}>
        <View style={s.sheetBody}>
          <NumberPad
            value={value}
            onValue={onValue}
            allowDecimal={allowDecimal}
            maxlength={maxlength}
            suffix={suffix}
          />
          <PrimaryButton label={common.done} onPress={() => setOpen(false)} />
        </View>
      </BottomSheet>
    </Field>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowError: { borderColor: colors.error },
  value: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'right',
    includeFontPadding: false,
  },
  placeholder: { color: colors.muted, fontFamily: fonts.body },
  suffix: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
