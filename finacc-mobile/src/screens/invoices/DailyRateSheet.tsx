import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { BottomSheet, NumberPad, PrimaryButton } from '@/components';
import { common, sales as t } from '@/i18n/ar';
import { setDailyRate } from '@/domain/currency';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface DailyRateSheetProps {
  visible: boolean;
  onClose: () => void;
  currencyId: number;
  /** التاريخ الذي فشل عنده الحفظ (من MissingRateError). */
  date: string;
  /** كود العملة للعرض فقط. */
  currencyCode?: string;
  /** يُستدعى بعد حفظ السعر بنجاح (الأصل يُعيد المحاولة تلقائياً). */
  onSaved: () => void;
}

/**
 * شيت إدخال سعر صرف اليوم (قرار 3 / FR-08-09): عند MissingRateError أثناء حفظ
 * فاتورة بعملة غير الأساس — NumberPad + «حفظ ومتابعة» (setDailyRate) ثم onSaved
 * ليعيد الأصل الحفظ تلقائياً.
 */
export function DailyRateSheet({
  visible,
  onClose,
  currencyId,
  date,
  currencyCode,
  onSaved,
}: DailyRateSheetProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setValue('');
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  const canSave = !busy && dec(value === '' ? '0' : value).greaterThan(0);

  const save = async () => {
    if (!canSave) {
      setError(t.rateInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setDailyRate(currencyId, date, value);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.rateTitle} dismissible={!busy}>
      <View style={s.body}>
        <View style={s.hintBox}>
          <AlertTriangle size={22} color={colors.warning} />
          <Text style={s.hintText}>
            {t.rateHint} {currencyCode !== undefined && currencyCode.length > 0 ? `(${currencyCode} · ${date})` : `(${date})`}
          </Text>
        </View>
        <NumberPad value={value} onValue={setValue} allowDecimal suffix={currencyCode} maxlength={12} />
        {error !== null ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={t.rateSave} onPress={() => void save()} loading={busy} disabled={busy} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: radii.md,
  },
  hintText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.error,
    lineHeight: 19,
  },
});
