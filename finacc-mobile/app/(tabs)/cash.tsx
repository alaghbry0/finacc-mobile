import { ReactNode, useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Banknote,
  Landmark,
  Plus,
  ShoppingBag,
  Timer,
  UserMinus,
  UserPlus,
} from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  StatusChip,
} from '@/components';
import { common, cash as t, fill } from '@/i18n/ar';
import {
  cashboxBalances,
  consumeVoucherNo,
  listCashTx,
  voidCashTx,
  type CashTxRow,
  type CashboxBalanceRow,
} from '@/domain/cash';
import { ChequesTab } from '@/screens/cash/ChequesTab';
import { VoucherSheet } from '@/screens/cash/VoucherSheet';
import { VoidCashTxSheet } from '@/screens/cash/VoidCashTxSheet';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

type InnerTab = 'txs' | 'cheques';

/** أيقونة نوع الحركة — دلالة غير لونية (شكل) + لون الدلالة. */
function txIcon(txType: string, isIn: boolean): ReactNode {
  const inColor = colors.success;
  const outColor = colors.error;
  switch (txType) {
    case 'receipt':
      return <ArrowDownCircle size={24} color={inColor} strokeWidth={2.2} />;
    case 'payment':
      return <ArrowUpCircle size={24} color={outColor} strokeWidth={2.2} />;
    case 'expense':
      return <ShoppingBag size={24} color={outColor} strokeWidth={2.2} />;
    case 'owner_draw':
      return <UserMinus size={24} color={outColor} strokeWidth={2.2} />;
    case 'capital_in':
      return <UserPlus size={24} color={inColor} strokeWidth={2.2} />;
    case 'box_transfer':
      return <ArrowLeftRight size={24} color={colors.accent} strokeWidth={2.2} />;
    case 'bank_deposit':
      return <Landmark size={24} color={inColor} strokeWidth={2.2} />;
    case 'bank_withdraw':
      return <Landmark size={24} color={outColor} strokeWidth={2.2} />;
    default:
      return <Banknote size={24} color={inColor} strokeWidth={2.2} />;
  }
}

/** عنوان الصف = وصف الحركة أو نوعها + الطرف. */
function txTitle(tx: CashTxRow): string {
  const base = tx.description !== null && tx.description.length > 0 ? tx.description : (t.typeShort[tx.txType] ?? tx.txType);
  const party = tx.customerName ?? tx.supplierName ?? tx.expenseCategoryName;
  if (party === null || party === undefined) {
    if (tx.txType === 'box_transfer' && tx.toCashboxName !== null) {
      return `${base} → ${tx.toCashboxName}`;
    }
    return base;
  }
  return `${base} — ${party}`;
}

/** شاشة النقدية الرئيسية (§6.4): الصناديق بأرصدتها + الحركات + تبويب الشيكات. */
export default function CashScreen() {
  const showToast = useToastStore((st) => st.show);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<CashboxBalanceRow[]>([]);
  const [txs, setTxs] = useState<CashTxRow[]>([]);
  const [tab, setTab] = useState<InnerTab>('txs');

  // شيت التفاصيل + السند
  const [detail, setDetail] = useState<CashTxRow | null>(null);
  const [voucherNo, setVoucherNo] = useState<string | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  // إلغاء الحركة
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const [balances, rows] = await Promise.all([cashboxBalances(), listCashTx({ limit: 100 })]);
        setBoxes(balances);
        setTxs(rows);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : t.loadError);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  // تحديث عند كل تركيز للشاشة (عودة من حركة جديدة/الوردية/الشيكات)
  useFocusEffect(
    useCallback(() => {
      void load(loading === false);
    }, [load, loading]),
  );

  // ---- طباعة سند مرقّم (FR-04-10) ----
  const printVoucher = async () => {
    if (detail === null) return;
    setPrintBusy(true);
    try {
      const no = await consumeVoucherNo(detail.id);
      setVoucherNo(no);
      setVoucherOpen(true);
      // حدّث رقم السند في القائمة المحلية (شارة السند)
      setTxs((prev) => prev.map((r) => (r.id === detail.id ? { ...r, voucherNo: no } : r)));
      setDetail((prev) => (prev !== null && prev.id === detail.id ? { ...prev, voucherNo: no } : prev));
      showToast(fill(t.voucherConsumed, { no }), { tone: 'neutral' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setPrintBusy(false);
    }
  };

  // ---- إلغاء الحركة (FR-04-08) ----
  const doVoid = async (reason: string) => {
    if (detail === null) return;
    setVoidBusy(true);
    try {
      await voidCashTx(detail.id, { managerConfirmed: true, reason });
      setVoidOpen(false);
      setDetail(null);
      showToast(t.voidDone);
      await load(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setVoidBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen title={t.title}>
        <LoadingSkeleton variant="tiles" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen title={t.title}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen title={t.title}>
      {/* أزرار الدخول السريع */}
      <View style={s.actionsRow}>
        <PrimaryButton
          label={t.newTx}
          onPress={() => router.push('/cash/tx-new')}
          style={s.actionGrow}
          textStyle={s.primaryText}
        />
        <SecondaryButton
          label={t.shift}
          onPress={() => router.push('/cash/shift')}
          style={s.actionGrow}
        />
      </View>

      {/* الصناديق (قرار 8/9) */}
      <SectionTitle title={t.boxesSection} hint={t.boxesHint} />
      <View style={s.boxesRow}>
        {boxes.map((b) => {
          const negative = dec(b.balance).isNegative();
          return (
            <View
              key={b.id}
              style={[s.boxCard, negative && s.boxCardNegative]}
              accessibilityLabel={`${b.name} — ${t.currentBalance} ${b.balance} ${b.currencyCode}`}
            >
              <View style={s.boxHead}>
                <Text style={s.boxName} numberOfLines={1}>
                  {b.name}
                </Text>
                <Text style={s.boxCode}>{b.currencyCode}</Text>
              </View>
              <AmountText
                value={b.balance}
                decimals={b.currencyDecimals}
                tone={negative ? 'out' : 'neutral'}
                mark="none"
                size={fontSizes.title}
                color={negative ? colors.error : colors.textPrimary}
              />
              {negative ? (
                <View style={s.negativeBadge}>
                  <Text style={s.negativeBadgeText}>{t.negativeDeficit}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        {boxes.length === 0 ? (
          <View style={s.boxCard}>
            <Text style={s.boxName}>{t.noBoxes}</Text>
          </View>
        ) : null}
      </View>

      {/* تبويب داخلي: الحركات | الشيكات */}
      <View style={s.segment}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'txs' }}
          onPress={() => setTab('txs')}
          style={[s.segBtn, tab === 'txs' && s.segBtnActive]}
        >
          <Text style={[s.segText, tab === 'txs' && s.segTextActive]}>{t.txsTab}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'cheques' }}
          onPress={() => setTab('cheques')}
          style={[s.segBtn, tab === 'cheques' && s.segBtnActive]}
        >
          <Text style={[s.segText, tab === 'cheques' && s.segTextActive]}>{t.chequesTab}</Text>
        </Pressable>
      </View>

      {tab === 'cheques' ? (
        <ChequesTab />
      ) : txs.length === 0 ? (
        <EmptyState
          icon={<Banknote size={36} color={colors.muted} />}
          title={t.emptyTitle}
          message={t.emptyMessage}
          actionLabel={t.emptyAction}
          onAction={() => router.push('/cash/tx-new')}
        />
      ) : (
        <AppCard flush style={s.listCard}>
          {txs.map((tx, i) => {
            const isIn = tx.direction === 'in';
            const isTransfer = tx.direction === 'transfer';
            return (
              <Pressable
                key={tx.id}
                accessibilityRole="button"
                accessibilityLabel={txTitle(tx)}
                onPress={() => setDetail(tx)}
                style={({ pressed }) => [s.txRow, i < txs.length - 1 && s.txDivider, pressed && s.pressed]}
              >
                {txIcon(tx.txType, isIn)}
                <View style={s.txText}>
                  <Text style={[s.txTitle, (tx.isVoided || tx.isReversal) && s.txTitleFaded]} numberOfLines={1}>
                    {txTitle(tx)}
                  </Text>
                  <View style={s.txMeta}>
                    <Text style={s.txDate}>{common.formatDate(tx.txDate)}</Text>
                    {tx.voucherNo !== null && tx.voucherNo.length > 0 ? (
                      <Text style={s.voucherTag} numberOfLines={1}>
                        {tx.voucherNo}
                      </Text>
                    ) : null}
                    {tx.hasFx ? <Text style={s.fxTag}>{t.fxBadge}</Text> : null}
                    {tx.isVoided ? <StatusChip status="void" label={t.voidedBadge} size="sm" /> : null}
                    {tx.isReversal ? <StatusChip status="pending" label={t.reversalBadge} size="sm" /> : null}
                  </View>
                </View>
                <AmountText
                  value={tx.amount}
                  decimals={tx.currencyDecimals}
                  tone={isTransfer ? 'neutral' : isIn ? 'in' : 'out'}
                  mark="sign"
                  size={fontSizes.body}
                  suffix={tx.currencyCode}
                />
              </Pressable>
            );
          })}
        </AppCard>
      )}

      {/* ============ شيت تفاصيل الحركة ============ */}
      <BottomSheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={t.detailsTitle}
      >
        {detail !== null ? (
          <View style={s.sheetBody}>
            <View style={s.detailHead}>
              {txIcon(detail.txType, detail.direction === 'in')}
              <Text style={s.detailType}>{t.types[detail.txType] ?? detail.txType}</Text>
            </View>
            <AmountText
              value={detail.amount}
              decimals={detail.currencyDecimals}
              tone={detail.direction === 'in' ? 'in' : 'out'}
              mark="sign"
              size={fontSizes.display}
              suffix={detail.currencyCode}
              style={s.detailAmount}
            />

            <View style={s.detailRows}>
              <DetailRow label={t.fieldDate} value={common.formatDate(detail.txDate)} />
              <DetailRow label={t.fieldCashbox} value={detail.cashboxName ?? '—'} />
              {detail.toCashboxName !== null ? (
                <DetailRow label={t.destCashboxLabel} value={detail.toCashboxName} />
              ) : null}
              {detail.customerName !== null ? (
                <DetailRow label={t.customerLabel} value={detail.customerName} />
              ) : null}
              {detail.supplierName !== null ? (
                <DetailRow label={t.supplierLabel} value={detail.supplierName} />
              ) : null}
              {detail.expenseCategoryName !== null ? (
                <DetailRow label={t.fieldCategory} value={detail.expenseCategoryName} />
              ) : null}
              {detail.refType !== null && detail.refType.length > 0 ? (
                <DetailRow label={t.fieldRef} value={refLabel(detail)} />
              ) : null}
              <DetailRow
                label={t.fieldVoucherNo}
                value={
                  detail.voucherNo !== null && detail.voucherNo.length > 0
                    ? detail.voucherNo
                    : t.noVoucherYet
                }
                mono={detail.voucherNo !== null}
              />
              <DetailRow label={t.fieldRate} value={String(detail.exchangeRate)} mono />
              {detail.hasFx ? (
                <DetailRow label={t.fieldFx} value={detail.fxGainLoss} mono />
              ) : null}
              {detail.description !== null && detail.description.length > 0 ? (
                <DetailRow label={t.fieldDesc} value={detail.description} />
              ) : null}
              {detail.settlementRate !== null && detail.settlementRate.length > 0 ? (
                <DetailRow label={t.fieldSettlementRate} value={detail.settlementRate} mono />
              ) : null}
            </View>

            {detail.isVoided || detail.isReversal ? (
              <Text style={s.voidNote}>{detail.isVoided ? t.voidedNote : t.reversalNote}</Text>
            ) : (
              <View style={s.sheetButtons}>
                <PrimaryButton
                  label={t.printVoucher}
                  onPress={() => void printVoucher()}
                  loading={printBusy}
                  disabled={printBusy}
                />
                <SecondaryButton label={t.voidTx} onPress={() => setVoidOpen(true)} />
              </View>
            )}
          </View>
        ) : null}
      </BottomSheet>

      {/* معاينة السند المرقّم بعد الاستهلاك */}
      <VoucherSheet
        visible={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        tx={voucherOpen && detail !== null ? detail : null}
        voucherNo={voucherNo ?? ''}
      />

      {/* إلغاء الحركة */}
      <VoidCashTxSheet
        visible={voidOpen}
        onClose={() => setVoidOpen(false)}
        txLabel={`${t.typeShort[detail?.txType ?? ''] ?? ''} ${detail?.amount ?? ''} ${detail?.currencyCode ?? ''}`.trim()}
        busy={voidBusy}
        onVoid={(reason) => void doVoid(reason)}
      />
    </Screen>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text
        style={[s.detailValue, mono === true && s.detailValueMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** نص المرجع حسب نوعه. */
function refLabel(tx: CashTxRow): string {
  switch (tx.refType) {
    case 'invoice':
      return t.refInvoice;
    case 'installment':
      return t.refInstallment;
    case 'on_account':
      return t.refOnAccount;
    case 'stocktake':
      return t.refStocktake;
    default:
      return tx.refType ?? '—';
  }
}

const s = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actionGrow: { flex: 1 },
  primaryText: { fontSize: fontSizes.caption },

  // الصناديق
  boxesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  boxCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  boxCardNegative: { borderColor: 'rgba(248, 113, 113, 0.45)' },
  boxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  boxName: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  boxCode: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.muted,
    direction: 'ltr',
  },
  negativeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    borderRadius: radii.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  negativeBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.error,
  },

  // التبويب الداخلي
  segment: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  segBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  segBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  segText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  segTextActive: {
    fontFamily: fonts.bodyBold,
    color: colors.accent,
  },

  // قائمة الحركات
  listCard: { paddingHorizontal: spacing.md },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  txDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  txText: { flex: 1, gap: 2 },
  txTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  txTitleFaded: { color: colors.muted },
  txMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  txDate: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  voucherTag: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.accent,
    direction: 'ltr',
  },
  fxTag: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.warning,
    backgroundColor: colors.extra.warningSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },

  // شيت التفاصيل
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailType: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  detailAmount: { alignSelf: 'center' },
  detailRows: { gap: 6 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 26,
    alignItems: 'center',
  },
  detailLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  detailValue: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  detailValueMono: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    direction: 'ltr',
  },
  sheetButtons: { gap: spacing.sm, marginTop: spacing.xs },
  voidNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
