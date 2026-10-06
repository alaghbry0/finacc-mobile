import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AlarmClock, Banknote, MessageCircle } from 'lucide-react-native';
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
  SelectField,
  type SelectOption,
} from '@/components';
import { common, installments as t, fill } from '@/i18n/ar';
import { installmentsDue, collectInstallment, getPlan, type DueInstallmentRow } from '@/domain/installments';
import { listCashboxOptions, type CashboxOptionRow } from '@/domain/cash';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { openURL } from '@/utils/open-url';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** فرق الأيام بين تاريخ واليوم (سالب = متأخر). */
function daysFromToday(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO());
  if (m === null || today === null) return 0;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3]));
  return Math.round((target - now) / 86_400_000);
}

/** بطاقة قسط مستحق — متأخرة بخلفية تحذيرية خفيفة (FR-05-04). */
function DueCard({
  row,
  overdueDays,
  onCollect,
  onRemind,
}: {
  row: DueInstallmentRow;
  overdueDays: number;
  onCollect: () => void;
  onRemind: () => void;
}) {
  const remaining = dec(row.amount).minus(dec(row.paidAmount));
  return (
    <View style={[s.dueCard, overdueDays > 0 && s.dueCardOverdue]}>
      <View style={s.dueHead}>
        <Text style={s.dueCustomer} numberOfLines={1}>
          {row.customerName}
        </Text>
        {overdueDays > 0 ? (
          <View style={s.overdueBadge}>
            <AlarmClock size={12} color={colors.error} />
            <Text style={s.overdueBadgeText}>{fill(t.overdueBadge, { n: overdueDays })}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.dueMeta}>
        <Text style={s.dueSeq}>
          {t.monthsLabel} {row.seq} · {row.invoiceNo ?? `#${row.invoiceId}`}
        </Text>
        <Text style={s.dueDate}>{common.formatDate(row.dueDate)}</Text>
      </View>
      <View style={s.dueBottom}>
        <AmountText
          value={remaining.greaterThan(0) ? remaining.toString() : row.amount}
          decimals={row.decimals}
          tone="neutral"
          mark="none"
          size={fontSizes.title}
          suffix={row.currencyCode}
        />
        <View style={s.dueActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.whatsappRemind}
            onPress={onRemind}
            style={({ pressed }) => [s.remindBtn, pressed && s.pressed]}
          >
            <MessageCircle size={18} color={colors.success} />
            <Text style={s.remindText}>{t.whatsappRemind}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.collectAction}
            onPress={onCollect}
            style={({ pressed }) => [s.collectBtn, pressed && s.pressed]}
          >
            <Banknote size={18} color={colors.bg} />
            <Text style={s.collectText}>{t.collectAction}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** الأقساط المستحقة (FR-05-04): اليوم + الأسبوع + المتأخر بخلفية تحذيرية + تذكير واتساب. */
export default function InstallmentsDueScreen() {
  const showToast = useToastStore((st) => st.show);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DueInstallmentRow[]>([]);

  // شيت التحصيل
  const [collectRow, setCollectRow] = useState<DueInstallmentRow | null>(null);
  const [boxes, setBoxes] = useState<CashboxOptionRow[]>([]);
  const [boxId, setBoxId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await installmentsDue({ withinDays: 7 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (loading === false) void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // صناديق عند فتح شيت التحصيل
  useEffect(() => {
    if (collectRow === null) return;
    let alive = true;
    void (async () => {
      try {
        const list = await listCashboxOptions();
        if (!alive) return;
        setBoxes(list);
        const match = list.find((b) => b.currencyId === collectRow.currencyId);
        if (match !== undefined) setBoxId((prev) => (prev === '' ? String(match.id) : prev));
      } catch {
        /* الخطأ يظهر عند التنفيذ */
      }
    })();
    return () => {
      alive = false;
    };
  }, [collectRow]);

  const { overdue, today, thisWeek } = useMemo(() => {
    const overdueRows: { row: DueInstallmentRow; days: number }[] = [];
    const todayRows: DueInstallmentRow[] = [];
    const weekRows: DueInstallmentRow[] = [];
    for (const r of rows) {
      const d = daysFromToday(r.dueDate);
      if (d < 0) overdueRows.push({ row: r, days: Math.abs(d) });
      else if (d === 0) todayRows.push(r);
      else weekRows.push(r);
    }
    return { overdue: overdueRows, today: todayRows, thisWeek: weekRows };
  }, [rows]);

  // صناديق بعملة القسط حصراً (قرار 8)
  const boxOptions: SelectOption[] =
    collectRow !== null
      ? boxes
          .filter((b) => b.currencyId === collectRow.currencyId)
          .map((b) => ({ value: String(b.id), label: `${b.name} (${b.currencyCode})` }))
      : [];

  const doCollect = async () => {
    if (collectRow === null || boxId === '') return;
    setBusy(true);
    try {
      await collectInstallment(collectRow.id, { cashboxId: Number(boxId) });
      setCollectRow(null);
      setBoxId('');
      showToast(t.installmentCollectedToast);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  // تذكير واتساب — رسالة القسط والتاريخ والمتبقي (FR-05-05)
  const remind = async (row: DueInstallmentRow) => {
    const phone = row.customerWhatsapp ?? row.customerPhone;
    if (phone === null || phone.length === 0) {
      showToast(t.noPhone);
      return;
    }
    // عدد أقساط الخطة لرسالة التذكير (قراءة عرض واحدة عند النقر)
    let months = '';
    try {
      const full = await getPlan(row.planId);
      if (full !== null) months = String(full.plan.months);
    } catch {
      months = '';
    }
    const remaining = dec(row.amount).minus(dec(row.paidAmount));
    const msg = fill(t.whatsappMessage, {
      name: row.customerName,
      seq: row.seq,
      months,
      amount: row.amount,
      code: row.currencyCode,
      date: common.formatDate(row.dueDate),
      remaining: remaining.toString(),
    });
    const digits = phone.replace(/[^\d]/g, '');
    void openURL(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`);
  };

  if (loading) {
    return (
      <Screen title={t.dueTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen title={t.dueTitle} onBack={() => router.back()}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  const empty = overdue.length === 0 && today.length === 0 && thisWeek.length === 0;

  return (
    <Screen title={t.dueTitle} onBack={() => router.back()}>
      {empty ? (
        <EmptyState
          icon={<Banknote size={36} color={colors.muted} />}
          title={t.noDueTitle}
          message={t.noDueMessage}
        />
      ) : (
        <View style={s.wrap}>
          {overdue.length > 0 ? (
            <>
              <SectionTitle title={t.overdueSection} />
              {overdue.map(({ row, days }) => (
                <DueCard
                  key={row.id}
                  row={row}
                  overdueDays={days}
                  onCollect={() => setCollectRow(row)}
                  onRemind={() => remind(row)}
                />
              ))}
            </>
          ) : null}

          {today.length > 0 ? (
            <>
              <SectionTitle title={t.dueTodaySection} />
              {today.map((row) => (
                <DueCard key={row.id} row={row} overdueDays={0} onCollect={() => setCollectRow(row)} onRemind={() => remind(row)} />
              ))}
            </>
          ) : null}

          {thisWeek.length > 0 ? (
            <>
              <SectionTitle title={t.dueWeekSection} />
              {thisWeek.map((row) => (
                <DueCard key={row.id} row={row} overdueDays={0} onCollect={() => setCollectRow(row)} onRemind={() => remind(row)} />
              ))}
            </>
          ) : null}
        </View>
      )}

      {/* شيت التحصيل — اختيار صندوق */}
      <BottomSheet visible={collectRow !== null} onClose={() => setCollectRow(null)} title={t.collectTitle} dismissible={!busy}>
        {collectRow !== null ? (
          <View style={s.sheetBody}>
            <Text style={s.sheetMessage}>
              {fill(t.collectMessage, {
                amount: dec(collectRow.amount).minus(dec(collectRow.paidAmount)).toString(),
                code: collectRow.currencyCode,
              })}
            </Text>
            <SelectField
              label={t.cashboxLabel}
              value={boxId}
              options={boxOptions}
              onSelect={setBoxId}
              required
              hint={boxOptions.length === 0 ? t.noMatchingBox : undefined}
            />
            <PrimaryButton label={t.collectAction} onPress={() => void doCollect()} loading={busy} disabled={busy || boxId === ''} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.md },
  dueCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  /** خلفية تحذيرية خفيفة للمتأخر (FR-05-04) */
  dueCardOverdue: {
    backgroundColor: 'rgba(251, 191, 36, 0.07)',
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  dueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dueCustomer: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  overdueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  overdueBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.error,
  },
  dueMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dueSeq: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  dueDate: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  dueBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  remindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.extra.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  remindText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.success,
  },
  collectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  collectText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.bg,
  },
  pressed: { opacity: 0.85 },
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
