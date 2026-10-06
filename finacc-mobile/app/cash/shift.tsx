import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, MinusCircle, PlusCircle, Timer } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ErrorState,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  SelectField,
  StatusChip,
  TextField,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { common, cash as t, fill } from '@/i18n/ar';
import {
  cashboxBalances,
  closeShift,
  currentShift,
  lastShift,
  listCashTx,
  openShift,
  shiftExpected,
  type CashTxRow,
  type CashboxBalanceRow,
  type ShiftRow,
  type ShiftSummary,
} from '@/domain/cash';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { printShiftReport } from '@/services/doc-print';
import { printing as pr } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** الوردية (FR-04-04): فتح بعدّ افتتاحي → معادلة حية → إقفال بعدّ فعلي واعتماد الفرق. */
export default function ShiftScreen() {
  const showToast = useToastStore((st) => st.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<CashboxBalanceRow[]>([]);
  const [cashboxId, setCashboxId] = useState('');

  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [expected, setExpected] = useState<ShiftSummary | null>(null);
  const [windowTxs, setWindowTxs] = useState<CashTxRow[]>([]);
  const [closed, setClosed] = useState<ShiftRow | null>(null);

  // فتح الوردية
  const [openSheet, setOpenSheet] = useState(false);
  const [openingCount, setOpeningCount] = useState('');
  const [openBusy, setOpenBusy] = useState(false);

  // إقفال الوردية
  const [closeSheet, setCloseSheet] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [counted, setCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);
  const [result, setResult] = useState<{ expected: string; difference: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await cashboxBalances();
      setBoxes(list);
      setCashboxId((prev) => {
        if (prev !== '' && list.some((b) => String(b.id) === prev)) return prev;
        const def = list.find((b) => b.isDefault) ?? list[0];
        return def !== undefined ? String(def.id) : '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // حالة الصندوق المختار: وردية جارية + معادلتها + آخر إقفال
  const loadBoxState = useCallback(async (boxId: string) => {
    if (boxId === '') {
      setShift(null);
      setExpected(null);
      setWindowTxs([]);
      setClosed(null);
      setResult(null);
      return;
    }
    setResult(null);
    const id = Number(boxId);
    try {
      const [open, last] = await Promise.all([currentShift(id), lastShift(id)]);
      setShift(open);
      setClosed(open === null ? last : null);
      if (open !== null) {
        const [sum, txs] = await Promise.all([
          shiftExpected(id, open.openedAt),
          listCashTx({ cashboxId: id, dateFrom: open.openedAt.slice(0, 10), dateTo: todayISO(), limit: 200 }),
        ]);
        setExpected(sum);
        setWindowTxs(txs);
      } else {
        setExpected(null);
        setWindowTxs([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    }
  }, []);

  useEffect(() => {
    void loadBoxState(cashboxId);
  }, [cashboxId, loadBoxState]);

  const box = boxes.find((b) => String(b.id) === cashboxId);
  const boxOptions: SelectOption[] = boxes.map((b) => ({
    value: String(b.id),
    label: `${b.name} (${b.currencyCode})`,
    description: `${t.currentBalance}: ${b.balance}`,
  }));

  const drawerExpected =
    shift !== null && expected !== null
      ? dec(shift.openingCount ?? '0').plus(dec(expected.expected))
      : null;

  // ---- فتح الوردية ----
  const doOpen = async () => {
    if (box === undefined) return;
    setOpenBusy(true);
    try {
      await openShift(box.id, openingCount === '' ? '0' : openingCount);
      setOpenSheet(false);
      setOpeningCount('');
      showToast(t.shiftOpened);
      await loadBoxState(cashboxId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setOpenBusy(false);
    }
  };

  // ---- الإقفال ----
  const doClose = async () => {
    if (shift === null) return;
    setCloseBusy(true);
    try {
      const res = await closeShift(shift.id, counted === '' ? '0' : counted, closeNotes.trim().length > 0 ? closeNotes.trim() : undefined);
      setCloseSheet(false);
      setCounted('');
      setCloseNotes('');
      setResult(res);
      const diff = dec(res.difference);
      const desc =
        diff.isZero() ? t.matched : diff.greaterThan(0) ? fill(t.surplus, { n: '' }) : fill(t.deficit, { n: '' });
      showToast(fill(t.closeResult, { result: `${desc} ${res.difference}` }), { duration: 7000 });
      await loadBoxState(cashboxId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setCloseBusy(false);
    }
  };

  // ---- طباعة تقرير الوردية بعد الإقفال (الوحدة 10 — الموجة 6-b) ----
  const doPrintShiftReport = async () => {
    if (closed === null || printBusy) return;
    setPrintBusy(true);
    try {
      const name = boxes.find((b) => b.id === closed.cashboxId)?.name ?? '';
      await printShiftReport(closed, name);
    } catch (e) {
      showToast(e instanceof Error ? e.message : pr.shiftPrintFailed, { duration: 7000 });
    } finally {
      setPrintBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen title={t.shiftTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen title={t.shiftTitle} onBack={() => router.back()}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen title={t.shiftTitle} onBack={() => router.back()}>
      {boxes.length === 0 ? (
        <Text style={s.emptyText}>{t.noBoxes}</Text>
      ) : (
        <>
          <SelectField label={t.cashboxLabel} value={cashboxId} options={boxOptions} onSelect={setCashboxId} />

          {/* نتيجة آخر إقفال — تُعرض لحظة الإقفال ثم تبقى كسجل */}
          {result !== null ? <CloseResultCard expected={result.expected} difference={result.difference} /> : null}

          {closed !== null && result === null ? <ClosedRecordCard row={closed} /> : null}

          {/* طباعة تقرير الوردية بعد الإقفال — FR-10-05 */}
          {closed !== null ? (
            <SecondaryButton
              label={printBusy ? pr.printBusy : pr.printShiftReport}
              onPress={() => void doPrintShiftReport()}
              disabled={printBusy}
              style={s.printReportBtn}
            />
          ) : null}

          {shift === null ? (
            /* لا وردية مفتوحة */
            <AppCard style={s.openCard}>
              <Timer size={36} color={colors.muted} />
              <Text style={s.openTitle}>{t.openShiftTitle}</Text>
              <Text style={s.openMessage}>{t.openShiftMessage}</Text>
              <PrimaryButton label={t.openShiftBtn} onPress={() => setOpenSheet(true)} />
            </AppCard>
          ) : expected === null ? (
            <LoadingSkeleton variant="card" />
          ) : (
            <>
              {/* المعادلة الحية */}
              <SectionTitle title={fill(t.shiftOf, { box: box?.name ?? '' })} hint={`${t.openedAtLabel}: ${common.formatDate(shift.openedAt.slice(0, 10))}`} />
              <AppCard style={s.equationCard}>
                <View style={s.equRow}>
                  <Text style={s.equLabel}>{t.inCard}</Text>
                  <AmountText value={expected.expectedIn} decimals={box?.currencyDecimals ?? 2} tone="in" mark="sign" size={fontSizes.body} />
                </View>
                <View style={s.equRow}>
                  <Text style={s.equLabel}>{t.outCard}</Text>
                  <AmountText value={expected.expectedOut} decimals={box?.currencyDecimals ?? 2} tone="out" mark="sign" size={fontSizes.body} />
                </View>
                <View style={s.expectedRow}>
                  <Text style={s.expectedLabel}>{t.expectedCard}</Text>
                  <AmountText
                    value={expected.expected}
                    decimals={box?.currencyDecimals ?? 2}
                    tone="neutral"
                    mark="none"
                    size={fontSizes.display}
                    suffix={box?.currencyCode}
                  />
                </View>
                {drawerExpected !== null ? (
                  <View style={s.drawerRow}>
                    <Text style={s.drawerLabel}>{t.drawerExpected}</Text>
                    <Text style={s.drawerValue}>
                      {drawerExpected.toString()} {box?.currencyCode ?? ''}
                    </Text>
                  </View>
                ) : null}
              </AppCard>

              {/* حركات نافذة الوردية */}
              <SectionTitle title={t.windowTxTitle} hint={`${windowTxs.length}`} />
              {windowTxs.length === 0 ? (
                <Text style={s.emptyText}>{common.emptyList}</Text>
              ) : (
                <AppCard flush style={s.txsCard}>
                  {windowTxs.map((tx, i) => {
                    const isIn = tx.direction === 'in';
                    return (
                      <View key={tx.id} style={[s.windowRow, i < windowTxs.length - 1 && s.windowDivider]}>
                        <Text style={s.windowTitle} numberOfLines={1}>
                          {tx.description?.length ? tx.description : t.typeShort[tx.txType] ?? tx.txType}
                        </Text>
                        <AmountText
                          value={tx.amount}
                          decimals={tx.currencyDecimals}
                          tone={tx.direction === 'transfer' ? 'neutral' : isIn ? 'in' : 'out'}
                          mark="sign"
                          size={fontSizes.caption}
                        />
                      </View>
                    );
                  })}
                </AppCard>
              )}

              <PrimaryButton label={t.closeShiftBtn} onPress={() => setCloseSheet(true)} style={s.closeBtn} />
            </>
          )}
        </>
      )}

      {/* ============ الشيتات ============ */}

      {/* فتح الوردية: رصيد العد الافتتاحي */}
      <BottomSheet visible={openSheet} onClose={() => setOpenSheet(false)} title={t.openShiftBtn} dismissible={!openBusy}>
        <View style={s.sheetBody}>
          <Text style={s.sheetHint}>{t.openShiftMessage}</Text>
          <AmountPadField label={t.openingCountLabel} value={openingCount} onValue={setOpeningCount} suffix={box?.currencyCode} allowDecimal />
          <PrimaryButton label={t.openShiftBtn} onPress={() => void doOpen()} loading={openBusy} disabled={openBusy} />
        </View>
      </BottomSheet>

      {/* الإقفال: العد الفعلي */}
      <BottomSheet visible={closeSheet} onClose={() => setCloseSheet(false)} title={t.closeTitle} dismissible={!closeBusy}>
        <View style={s.sheetBody}>
          <Text style={s.sheetHint}>{t.countedHint}</Text>
          <AmountPadField label={t.countedLabel} value={counted} onValue={setCounted} suffix={box?.currencyCode} allowDecimal />
          {drawerExpected !== null ? (
            <View style={s.matchRow}>
              <Text style={s.matchLabel}>{t.expectedLabel}</Text>
              <Text style={s.matchValue}>
                {drawerExpected.toString()} {box?.currencyCode ?? ''}
              </Text>
              <SecondaryButton label={t.matchExpected} onPress={() => setCounted(drawerExpected.toString())} />
            </View>
          ) : null}
          <TextField label={t.closeNotesLabel} value={closeNotes} onChangeText={setCloseNotes} maxLength={200} multiline disabled={closeBusy} />
          <PrimaryButton label={t.closeConfirmBtn} onPress={() => void doClose()} loading={closeBusy} disabled={closeBusy || counted === ''} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** بطاقة نتيجة الإقفال — الفرق كبير بأيقونة واتجاه لوني وغير لوني. */
function CloseResultCard({ expected, difference }: { expected: string; difference: string }) {
  const diff = dec(difference);
  const zero = diff.isZero();
  const surplus = diff.greaterThan(0);
  return (
    <AppCard style={[s.resultCard, zero ? s.resultZero : surplus ? s.resultSurplus : s.resultDeficit]}>
      <Text style={s.resultTitle}>{t.resultTitle}</Text>
      {zero ? (
        <CheckCircle2 size={44} color={colors.success} />
      ) : surplus ? (
        <PlusCircle size={44} color={colors.success} />
      ) : (
        <MinusCircle size={44} color={colors.error} />
      )}
      <Text style={s.resultLabel}>{zero ? t.matched : surplus ? t.surplus : t.deficit}</Text>
      <AmountText
        value={difference}
        decimals={2}
        tone={zero ? 'neutral' : surplus ? 'in' : 'out'}
        mark={zero ? 'none' : 'sign'}
        size={fontSizes.display}
      />
      <View style={s.resultMeta}>
        <Text style={s.resultMetaLabel}>{t.expectedLabel}</Text>
        <Text style={s.resultMetaValue}>{expected}</Text>
      </View>
      <Text style={s.resultNote}>{t.resultNote}</Text>
    </AppCard>
  );
}

/** سجل آخر إقفال للصندوق. */
function ClosedRecordCard({ row }: { row: ShiftRow }) {
  const diff = dec(row.difference ?? '0');
  return (
    <AppCard style={s.closedCard}>
      <View style={s.closedHead}>
        <Text style={s.closedTitle}>{t.closedRecord}</Text>
        <StatusChip
          status={diff.isZero() ? 'cleared' : diff.greaterThan(0) ? 'cleared' : 'bounced'}
          label={diff.isZero() ? t.matched : diff.greaterThan(0) ? t.surplus : t.deficit}
          size="md"
        />
      </View>
      <View style={s.closedRow}>
        <Text style={s.closedLabel}>{t.openedAtLabel}</Text>
        <Text style={s.closedValue}>{common.formatDate(row.openedAt.slice(0, 10))}</Text>
      </View>
      {row.closedAt !== null ? (
        <View style={s.closedRow}>
          <Text style={s.closedLabel}>{t.closedAtLabel}</Text>
          <Text style={s.closedValue}>{common.formatDate(row.closedAt.slice(0, 10))}</Text>
        </View>
      ) : null}
      <View style={s.closedRow}>
        <Text style={s.closedLabel}>{t.differenceLabel}</Text>
        <AmountText
          value={row.difference ?? '0'}
          decimals={2}
          tone={diff.isZero() ? 'neutral' : diff.greaterThan(0) ? 'in' : 'out'}
          mark={diff.isZero() ? 'none' : 'sign'}
          size={fontSizes.body}
        />
      </View>
      {row.notes !== null && row.notes.length > 0 ? (
        <View style={s.closedRow}>
          <Text style={s.closedLabel}>{t.shiftNotes}</Text>
          <Text style={s.closedValue}>{row.notes}</Text>
        </View>
      ) : null}
    </AppCard>
  );
}

const s = StyleSheet.create({
  emptyText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    lineHeight: 19,
  },
  openCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  openTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  openMessage: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // المعادلة
  equationCard: { gap: spacing.sm },
  equRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  equLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  expectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  expectedLabel: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  drawerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.extra.accentSoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  drawerLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.accent,
  },
  drawerValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.accent,
    includeFontPadding: false,
  },

  // حركات النافذة
  txsCard: { paddingHorizontal: spacing.md },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  windowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  windowTitle: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  closeBtn: { marginTop: spacing.md, marginBottom: spacing.lg },
  printReportBtn: { marginTop: spacing.md },

  // نتيجة الإقفال
  resultCard: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1.5,
  },
  resultZero: { borderColor: 'rgba(52, 211, 153, 0.45)' },
  resultSurplus: { borderColor: 'rgba(52, 211, 153, 0.45)' },
  resultDeficit: { borderColor: 'rgba(248, 113, 113, 0.45)' },
  resultTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  resultLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  resultMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  resultMetaLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  resultMetaValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  resultNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
  },

  // سجل الإقفال السابق
  closedCard: { gap: 6 },
  closedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  closedTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  closedRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  closedLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  closedValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },

  // الشيتات
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  sheetHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  matchRow: { gap: spacing.sm },
  matchLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  matchValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.accent,
    includeFontPadding: false,
  },
});
