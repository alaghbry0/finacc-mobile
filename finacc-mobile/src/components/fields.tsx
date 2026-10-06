import { ReactNode, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { Calendar, Check, ChevronDown, Eye, EyeOff, Search } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { PrimaryButton, SecondaryButton } from './buttons';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { todayISO } from '@/utils/format';

// ============ Field (تسمية + خطأ أحمر تحتها) ============

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  style?: ViewStyle;
}

export function Field({ label, error, hint, required, children, style }: FieldProps) {
  return (
    <View style={[f.wrap, style]}>
      <Text style={f.label}>
        {label}
        {required ? <Text style={f.star}> *</Text> : null}
      </Text>
      {children}
      {error !== undefined && error !== null && error.length > 0 ? (
        <Text style={f.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text style={f.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ============ TextField ============

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address' | 'decimal-pad';
  multiline?: boolean;
  disabled?: boolean;
  maxLength?: number;
  style?: ViewStyle;
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  required,
  placeholder,
  keyboardType = 'default',
  multiline = false,
  disabled = false,
  maxLength,
  style,
}: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} style={style}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={!disabled}
        maxLength={maxLength}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={label}
        style={[f.input, multiline && f.inputMultiline, error !== undefined && error !== null && f.inputError]}
      />
    </Field>
  );
}

// ============ PasswordField ============

interface PasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  style?: ViewStyle;
}

export function PasswordField({ label, value, onChangeText, error, hint, placeholder, style }: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} style={style}>
      <View style={[f.pwRow, error !== undefined && error !== null && f.inputError]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={!show}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={label}
          style={[f.input, f.pwInput]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={show ? common.hide : common.show}
          onPress={() => setShow((v) => !v)}
          style={({ pressed }) => [f.eyeBtn, pressed && f.pressed]}
          hitSlop={4}
        >
          {show ? <EyeOff size={20} color={colors.textSecondary} /> : <Eye size={20} color={colors.textSecondary} />}
        </Pressable>
      </View>
    </Field>
  );
}

// ============ SelectField (BottomSheet + بحث بسيط) ============

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onSelect: (value: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchable?: boolean;
  style?: ViewStyle;
}

export function SelectField({
  label,
  value,
  options,
  onSelect,
  error,
  hint,
  required,
  disabled = false,
  placeholder,
  searchable = true,
  style,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return options;
    return options.filter((o) => o.label.includes(q) || o.value.includes(q) || o.description?.includes(q));
  }, [options, query]);

  return (
    <Field label={label} error={error} hint={hint} required={required} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          if (disabled) return;
          setQuery('');
          setOpen(true);
        }}
        style={({ pressed }) => [
          f.selectRow,
          pressed && f.pressed,
          disabled && f.disabled,
          error !== undefined && error !== null && f.inputError,
        ]}
      >
        <Text style={[f.selectText, selected === undefined && f.selectPlaceholder]} numberOfLines={1}>
          {selected !== undefined ? selected.label : (placeholder ?? '—')}
        </Text>
        <ChevronDown size={20} color={colors.muted} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={f.sheetBody}>
          {searchable && options.length > 5 ? (
            <View style={f.searchRow}>
              <Search size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={common.search}
                placeholderTextColor={colors.muted}
                style={f.searchInput}
                accessibilityLabel={common.search}
              />
            </View>
          ) : null}
          <View style={f.optionsList}>
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                  onPress={() => {
                    onSelect(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [f.optionRow, pressed && f.pressed, active && f.optionActive]}
                >
                  <View style={f.optionTextWrap}>
                    <Text style={[f.optionLabel, active && f.optionLabelActive]} numberOfLines={1}>
                      {o.label}
                    </Text>
                    {o.description !== undefined ? (
                      <Text style={f.optionDesc} numberOfLines={2}>
                        {o.description}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Check size={20} color={colors.accent} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
            {filtered.length === 0 ? (
              <Text style={f.noOptions}>{common.noResults}</Text>
            ) : null}
          </View>
        </View>
      </BottomSheet>
    </Field>
  );
}

// ============ DateField (ميلادي بسيط — لا مكتبة تقويم) ============

interface DateFieldProps {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  style?: ViewStyle;
}

function shiftISO(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return todayISO();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

export function DateField({ label, value, onChange, error, hint, required, style }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [draftError, setDraftError] = useState<string | null>(null);

  const openSheet = () => {
    setDraft(value);
    setDraftError(null);
    setOpen(true);
  };

  const commit = () => {
    const t = draft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      setDraftError(common.invalidDate);
      return;
    }
    const [y, mo, d] = t.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== mo - 1 ||
      dt.getDate() !== d
    ) {
      setDraftError(common.invalidDate);
      return;
    }
    onChange(t);
    setOpen(false);
  };

  return (
    <Field label={label} error={error ?? draftError} hint={hint} required={required} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={openSheet}
        style={({ pressed }) => [f.selectRow, pressed && f.pressed, error !== undefined && error !== null && f.inputError]}
      >
        <Text style={f.selectText}>{value.length > 0 ? value : '—'}</Text>
        <Calendar size={20} color={colors.muted} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={f.sheetBody}>
          <TextInput
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setDraftError(null);
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
            maxLength={10}
            accessibilityLabel={label}
            style={[f.input, { direction: 'ltr', textAlign: 'center', fontFamily: fonts.numeric }]}
          />
          {draftError !== null ? <Text style={f.error}>{draftError}</Text> : null}
          <View style={f.dayBtns}>
            <SecondaryButton label={common.minusDay} onPress={() => setDraft((d) => shiftISO(d, -1))} />
            <SecondaryButton label={common.today} onPress={() => setDraft(todayISO())} />
            <SecondaryButton label={common.plusDay} onPress={() => setDraft((d) => shiftISO(d, 1))} />
          </View>
          <PrimaryButton label={common.done} onPress={commit} />
        </View>
      </BottomSheet>
    </Field>
  );
}

// ============ الأنماط المشتركة ============

const f = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 6 },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  star: { color: colors.error },
  error: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.error,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 16,
  },
  input: {
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    textAlign: 'right',
  },
  inputMultiline: {
    minHeight: 96,
    paddingTop: spacing.md,
  },
  inputError: {
    borderColor: colors.error,
  },
  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingLeft: spacing.xs,
  },
  pwInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  eyeBtn: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  selectText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  selectPlaceholder: { color: colors.muted },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    paddingVertical: 10,
    textAlign: 'right',
  },
  optionsList: { gap: spacing.xs, maxHeight: 380 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  optionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  optionTextWrap: { flex: 1, gap: 2 },
  optionLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  optionLabelActive: { color: colors.accent, fontFamily: fonts.bodyBold },
  optionDesc: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  noOptions: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  dayBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
