import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, Landmark } from 'lucide-react-native';
import { AmountText, StatusChip, type DocStatus } from '@/components';
import { cheques as t, fill } from '@/i18n/ar';
import type { ChequeRow, ChequeStatus } from '@/domain/cheques';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { todayISO } from '@/utils/format';

interface ChequeCardProps {
  row: ChequeRow;
  /** آخر بطاقة في القائمة (بلا فاصل) */
  last?: boolean;
  onPress: () => void;
}

/** فرق الأيام بين تاريخ واليوم (موجب = المستقبل، سالب = فات). */
function daysFromToday(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO());
  if (m === null || today === null) return 0;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3]));
  return Math.round((target - now) / 86_400_000);
}

/**
 * خريطة حالة الشيك → حالة StatusChip (اللون) + النص المعروض.
 * «قيد التحصيل» كهرماني و«مودَع» رمادي — label يتجاوز نص الشريحة دائماً.
 */
const STATUS_MAP: Record<ChequeStatus, { chip: DocStatus; label: string }> = {
  // كهرماني (نفس دلالة credit في خريطة الألوان المشتركة)
  pending: { chip: 'credit', label: t.statusPending },
  // رمادي معلّق (مودَع بالبنك — لا أثر حتى التحصيل)
  deposited: { chip: 'pending', label: t.statusDeposited },
  cleared: { chip: 'cleared', label: t.statusCleared },
  bounced: { chip: 'bounced', label: t.statusBounced },
  void: { chip: 'void', label: t.statusVoid },
};

/**
 * بطاقة شيك (DS-22 مبسّطة داخل AppCard): اتجاه بأيقونة غير لونية + رقم mono
 * + البنك + المبلغ بعملته + شريحة الحالة + استحقاق/تأخر بلون تحذيري + الطرف.
 * النقر يفتح تفاصيل الشيك (بما يمرره المستدعي في onPress).
 */
export function ChequeCard({ row, last, onPress }: ChequeCardProps) {
  const status = STATUS_MAP[row.status] ?? STATUS_MAP.pending;
  const isFinal = row.status === 'cleared' || row.status === 'void';

  // سطر الاستحقاق/التأخر — يظهر للتتبع فقط (بعد الحسم لا معنى له)
  const dueText = useMemo(() => {
    if (isFinal) return null;
    const days = daysFromToday(row.dueDate);
    if (days === 0) return { text: t.dueToday, warn: true };
    if (days > 0) return { text: fill(t.dueInDays, { n: days }), warn: false };
    return { text: fill(t.dueOverdue, { n: Math.abs(days) }), warn: true };
  }, [isFinal, row.dueDate]);

  const isIn = row.direction === 'in';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${isIn ? t.directionIn : t.directionOut} ${row.chequeNo} — ${row.partyName}`}
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && s.pressed, last && s.cardLast]}
    >
      <View style={s.topRow}>
        <View style={s.iconWrap}>
          {isIn ? (
            <ArrowDownLeft size={26} color={colors.success} strokeWidth={2.4} />
          ) : (
            <ArrowUpRight size={26} color={colors.error} strokeWidth={2.4} />
          )}
        </View>
        <View style={s.midWrap}>
          <View style={s.noRow}>
            <Text style={s.chequeNo} numberOfLines={1}>
              {row.chequeNo}
            </Text>
            <Landmark size={14} color={colors.muted} />
          </View>
          <Text style={s.party} numberOfLines={1}>
            {row.partyName}
            {row.bankName !== null && row.bankName.length > 0 ? ` · ${row.bankName}` : ''}
          </Text>
        </View>
        <AmountText
          value={row.amount}
          decimals={row.decimals}
          tone={isIn ? 'in' : 'out'}
          suffix={row.currencyCode}
          size={fontSizes.body}
        />
      </View>

      <View style={s.bottomRow}>
        <StatusChip status={status.chip} label={status.label} />
        {dueText !== null ? (
          <Text style={[s.dueText, dueText.warn && s.dueTextWarn]} numberOfLines={1}>
            {dueText.text}
          </Text>
        ) : null}
        <View style={s.spacer} />
        {row.refInvoiceNo !== null && row.refInvoiceNo.length > 0 ? (
          <Text style={s.invoiceTag} numberOfLines={1}>
            {fill(t.linkedInvoice, { no: row.refInvoiceNo })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLast: { marginBottom: 0 },
  pressed: { opacity: 0.85 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  midWrap: { flex: 1, gap: 2 },
  noRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chequeNo: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    direction: 'ltr',
    textAlign: 'right',
    includeFontPadding: false,
  },
  party: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  dueText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  dueTextWarn: { color: colors.warning },
  spacer: { flex: 1 },
  invoiceTag: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.accent,
  },
});
