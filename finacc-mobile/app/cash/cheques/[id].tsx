import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  FileText,
  Landmark,
  Wallet,
} from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SelectField,
  StatusChip,
  TextField,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { DailyRateSheet } from '@/screens/invoices/DailyRateSheet';
import { common, cheques as t, fill } from '@/i18n/ar';
import {
  getCheque,
  markBounced,
  markCleared,
  markDeposited,
  voidCheque,
  type ChequeFull,
} from '@/domain/cheques';
import { listCashboxOptions, listExpenseCategories, type CashboxOptionRow, type ExpenseCategoryRow } from '@/domain/cash';
import { listInvoices, type InvoiceListRow } from '@/domain/invoicing';
import { MissingRateError } from '@/domain/currency';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** تفاصيل الشيك + دورة الحياة (FR-14): إيداع/تحصيل/ارتداد/إلغاء حسب الحالة. */
export default function ChequeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chequeId = Number(Array.isArray(id) ? id[0] : id);
  const showToast = useToastStore((st) => st.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ChequeFull | null>(null);

  // التحصيل (اختيار صندوق)
  const [clearSheet, setClearSheet] = useState(false);
  const [boxes, setBoxes] = useState<CashboxOptionRow[]>([]);
  const [clearBoxId, setClearBoxId] = useState('');
  const [busy, setBusy] = useState(false);

  // الارتداد (رسم اختياري + فئة + صندوق)
  const [bounceSheet, setBounceSheet] = useState(false);
  const [bounceFee, setBounceFee] = useState('');
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [bounceCatId, setBounceCatId] = useState('');
  const [bounceBoxId, setBounceBoxId] = useState('');

  // الإيداع والإلغاء
  const [depositConfirm, setDepositConfirm] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);

  // سعر مفقود أثناء التحصيل
  const [rateSheet, setRateSheet] = useState<{ currencyId: number; date: string } | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(chequeId) || chequeId <= 0) {
      setError(t.notFound);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const full = await getCheque(chequeId);
      if (full === null) {
        setData(null);
        setError(t.notFound);
      } else {
        setData(full);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [chequeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // صناديق + فئات عند فتح الشيتات
  useEffect(() => {
    if (!clearSheet && !bounceSheet) return;
    let alive = true;
    void (async () => {
      try {
        const [boxList, catList] = await Promise.all([listCashboxOptions(), listExpenseCategories()]);
        if (!alive) return;
        setBoxes(boxList);
        setCategories(catList);
        const match = data !== null ? boxList.find((b) => b.currencyId === data.currencyId) : undefined;
        if (match !== undefined) {
          setClearBoxId((prev) => (prev === '' ? String(match.id) : prev));
          setBounceBoxId((prev) => (prev === '' ? String(match.id) : prev));
        }
      } catch {
        /* تظهر رسالة الخطأ عند التنفيذ */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearSheet, bounceSheet, data]);

  // ---- الإيداع ----
  const doDeposit = async () => {
    setBusy(true);
    try {
      await markDeposited(chequeId);
      setDepositConfirm(false);
      showToast(t.depositedToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  // ---- التحصيل ----
  const doClear = async () => {
    if (clearBoxId === '') return;
    setBusy(true);
    try {
      const res = await markCleared(chequeId, { cashboxId: Number(clearBoxId) });
      setClearSheet(false);
      showToast(t.clearedToast);
      await load();
      void res;
    } catch (e) {
      if (e instanceof MissingRateError) {
        setClearSheet(false);
        setRateSheet({ currencyId: e.currencyId, date: e.date });
        retryRef.current = () => doClear();
        return;
      }
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  // ---- الارتداد ----
  const doBounce = async () => {
    setBusy(true);
    try {
      await markBounced(chequeId, {
        bounceFee: bounceFee === '' ? undefined : bounceFee,
        expenseCategoryId: bounceFee !== '' && dec(bounceFee).greaterThan(0) ? Number(bounceCatId) : undefined,
        cashboxId: bounceFee !== '' && dec(bounceFee).greaterThan(0) ? Number(bounceBoxId) : undefined,
      });
      setBounceSheet(false);
      setBounceFee('');
      setBounceCatId('');
      showToast(t.bouncedToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  // ---- الإلغاء ----
  const doVoid = async () => {
    setBusy(true);
    try {
      await voidCheque(chequeId, { managerConfirmed: true });
      setVoidConfirm(false);
      showToast(t.voidedToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen title={t.detailTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={3} />
      </Screen>
    );
  }

  if (error !== null || data === null) {
    return (
      <Screen title={t.detailTitle} onBack={() => router.back()}>
        <ErrorState message={error ?? t.notFound} onRetry={() => void load()} />
      </Screen>
    );
  }

  const c = data;
  const isIn = c.direction === 'in';
  const isOpen = c.status === 'pending' || c.status === 'deposited';

  // صناديق بعملة الشيك حصراً (قرار 8 — دفتر الصندوق بعملته)
  const matchingBoxes: SelectOption[] = boxes
    .filter((b) => b.currencyId === c.currencyId)
    .map((b) => ({ value: String(b.id), label: `${b.name} (${b.currencyCode})` }));

  return (
    <Screen title={t.detailTitle} onBack={() => router.back()}>
      {/* رأس الشيك */}
      <AppCard>
        <View style={s.headRow}>
          <View style={s.headIcon}>
            {isIn ? (
              <ArrowDownLeft size={30} color={colors.success} strokeWidth={2.3} />
            ) : (
              <ArrowUpRight size={30} color={colors.error} strokeWidth={2.3} />
            )}
          </View>
          <View style={s.headText}>
            <Text style={s.direction}>{isIn ? t.directionIn : t.directionOut}</Text>
            <Text style={s.party}>{c.partyName}</Text>
          </View>
          <StatusChip
            status={c.status === 'pending' ? 'credit' : c.status === 'deposited' ? 'pending' : c.status}
            label={
              c.status === 'pending'
                ? t.statusPending
                : c.status === 'deposited'
                  ? t.statusDeposited
                  : c.status === 'cleared'
                    ? t.statusCleared
                    : c.status === 'bounced'
                      ? t.statusBounced
                      : t.statusVoid
            }
            size="md"
          />
        </View>

        <AmountText
          value={c.amount}
          decimals={c.decimals}
          tone={isIn ? 'in' : 'out'}
          mark="none"
          size={fontSizes.display}
          suffix={c.currencyCode}
          style={s.amount}
        />

        <View style={s.metaGrid}>
          <MetaRow icon={<FileText size={15} color={colors.muted} />} label={t.chequeNoLabel} value={c.chequeNo} mono />
          <MetaRow icon={<Building2 size={15} color={colors.muted} />} label={t.bankNameLabel} value={c.bankName ?? '—'} />
          <MetaRow icon={<CalendarClock size={15} color={colors.muted} />} label={t.issueDateLabel} value={common.formatDate(c.issueDate)} />
          <MetaRow icon={<CalendarClock size={15} color={colors.muted} />} label={t.dueDateLabel} value={common.formatDate(c.dueDate)} />
          <MetaRow icon={<Landmark size={15} color={colors.muted} />} label={t.rateTodayLabel} value={c.exchangeRate} mono />
          {c.refInvoiceNo !== null && c.refInvoiceNo.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fill(t.linkedInvoice, { no: c.refInvoiceNo })}
              onPress={() => router.push(`/sales/${c.refInvoiceId}`)}
              style={({ pressed }) => [s.invoiceLinkRow, pressed && s.pressed]}
            >
              <FileText size={15} color={colors.accent} />
              <Text style={s.invoiceLink}>{fill(t.linkedInvoice, { no: c.refInvoiceNo })}</Text>
            </Pressable>
          ) : (
            <MetaRow icon={<FileText size={15} color={colors.muted} />} label={t.refInvoiceLabel} value={t.noInvoice} />
          )}
          {c.notes !== null && c.notes.length > 0 ? (
            <MetaRow icon={<Banknote size={15} color={colors.muted} />} label={t.notesLabel} value={c.notes} />
          ) : null}
        </View>
      </AppCard>

      {/* حركة التحصيل (بعد الحسم) */}
      {c.status === 'cleared' && c.clearedTx !== null ? (
        <AppCard style={s.clearedCard}>
          <View style={s.clearedHead}>
            <Wallet size={18} color={colors.success} />
            <Text style={s.clearedTitle}>{t.clearedTxSection}</Text>
          </View>
          <MetaRow icon={<Banknote size={15} color={colors.muted} />} label={t.cashboxLabel} value={c.clearedTx.cashboxName ?? '—'} />
          <MetaRow icon={<CalendarClock size={15} color={colors.muted} />} label={t.fieldDate} value={common.formatDate(c.clearedTx.txDate)} />
          <MetaRow icon={<Landmark size={15} color={colors.muted} />} label={t.amountLabel} value={c.clearedTx.amount} mono />
          {dec(c.clearedTx.fxGainLoss).greaterThan(0) || dec(c.clearedTx.fxGainLoss).isNegative() ? (
            <MetaRow icon={<Landmark size={15} color={colors.muted} />} label={t.fxGainLoss} value={c.clearedTx.fxGainLoss} mono />
          ) : null}
          <SecondaryButton label={t.viewCashTx} onPress={() => router.push('/cash')} />
        </AppCard>
      ) : null}

      {/* الارتداد + رسمه */}
      {c.status === 'bounced' ? (
        <AppCard style={s.bouncedCard}>
          <View style={s.clearedHead}>
            <Landmark size={18} color={colors.error} />
            <Text style={s.bouncedTitle}>{t.bounceFeeSection}</Text>
          </View>
          <MetaRow icon={<CalendarClock size={15} color={colors.muted} />} label={t.bouncedAtLabel} value={c.bouncedAt !== null ? common.formatDate(c.bouncedAt.slice(0, 10)) : '—'} />
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>{t.bounceFeeLabel}</Text>
            <AmountText value={c.bounceFee} decimals={c.decimals} tone="neutral" mark="none" size={fontSizes.body} suffix={c.currencyCode} />
          </View>
          {c.bounceFeeTxId !== null ? <Text style={s.feeNote}>{t.bounceFeeRecorded}</Text> : null}
        </AppCard>
      ) : null}

      {/* أزرار دورة الحياة */}
      {isOpen ? (
        <View style={s.actions}>
          {c.status === 'pending' ? (
            <SecondaryButton label={t.depositAction} onPress={() => setDepositConfirm(true)} disabled={busy} />
          ) : null}
          <PrimaryButton label={t.clearAction} onPress={() => setClearSheet(true)} disabled={busy} />
          {c.status === 'deposited' ? (
            <SecondaryButton label={t.bounceAction} onPress={() => setBounceSheet(true)} disabled={busy} />
          ) : null}
          {c.status === 'pending' ? (
            <SecondaryButton label={t.voidAction} onPress={() => setVoidConfirm(true)} disabled={busy} />
          ) : null}
        </View>
      ) : null}

      <View style={s.bottomSpace} />

      {/* ============ الشيتات ============ */}

      {/* إيداع بالبنك */}
      <ConfirmSheet
        visible={depositConfirm}
        onClose={() => setDepositConfirm(false)}
        onConfirm={() => void doDeposit()}
        title={t.depositTitle}
        message={t.depositMessage}
        confirmLabel={t.depositAction}
        busy={busy}
      />

      {/* تحصيل — اختيار صندوق بعملة الشيك */}
      <BottomSheet visible={clearSheet} onClose={() => setClearSheet(false)} title={t.clearTitle} dismissible={!busy}>
        <View style={s.sheetBody}>
          <Text style={s.sheetMessage}>{fill(t.clearMessage, { amount: c.amount, code: c.currencyCode })}</Text>
          <SelectField
            label={t.cashboxLabel}
            value={clearBoxId}
            options={matchingBoxes}
            onSelect={setClearBoxId}
            required
            hint={matchingBoxes.length === 0 ? t.noMatchingBox : undefined}
          />
          <PrimaryButton label={t.clearAction} onPress={() => void doClear()} loading={busy} disabled={busy || clearBoxId === ''} />
        </View>
      </BottomSheet>

      {/* ارتداد — رسم اختياري */}
      <BottomSheet visible={bounceSheet} onClose={() => setBounceSheet(false)} title={t.bounceTitle} dismissible={!busy}>
        <View style={s.sheetBody}>
          <Text style={s.sheetMessage}>{t.bounceMessage}</Text>
          <AmountPadField label={t.bounceFeeLabel} value={bounceFee} onValue={setBounceFee} suffix={c.currencyCode} hint={t.bounceFeeHint} />
          {bounceFee !== '' && dec(bounceFee).greaterThan(0) ? (
            <>
              <SelectField
                label={t.bounceCategoryLabel}
                value={bounceCatId}
                options={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
                onSelect={setBounceCatId}
                required
              />
              <SelectField
                label={t.cashboxLabel}
                value={bounceBoxId}
                options={matchingBoxes}
                onSelect={setBounceBoxId}
                required
                hint={matchingBoxes.length === 0 ? t.noMatchingBox : undefined}
              />
            </>
          ) : null}
          <PrimaryButton
            label={t.bounceAction}
            onPress={() => void doBounce()}
            loading={busy}
            disabled={busy || (bounceFee !== '' && dec(bounceFee).greaterThan(0) && (bounceCatId === '' || bounceBoxId === ''))}
          />
        </View>
      </BottomSheet>

      {/* إلغاء — صلاحية مدير */}
      <ConfirmSheet
        visible={voidConfirm}
        onClose={() => setVoidConfirm(false)}
        onConfirm={() => void doVoid()}
        title={t.voidTitle}
        message={t.voidMessage}
        requireText={t.voidWord}
        confirmLabel={t.voidAction}
        busy={busy}
      />

      {/* سعر اليوم مفقود أثناء التحصيل */}
      <DailyRateSheet
        visible={rateSheet !== null}
        onClose={() => setRateSheet(null)}
        currencyId={rateSheet?.currencyId ?? 0}
        date={rateSheet?.date ?? todayISO()}
        currencyCode={c.currencyCode}
        onSaved={() => {
          setRateSheet(null);
          void doClear();
        }}
      />
    </Screen>
  );
}

function MetaRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.metaRow}>
      <View style={s.metaIcon}>{icon}</View>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={[s.metaValue, mono === true && s.metaValueMono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headText: { flex: 1, gap: 2 },
  direction: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  party: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  amount: { alignSelf: 'center', marginBottom: spacing.md },
  metaGrid: { gap: 6 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 26,
  },
  metaIcon: { width: 18, alignItems: 'center' },
  metaLabel: {
    width: 96,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  metaValue: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  metaValueMono: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    direction: 'ltr',
    textAlign: 'right',
  },
  invoiceLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  invoiceLink: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
    textAlign: 'left',
  },
  pressed: { opacity: 0.8 },

  clearedCard: { gap: 6 },
  clearedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  clearedTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.success,
  },
  bouncedCard: { gap: 6 },
  bouncedTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.error,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  feeNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },

  actions: { gap: spacing.sm, marginTop: spacing.lg },
  bottomSpace: { height: spacing.xl },

  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  sheetMessage: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
});
