import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CalendarClock, Wallet2 } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Screen,
  SecondaryButton,
  StatusChip,
} from '@/components';
import { common, installments as t, fill } from '@/i18n/ar';
import { listPlans, type PlanRow } from '@/domain/installments';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** خطة → شريحة الحالة (نشطة/مكتملة/ملغاة). */
function planStatusChip(status: string): { chip: 'active' | 'cleared' | 'void'; label: string } {
  if (status === 'completed') return { chip: 'cleared', label: t.statusCompleted };
  if (status === 'cancelled') return { chip: 'void', label: t.statusCancelled };
  return { chip: 'active', label: t.statusActive };
}

/** قائمة خطط التقسيط (§6.5) — بطاقة لكل خطة + مدخل الأقساط المستحقة. */
export default function InstallmentsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await listPlans());
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // تحديث عند العودة من الخطة (تحصيل/إلغاء)
  useFocusEffect(
    useCallback(() => {
      if (loading === false && plans.length > 0) void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (loading) {
    return (
      <Screen title={t.title} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={3} />
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen title={t.title} onBack={() => router.back()}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen title={t.title} onBack={() => router.back()}>
      <SecondaryButton
        label={t.dueScreenEntry}
        onPress={() => router.push('/installments/due')}
        style={s.dueEntry}
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={<Wallet2 size={36} color={colors.muted} />}
          title={t.emptyTitle}
          message={t.emptyMessage}
        />
      ) : (
        <View style={s.list}>
          {plans.map((p) => {
            const st = planStatusChip(p.status);
            return (
              <AppCard key={p.id} style={s.planCard}>
                <View style={s.headRow}>
                  <Text style={s.customer} numberOfLines={1}>
                    {p.customerName}
                  </Text>
                  <StatusChip status={st.chip} label={st.label} />
                </View>
                <View style={s.metaRow}>
                  <CalendarClock size={14} color={colors.muted} />
                  <Text style={s.invoiceNo}>{p.invoiceNo ?? `#${p.invoiceId}`}</Text>
                  <Text style={s.cycle}>{p.cycle === 'weekly' ? t.weeklyCycle : t.monthlyCycle}</Text>
                </View>
                <View style={s.amountsRow}>
                  <View style={s.amountCol}>
                    <Text style={s.amountLabel}>{t.remainingLabel}</Text>
                    <AmountText
                      value={p.remaining}
                      decimals={p.decimals}
                      tone={dec(p.remaining).greaterThan(0) ? 'out' : 'in'}
                      mark="none"
                      color={dec(p.remaining).greaterThan(0) ? colors.warning : colors.success}
                      size={fontSizes.body}
                      suffix={p.currencyCode}
                    />
                  </View>
                  <View style={s.amountCol}>
                    <Text style={s.amountLabel}>{t.totalLabel}</Text>
                    <AmountText value={p.totalAmount} decimals={p.decimals} tone="neutral" mark="none" size={fontSizes.body} suffix={p.currencyCode} />
                  </View>
                </View>
                {p.nextDue !== null && p.status === 'active' ? (
                  <Text style={s.nextDue}>
                    {t.nextDueLabel}: {common.formatDate(p.nextDue)} · {fill(t.remainingCount, { n: p.remainingCount })}
                  </Text>
                ) : null}
              </AppCard>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  dueEntry: { marginBottom: spacing.lg },
  list: { gap: spacing.md },
  planCard: { gap: spacing.sm },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  customer: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  invoiceNo: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.accent,
    direction: 'ltr',
  },
  cycle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  amountsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  amountCol: { gap: 2 },
  amountLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  nextDue: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
