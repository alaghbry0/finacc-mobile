import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, RotateCcw, Wallet2 } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ConfirmSheet,
  ErrorState,
  LoadingSkeleton,
  Screen,
  SecondaryButton,
  DangerButton,
  SectionTitle,
  SelectField,
  StatusChip,
  DateField,
  type SelectOption,
} from '@/components';
import { common, installments as t, fill } from '@/i18n/ar';
import {
  cancelPlan,
  getPlan,
  rescheduleInstallment,
  type InstallmentRow,
  type PlanFull,
} from '@/domain/installments';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** شريحة حالة القسط. */
function instStatus(inst: InstallmentRow): { chip: 'cleared' | 'partial' | 'pending' | 'overdue'; label: string } {
  const remaining = dec(inst.amount).minus(dec(inst.paidAmount));
  if (remaining.lessThanOrEqualTo(0)) return { chip: 'cleared', label: t.instPaid };
  if (dec(inst.paidAmount).greaterThan(0)) return { chip: 'partial', label: t.instPartial };
  if (inst.dueDate < todayISO()) return { chip: 'overdue', label: t.instLate };
  return { chip: 'pending', label: t.instPending };
}

/** فرق الأيام عن اليوم (سالب = متأخر). */
function daysFromToday(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO());
  if (m === null || today === null) return 0;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3]));
  return Math.round((target - now) / 86_400_000);
}

/** تفاصيل خطة التقسيط (§6.5): بيانات + جدول الأقساط + إعادة جدولة/إلغاء. */
export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const planId = Number(Array.isArray(id) ? id[0] : id);
  const showToast = useToastStore((st) => st.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlanFull | null>(null);

  // إعادة الجدولة
  const [reschOpen, setReschOpen] = useState(false);
  const [reschInstId, setReschInstId] = useState('');
  const [reschDate, setReschDate] = useState(todayISO());
  const [reschConfirm, setReschConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // إلغاء الخطة
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(planId) || planId <= 0) {
      setError(t.planNotFound);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const full = await getPlan(planId);
      if (full === null) {
        setData(null);
        setError(t.planNotFound);
      } else {
        setData(full);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- إعادة الجدولة (FR-05-04: التاريخ فقط بلا إعادة توزيع) ----
  const doReschedule = async () => {
    if (reschInstId === '') return;
    setBusy(true);
    try {
      await rescheduleInstallment(Number(reschInstId), reschDate);
      setReschConfirm(false);
      setReschOpen(false);
      setReschInstId('');
      showToast(t.rescheduledToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  // ---- إلغاء الخطة ----
  const doCancel = async () => {
    setBusy(true);
    try {
      await cancelPlan(planId, { managerConfirmed: true });
      setCancelOpen(false);
      showToast(t.planCancelledToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen title={t.planDetailTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (error !== null || data === null) {
    return (
      <Screen title={t.planDetailTitle} onBack={() => router.back()}>
        <ErrorState message={error ?? t.planNotFound} onRetry={() => void load()} />
      </Screen>
    );
  }

  const p = data.plan;
  const decimals = data.currencyDecimals;
  const unpaidOptions: SelectOption[] = data.installments
    .filter((i) => dec(i.amount).minus(dec(i.paidAmount)).greaterThan(0))
    .map((i) => ({
      value: String(i.id),
      label: `${t.installmentLabel} ${i.seq} — ${common.formatDate(i.dueDate)}`,
      description: `${t.colAmount}: ${i.amount} · ${t.colPaid}: ${i.paidAmount}`,
    }));
  const isActive = p.status === 'active';

  return (
    <Screen title={t.planDetailTitle} onBack={() => router.back()}>
      {/* رأس الخطة */}
      <AppCard>
        <View style={s.headRow}>
          <Text style={s.customer} numberOfLines={1}>
            {data.plan.customerName}
          </Text>
          <StatusChip
            status={p.status === 'completed' ? 'cleared' : p.status === 'cancelled' ? 'void' : 'active'}
            label={p.status === 'completed' ? t.statusCompleted : p.status === 'cancelled' ? t.statusCancelled : t.statusActive}
            size="md"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fill(t.planOfInvoice, { no: p.invoiceNo ?? `#${p.invoiceId}` })}
          onPress={() => router.push(`/sales/${p.invoiceId}`)}
          style={({ pressed }) => [s.invoiceRow, pressed && s.pressed]}
        >
          <CalendarClock size={16} color={colors.accent} />
          <Text style={s.invoiceLink}>{fill(t.planOfInvoice, { no: p.invoiceNo ?? `#${p.invoiceId}` })}</Text>
        </Pressable>

        <View style={s.totalsGrid}>
          <TotalTile label={t.totalLabel} value={p.totalAmount} />
          <TotalTile label={t.paidLabel} value={p.paid} />
          <TotalTile label={t.remainingLabel} value={p.remaining} warn={dec(p.remaining).greaterThan(0)} />
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaLabel}>
            {p.months} × {p.cycle === 'weekly' ? t.weeklyCycle : t.monthlyCycle}
          </Text>
          <Text style={s.metaLabel}>
            {t.downPaymentTag}: {p.downPayment}
          </Text>
        </View>
      </AppCard>

      {/* جدول الأقساط */}
      <SectionTitle title={t.scheduleHeader} hint={t.formPreviewNote} />
      <AppCard flush style={s.tableCard}>
        <View style={s.tableHead}>
          <Text style={[s.th, s.colSeq]}>{t.colSeq}</Text>
          <Text style={s.th}>{t.colDue}</Text>
          <Text style={s.th}>{t.colAmount}</Text>
          <Text style={s.th}>{t.colPaid}</Text>
          <Text style={s.th}>{t.colStatus}</Text>
        </View>
        {data.installments.map((inst) => {
          const st = instStatus(inst);
          const lateDays = daysFromToday(inst.dueDate);
          const remaining = dec(inst.amount).minus(dec(inst.paidAmount));
          return (
            <View key={inst.id} style={[s.tr, lateDays < 0 && remaining.greaterThan(0) && s.trOverdue]}>
              <Text style={[s.td, s.colSeq, s.tdMono]}>{inst.seq}</Text>
              <Text style={[s.td, s.tdDate]}>{inst.dueDate}</Text>
              <Text style={[s.td, s.tdMono]}>{inst.amount}</Text>
              <Text style={[s.td, s.tdMono, dec(inst.paidAmount).greaterThan(0) && s.tdPaid]}>{inst.paidAmount}</Text>
              <View style={s.tdStatus}>
                <StatusChip status={st.chip} label={st.label} />
                {lateDays < 0 && remaining.greaterThan(0) ? (
                  <Text style={s.lateDays}>{fill(t.overdueBadge, { n: Math.abs(lateDays) })}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </AppCard>

      {/* الإجراءات */}
      {isActive ? (
        <View style={s.actions}>
          <SecondaryButton
            label={t.rescheduleAction}
            onPress={() => setReschOpen(true)}
            disabled={busy || unpaidOptions.length === 0}
          />
          <DangerButton label={t.cancelPlanAction} onPress={() => setCancelOpen(true)} disabled={busy} />
        </View>
      ) : null}

      <View style={s.bottomSpace} />

      {/* ============ الشيتات ============ */}

      {/* إعادة الجدولة: اختيار قسط + تاريخ جديد */}
      <BottomSheet visible={reschOpen} onClose={() => setReschOpen(false)} title={t.rescheduleTitle}>
        <View style={s.sheetBody}>
          <Text style={s.sheetMessage}>{t.rescheduleMessage}</Text>
          <SelectField
            label={t.installmentLabel}
            value={reschInstId}
            options={unpaidOptions}
            onSelect={setReschInstId}
            required
          />
          <DateField label={t.colDue} value={reschDate} onChange={setReschDate} required />
          <SecondaryButton
            label={t.rescheduleAction}
            onPress={() => setReschConfirm(true)}
            disabled={reschInstId === ''}
          />
        </View>
      </BottomSheet>

      {/* تأكيد إعادة الجدولة */}
      <ConfirmSheet
        visible={reschConfirm}
        onClose={() => setReschConfirm(false)}
        onConfirm={() => void doReschedule()}
        title={t.rescheduleTitle}
        message={`${t.rescheduleMessage} (${reschDate})`}
        confirmLabel={t.rescheduleAction}
        busy={busy}
      />

      {/* إلغاء الخطة — صلاحية مدير */}
      <ConfirmSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void doCancel()}
        title={t.cancelPlanTitle}
        message={t.cancelPlanMessage}
        requireText={t.cancelPlanWord}
        confirmLabel={t.cancelPlanAction}
        busy={busy}
      />
    </Screen>
  );
}

function TotalTile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <AmountText
        value={value}
        decimals={2}
        tone="neutral"
        mark="none"
        size={fontSizes.body}
        color={warn === true ? colors.warning : colors.textPrimary}
      />
    </View>
  );
}

const s = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  customer: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  invoiceLink: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  totalsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  tile: { flex: 1, gap: 2 },
  tileLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  metaLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },

  // الجدول
  tableCard: { paddingHorizontal: spacing.sm },
  tableHead: {
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
  },
  /** صف متأخر بخلفية تحذيرية خفيفة */
  trOverdue: { backgroundColor: 'rgba(251, 191, 36, 0.06)' },
  th: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  colSeq: { flex: 0.4 },
  td: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tdMono: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  tdDate: { direction: 'ltr' },
  tdPaid: { color: colors.success },
  tdStatus: { flex: 1.6, alignItems: 'center', gap: 2 },
  lateDays: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.error,
  },

  actions: { gap: spacing.sm, marginTop: spacing.lg },
  bottomSpace: { height: spacing.xl },
  pressed: { opacity: 0.8 },
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
