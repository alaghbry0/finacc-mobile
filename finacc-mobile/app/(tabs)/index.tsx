import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarChart3, Coins, Receipt, TrendingUp, Wallet } from 'lucide-react-native';
import { getDb } from '@/db/client';
import { common, fill, tabs } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';
import { AppCard, EmptyState, LoadingSkeleton, Screen, StatTile } from '@/components';
import { todayISO } from '@/utils/format';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * الداشبورد (مؤقت — يُستبدل في الموجة 6):
 * ترحيب باسم المنشأة + التاريخ + 4 بلاطات فارغة + بطاقة «لوحة التحليلات قادمة».
 */
export default function DashboardScreen() {
  const [state, setState] = useState<LoadState>('loading');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const db = await getDb();
      const rows = await db.all<{ name: string }>('SELECT name FROM company ORDER BY id LIMIT 1');
      setCompanyName(rows.length > 0 ? (rows[0]?.name ?? null) : null);
      setState('ready');
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title={fill(tabs.welcome, { name: companyName ?? common.appName })} subtitle={fill(tabs.todayIs, { date: common.formatDate(todayISO()) })} scroll={false}>
      <ScrollView
        style={s.grow}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {state === 'loading' ? (
          <LoadingSkeleton variant="tiles" />
        ) : state === 'error' ? (
          <AppCard>
            <EmptyState
              title={common.errorTitle}
              message={common.errorGeneral}
              actionLabel={common.retry}
              onAction={() => void load()}
            />
            {errorDetail !== null ? <Text style={s.errorDetail}>{errorDetail}</Text> : null}
          </AppCard>
        ) : (
          <View style={s.tilesRow}>
            <StatTile label={tabs.salesToday} value={tabs.noValue} icon={<BarChart3 size={18} color={colors.accent} />} style={s.tile} />
            <StatTile label={tabs.profitToday} value={tabs.noValue} icon={<TrendingUp size={18} color={colors.success} />} style={s.tile} />
            <StatTile label={tabs.invoicesToday} value={tabs.noValue} icon={<Receipt size={18} color={colors.warning} />} style={s.tile} />
            <StatTile label={tabs.cashNet} value={tabs.noValue} icon={<Wallet size={18} color={colors.textSecondary} />} style={s.tile} />
          </View>
        )}

        <AppCard style={s.comingCard}>
          <EmptyState
            icon={<Coins size={40} color={colors.accent} />}
            title={tabs.analyticsComingTitle}
            message={tabs.analyticsComingMessage}
          />
        </AppCard>

        <Text style={s.footnote}>{common.tagline}</Text>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  tilesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    minWidth: '47%',
    flexGrow: 1,
  },
  comingCard: { paddingVertical: spacing.md },
  footnote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
  },
  errorDetail: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    direction: 'ltr',
    marginTop: spacing.sm,
  },
});
