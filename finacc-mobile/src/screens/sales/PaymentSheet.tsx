import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import Decimal from 'decimal.js';
import { CreditCard } from 'lucide-react-native';
import { BottomSheet, NumberPad, PrimaryButton } from '@/components';
import { sales as t } from '@/i18n/ar';
import { fill } from '@/i18n/ar';
import { formatMoney } from '@/utils/format';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface PaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** إجمالي الفاتورة (نص Decimal). */
  total: string;
  currencyCode: string;
  decimals: number;
  /** هل رُبطت الفاتورة بعميل؟ (شرط «تحويل المتبقي آجلاً»). */
  hasCustomer: boolean;
  busy?: boolean;
  /** تأكيد الدفع: cash (المستلم ≥ الإجمالي) أو mixed (المتبقي آجل). */
  onConfirm: (opts: { mode: 'cash' | 'mixed'; received: string }) => void;
}

const QUICK_AMOUNTS = ['500', '1000', '2000', '5000'];

/**
 * PaymentSheet (DS-40 — مواصفة حرفية):
 * 1. الإجمالي المستحق كبيراً أعلى الشيت بعملة الفاتورة.
 * 2. حقل «المستلم» بلوحة NumberPad + الباقي لحظياً بخط كبير أخضر.
 * 3. شبكة فئات سريعة (500/1,000/2,000/5,000 — تُضاف للتراكم) + «المبلغ بالضبط».
 * 4. «تحويل المتبقي آجلاً» يظهر فقط عند المستلم < الإجمالي (FR-02-10).
 */
export function PaymentSheet({
  visible,
  onClose,
  total,
  currencyCode,
  decimals,
  hasCustomer,
  busy = false,
  onConfirm,
}: PaymentSheetProps) {
  const [received, setReceived] = useState('');
  const [restAsCredit, setRestAsCredit] = useState(false);

  useEffect(() => {
    if (visible) {
      setReceived('');
      setRestAsCredit(false);
    }
  }, [visible]);

  const totalD = useMemo(() => dec(total), [total]);
  const receivedD = useMemo(() => dec(received === '' ? '0' : received), [received]);
  const diff = receivedD.minus(totalD); // موجب = باقٍ للعميل / سالب = متبقٍ علينا

  const canConfirm =
    !busy &&
    ((receivedD.greaterThan(0) && diff.greaterThanOrEqualTo(0)) ||
      (restAsCredit && hasCustomer && receivedD.greaterThan(0) && diff.lessThan(0)));

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm({ mode: diff.lessThan(0) ? 'mixed' : 'cash', received: money0(receivedD) });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.paymentTitle} dismissible={!busy}>
      <View style={s.body}>
        {/* 1) الإجمالي المستحق كبيراً */}
        <View style={s.dueBox}>
          <Text style={s.dueLabel}>{t.amountDue}</Text>
          <Text style={s.dueValue} adjustsFontSizeToFit numberOfLines={1}>
            {formatMoney(totalD, decimals)}
          </Text>
          <Text style={s.dueCurrency}>{currencyCode}</Text>
        </View>

        {/* 2) المستلم + الباقي/المتبقي لحظياً */}
        <View style={s.changeRow}>
          <View style={[s.changeBox, diff.greaterThanOrEqualTo(0) ? s.changeGreen : s.changeRed]}>
            <Text style={s.changeLabel}>{diff.greaterThanOrEqualTo(0) ? t.changeLabel : t.remainingLabel}</Text>
            <Text style={[s.changeValue, { color: diff.greaterThanOrEqualTo(0) ? colors.success : colors.error }]}>
              {formatMoney(diff.abs(), decimals)}
            </Text>
          </View>
        </View>

        <NumberPad
          value={received}
          onValue={(v) => {
            setReceived(v);
            if (dec(v === '' ? '0' : v).greaterThanOrEqualTo(totalD)) setRestAsCredit(false);
          }}
          allowDecimal={decimals > 0}
          maxlength={13}
          suffix={currencyCode}
        />

        {/* 3) شبكة الفئات السريعة */}
        <View style={s.quickGrid}>
          {QUICK_AMOUNTS.map((amount) => (
            <Pressable
              key={amount}
              accessibilityRole="button"
              accessibilityLabel={`+${amount}`}
              onPress={() => setReceived(money0(receivedD.plus(new Decimal(amount))))}
              style={({ pressed }) => [s.quickBtn, pressed && s.pressed]}
            >
              <Text style={s.quickText}>{formatMoney(Number(amount), 0)}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.exactAmount}
            onPress={() => setReceived(money0(totalD))}
            style={({ pressed }) => [s.quickBtn, s.quickExact, pressed && s.pressed]}
          >
            <Text style={s.quickExactText}>{t.exactAmount}</Text>
          </Pressable>
        </View>

        {/* 4) تحويل المتبقي آجلاً — فقط عند المستلم < الإجمالي */}
        {diff.lessThan(0) && receivedD.greaterThan(0) ? (
          hasCustomer ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: restAsCredit }}
              onPress={() => setRestAsCredit((v) => !v)}
              style={({ pressed }) => [s.creditRow, restAsCredit && s.creditRowOn, pressed && s.pressed]}
            >
              <CreditCard size={20} color={restAsCredit ? colors.warning : colors.muted} />
              <Text style={[s.creditText, restAsCredit && s.creditTextOn]}>
                {fill(t.restCreditOn, { amount: formatMoney(diff.abs(), decimals) })}
              </Text>
              <View style={[s.checkbox, restAsCredit && s.checkboxOn]}>
                {restAsCredit ? <Text style={s.check}>✓</Text> : null}
              </View>
            </Pressable>
          ) : (
            <Text style={s.creditHint}>{t.restCreditNeedsCustomer}</Text>
          )
        ) : null}

        <PrimaryButton
          label={t.confirmPayment}
          onPress={confirm}
          disabled={!canConfirm}
          loading={busy}
        />
      </View>
    </BottomSheet>
  );
}

function money0(d: Decimal): string {
  return d.isZero() ? '0' : d.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

const s = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  dueBox: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  dueLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  dueValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 34,
    fontWeight: '700',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  dueCurrency: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  changeBox: {
    alignItems: 'center',
    gap: 2,
    minWidth: 180,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  changeGreen: {
    backgroundColor: colors.extra.successSoft,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  changeRed: {
    backgroundColor: colors.extra.errorSoft,
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  changeLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  changeValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 26,
    fontWeight: '700',
    includeFontPadding: false,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickBtn: {
    flexGrow: 1,
    minWidth: '22%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  quickText: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  quickExact: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.4)',
  },
  quickExactText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  creditRowOn: {
    backgroundColor: colors.extra.warningSoft,
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  creditText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  creditTextOn: {
    color: colors.warning,
    fontFamily: fonts.bodyBold,
  },
  creditHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    textAlign: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: colors.warning,
    backgroundColor: colors.warning,
  },
  check: {
    color: colors.bg,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    includeFontPadding: false,
  },
  pressed: { opacity: 0.85 },
});
