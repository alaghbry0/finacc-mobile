import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AmountField } from './AmountField';
import {
  AppCard,
  DateField,
  PrimaryButton,
  SectionTitle,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import { listActiveCurrencies, type CurrencyRow } from '@/domain/currency';
import { common, currency as currencyAr, parties as partiesAr } from '@/i18n/ar';
import { todayISO } from '@/utils/format';
import { spacing } from '@/theme';

/** نوع الطرف — يحدد الحقول والتسميات (الفرق الهيكلي الوحيد). */
export type PartyKind = 'customer' | 'supplier';

/** قيم النموذج الخام (نصوص) قبل تحويلها إلى مدخلات الدومين. */
export interface PartyFormValues {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  area: string;
  /** customer فقط: 'none' = بلا حد (NULL) / 'value' = قيمة محددة (0 تمنع الآجل). */
  creditLimitMode: 'none' | 'value';
  creditLimitValue: string;
  openingBalance: string;
  openingCurrencyId: number | null;
  openingRate: string;
  openingDate: string;
  notes: string;
}

export function emptyPartyValues(): PartyFormValues {
  return {
    name: '',
    phone: '',
    whatsapp: '',
    address: '',
    area: '',
    creditLimitMode: 'none',
    creditLimitValue: '',
    openingBalance: '',
    openingCurrencyId: null,
    openingRate: '',
    openingDate: todayISO(),
    notes: '',
  };
}

interface PartyFormProps {
  kind: PartyKind;
  initial?: PartyFormValues;
  submitLabel: string;
  busy?: boolean;
  /** يُستدعى بعد اجتياز تحقق النموذج — التحويل إلى مدخل الدومين مسؤولية الشاشة. */
  onSubmit: (values: PartyFormValues) => void;
}

/**
 * PartyForm — نموذج عميل/مورّد الموحّد (FR-03-01/03):
 * الاسم* + هاتف + واتساب + العنوان + المنطقة (عميل فقط) + حد الائتمان (عميل فقط —
 * بلا حد/قيمة مع شرح «0 يمنع الآجل كلياً») + الرصيد الافتتاحي بعملته وسعره وتاريخه
 * + ملاحظات. مبني حصراً من مكونات النظام الجاهزة.
 */
export function PartyForm({ kind, initial, submitLabel, busy = false, onSubmit }: PartyFormProps) {
  const [values, setValues] = useState<PartyFormValues>(initial ?? emptyPartyValues());
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [errors, setErrors] = useState<{ name?: string; openingRate?: string }>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listActiveCurrencies();
        if (!alive) return;
        setCurrencies(list);
        setValues((v) => (v.openingCurrencyId === null && list.length > 0 ? { ...v, openingCurrencyId: Number(list[0].id) } : v));
      } catch {
        /* شاشة الافتتاح تعالج الخطأ — هنا قائمة فارغة فقط */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const set = <K extends keyof PartyFormValues>(key: K, value: PartyFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === 'name') setErrors((e) => ({ ...e, name: undefined }));
    if (key === 'openingRate' || key === 'openingBalance') setErrors((e) => ({ ...e, openingRate: undefined }));
  };

  const selectedCurrency = useMemo(
    () => currencies.find((c) => Number(c.id) === values.openingCurrencyId),
    [currencies, values.openingCurrencyId],
  );
  const baseCurrency = useMemo(() => currencies.find((c) => Number(c.is_base) === 1), [currencies]);
  const isForeignOpening = selectedCurrency !== undefined && Number(selectedCurrency.is_base) !== 1;

  const currencyOptions = useMemo<SelectOption[]>(
    () =>
      currencies.map((c) => ({
        value: String(c.id),
        label: `${c.code} — ${c.name}`,
        description: Number(c.is_base) === 1 ? currencyAr.baseBadge : undefined,
      })),
    [currencies],
  );

  const creditOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'none', label: partiesAr.creditLimitNoLimit },
      { value: 'value', label: partiesAr.creditLimitValue },
    ],
    [],
  );

  const handleSubmit = () => {
    const next: { name?: string; openingRate?: string } = {};
    if (values.name.trim().length === 0) next.name = common.requiredField;
    if (isForeignOpening && values.openingBalance.length > 0 && values.openingRate.length === 0) {
      next.openingRate = partiesAr.openingRateMissing;
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(values);
  };

  return (
    <View style={s.wrap}>
      <AppCard>
        <TextField
          label={partiesAr.name}
          value={values.name}
          onChangeText={(t) => set('name', t)}
          error={errors.name}
          required
          placeholder={partiesAr.namePlaceholder}
        />
        <TextField
          label={partiesAr.phone}
          value={values.phone}
          onChangeText={(t) => set('phone', t)}
          keyboardType="phone-pad"
          hint={kind === 'customer' ? partiesAr.phoneHint : common.optionalField}
        />
        {kind === 'customer' ? (
          <TextField
            label={partiesAr.whatsapp}
            value={values.whatsapp}
            onChangeText={(t) => set('whatsapp', t)}
            keyboardType="phone-pad"
            hint={partiesAr.whatsappHint}
          />
        ) : null}
        <TextField
          label={partiesAr.address}
          value={values.address}
          onChangeText={(t) => set('address', t)}
          hint={common.optionalField}
        />
        {kind === 'customer' ? (
          <TextField
            label={partiesAr.area}
            value={values.area}
            onChangeText={(t) => set('area', t)}
            hint={common.optionalField}
          />
        ) : null}
        {kind === 'customer' ? (
          <>
            <SelectField
              label={partiesAr.creditLimit}
              value={values.creditLimitMode}
              options={creditOptions}
              onSelect={(v) => set('creditLimitMode', v === 'value' ? 'value' : 'none')}
              hint={partiesAr.creditLimitHint}
            />
            {values.creditLimitMode === 'value' ? (
              <AmountField
                label={partiesAr.creditLimitValue}
                value={values.creditLimitValue}
                onChange={(v) => set('creditLimitValue', v)}
                suffix={baseCurrency?.code}
              />
            ) : null}
          </>
        ) : null}
        <TextField
          label={partiesAr.notes}
          value={values.notes}
          onChangeText={(t) => set('notes', t)}
          multiline
          hint={common.optionalField}
        />
      </AppCard>

      <SectionTitle title={partiesAr.openingSection} />
      <AppCard>
        <AmountField
          label={partiesAr.openingBalance}
          value={values.openingBalance}
          onChange={(v) => set('openingBalance', v)}
          suffix={selectedCurrency?.code}
          hint={kind === 'customer' ? partiesAr.openingHintCustomer : partiesAr.openingHintSupplier}
        />
        <SelectField
          label={partiesAr.openingCurrency}
          value={values.openingCurrencyId === null ? null : String(values.openingCurrencyId)}
          options={currencyOptions}
          onSelect={(v) => {
            set('openingCurrencyId', Number(v));
            set('openingRate', '');
          }}
        />
        {isForeignOpening ? (
          <AmountField
            label={partiesAr.openingRate}
            value={values.openingRate}
            onChange={(v) => set('openingRate', v)}
            error={errors.openingRate}
            required
            suffix={baseCurrency?.code}
          />
        ) : null}
        <DateField
          label={partiesAr.openingDate}
          value={values.openingDate}
          onChange={(d) => set('openingDate', d)}
        />
      </AppCard>

      <PrimaryButton label={submitLabel} onPress={handleSubmit} loading={busy} disabled={busy} style={s.submit} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.lg, paddingBottom: spacing.xl },
  submit: { marginTop: spacing.xs },
});

/** تحويل قيم النموذج إلى مدخل الدومين (عميل). */
export function toCustomerInput(v: PartyFormValues) {
  const trim = (t: string): string | undefined => (t.trim().length > 0 ? t.trim() : undefined);
  return {
    name: v.name.trim(),
    phone: trim(v.phone),
    whatsapp: trim(v.whatsapp),
    address: trim(v.address),
    area: trim(v.area),
    // 'none' أو قيمة فارغة → NULL = بلا حد (الدومين يميز 0 = منع الآجل)
    creditLimit: v.creditLimitMode === 'value' && v.creditLimitValue.length > 0 ? v.creditLimitValue : null,
    openingBalance: v.openingBalance.length > 0 ? v.openingBalance : undefined,
    openingCurrencyId: v.openingCurrencyId ?? undefined,
    openingRate: v.openingRate.length > 0 ? v.openingRate : undefined,
    openingDate: v.openingDate.length > 0 ? v.openingDate : undefined,
    notes: trim(v.notes),
  };
}

/** تحويل قيم النموذج إلى مدخل الدومين (مورّد). */
export function toSupplierInput(v: PartyFormValues) {
  const c = toCustomerInput(v);
  return {
    name: c.name,
    phone: c.phone,
    address: c.address,
    openingBalance: c.openingBalance,
    openingCurrencyId: c.openingCurrencyId,
    openingRate: c.openingRate,
    openingDate: c.openingDate,
    notes: c.notes,
  };
}

/** تعبئة قيم النموذج من صف عميل قائم (للتعديل). */
export function valuesFromCustomer(row: {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  area: string | null;
  creditLimit: string | null;
  openingBalance: string;
  openingCurrencyId: number | null;
  openingRate: string | null;
  openingDate: string | null;
  notes: string | null;
}): PartyFormValues {
  return {
    ...emptyPartyValues(),
    name: row.name,
    phone: row.phone ?? '',
    whatsapp: row.whatsapp ?? '',
    address: row.address ?? '',
    area: row.area ?? '',
    creditLimitMode: row.creditLimit === null ? 'none' : 'value',
    creditLimitValue: row.creditLimit ?? '',
    openingBalance: row.openingBalance === '0' ? '' : row.openingBalance,
    openingCurrencyId: row.openingCurrencyId,
    openingRate: row.openingRate ?? '',
    openingDate: row.openingDate ?? todayISO(),
    notes: row.notes ?? '',
  };
}

/** تعبئة قيم النموذج من صف مورّد قائم (للتعديل). */
export function valuesFromSupplier(row: {
  name: string;
  phone: string | null;
  address: string | null;
  openingBalance: string;
  openingCurrencyId: number | null;
  openingRate: string | null;
  openingDate: string | null;
  notes: string | null;
}): PartyFormValues {
  return {
    ...valuesFromCustomer({
      name: row.name,
      phone: row.phone,
      whatsapp: null,
      address: row.address,
      area: null,
      creditLimit: null,
      openingBalance: row.openingBalance,
      openingCurrencyId: row.openingCurrencyId,
      openingRate: row.openingRate,
      openingDate: row.openingDate,
      notes: row.notes,
    }),
  };
}
