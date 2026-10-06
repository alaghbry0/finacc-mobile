import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { BottomSheet, Field, NumberPad, PrimaryButton, formatInputDisplay } from '@/components';
import { common } from '@/i18n/ar';
import { colors, fonts, radii, spacing } from '@/theme';

interface AmountFieldProps {
  label: string;
  /** القيمة الخام كسلسلة أرقام ('50000' أو '530.5') — '' = بلا قيمة. */
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string | null;
  suffix?: string;
  required?: boolean;
  placeholder?: string;
}

/**
 * AmountField — حقل مبلغ بـ NumberPad داخل BottomSheet (DS-38):
 * صف قابل للضغط يعرض القيمة المنسّقة، يفتح اللوحة الرقمية للإدخال.
 * مخصص لحقول المبالغ القليلة (رصيد افتتاحي / حد ائتمان / سعر صرف).
 */
export function AmountField({
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
  required,
  placeholder,
}: AmountFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openSheet = () => {
    setDraft(value);
    setOpen(true);
  };

  const commit = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={openSheet}
        style={({ pressed }) => [s.row, pressed && s.pressed, error !== undefined && error !== null && s.rowError]}
      >
        {value.length > 0 ? (
          <Text style={s.value}>{formatInputDisplay(value)}</Text>
        ) : (
          <Text style={s.placeholder}>{placeholder ?? common.amount}</Text>
        )}
        {suffix !== undefined ? <Text style={s.suffix}>{suffix}</Text> : null}
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={s.sheetBody}>
          <NumberPad value={draft} onValue={setDraft} allowDecimal maxlength={15} suffix={suffix} />
          <PrimaryButton label={common.done} onPress={commit} disabled={draft.length === 0} />
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
  },
  rowError: { borderColor: colors.error },
  value: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
    textAlign: 'left',
  },
  placeholder: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  suffix: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
