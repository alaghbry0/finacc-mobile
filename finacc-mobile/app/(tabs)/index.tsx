import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import Decimal from 'decimal.js';
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  CalendarClock,
  ChevronLeft,
  Coins,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react-native';
import { getDashboard, type DashboardData } from '@/domain/reports/dashboard';
import { getBaseCurrency } from '@/domain/currency';
import { common, fill, tabs } from '@/i18n/ar';
import { reports as rt } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { AppCard, EmptyState, ErrorState, LoadingSkeleton, Screen, SectionTitle, StatTile } from '@/components';
import { todayISO } from '@/utils/format';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * الداشبورد الحقيقي (FR-09-01 + §6.5 — الموجة 6-a):
 * 4 بلاطات حية (مبيعات/أرباح/فواتير اليوم + صافي الصندوق بالأساس) + مبيعات
 * الشهر بنسبة التغير + رسم 30 يوماً (SVG يدوي — أشرطة cyan بارتفاعات نسبية
 * وقيم فوق الأعمدة الكبرى فقط) + بطاقات تنبيه قابلة للنقر (أقساط/حد أدنى/شيكات).
 */
export default function DashboardScreen() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<DashboardData | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [cur, setCur] = useState<{ code: string; decimals: number }>({ code: '', decimals: 2 });
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const { width: screenW } = useWindowDimensions();

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [d, base] = await Promise.all([getDashboard(), getBaseCurrency()]);
      setData(d);
      setCur({ code: base.code, decimals: base.decimals });
      setState('ready');
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // اسم المنشأة للترحيب (خارج getDashboard كي لا يعاد جلبه مع كل تركيز)
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const { getDb } = await import('@/db/client');
          const db = await getDb();
          const rows = await db.all<{ name: string }>('SELECT name FROM company ORDER BY id LIMIT 1');
          setCompanyName(rows.length > 0 ? (rows[0]?.name ?? null) : null);
        } catch {
          setCompanyName(null);
        }
      })();
    }, []),
  );

  const fmt = (v: string): string => {
    const d = new Decimal(v);
    const fixed = d.toFixed(cur.decimals);
    const [int, frac] = fixed.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac !== undefined ? `${grouped}.${frac}` : grouped;
  };

  const hasData = data !== null && (data.todayInvoices > 0 || new Decimal(data.monthSales).greaterThan(0) || data.todaySales !== '0');

  return (
    <Screen
      title={fill(tabs.welcome, { name: companyName ?? common.appName })}
      subtitle={fill(tabs.todayIs, { date: common.formatDate(todayISO()) })}
      scroll={false}
    >
      <ScrollView style={s.grow} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {state === 'loading' ? (
          <LoadingSkeleton variant="tiles" />
        ) : state === 'error' || data === null ? (
          <ErrorState detail={errorDetail ?? undefined} onRetry={() => void load()} />
        ) : !hasData && data.dueInstallmentsCount === 0 && data.minStockCount === 0 && data.dueChequesCount === 0 ? (
          <AppCard>
            <EmptyState
              icon={<Coins size={40} color={colors.accent} />}
              title={tabs.analyticsComingTitle}
              message={tabs.analyticsComingMessage}
              actionLabel={tabs.sell}
              onAction={() => router.push('/sales/new')}
            />
          </AppCard>
        ) : (
          <>
            {/* ===== 4 بلاطات حية ===== */}
            <View style={s.tilesRow}>
              <StatTile
                label={tabs.salesToday}
                value={`${fmt(data.todaySales)}${cur.code.length > 0 ? ` ${cur.code}` : ''}`}
                icon={<BarChart3 size={18} color={colors.accent} />}
                style={s.tile}
              />
              <StatTile
                label={tabs.profitToday}
                value={fmt(data.todayProfit)}
                valueColor={new Decimal(data.todayProfit).isNegative() ? colors.error : colors.success}
                icon={<TrendingUp size={18} color={colors.success} />}
                style={s.tile}
              />
              <StatTile
                label={tabs.invoicesToday}
                value={String(data.todayInvoices)}
                icon={<Receipt size={18} color={colors.warning} />}
                style={s.tile}
              />
              <StatTile
                label={tabs.cashNet}
                value={`${fmt(data.netCashBase)}${cur.code.length > 0 ? ` ${cur.code}` : ''}`}
                valueColor={new Decimal(data.netCashBase).isNegative() ? colors.error : colors.textPrimary}
                icon={<Wallet size={18} color={colors.textSecondary} />}
                style={s.tile}
              />
            </View>

            {/* ===== مبيعات الشهر + نسبة التغير ===== */}
            <StatTile
              label={rt.dashMonthSales}
              value={`${fmt(data.monthSales)}${cur.code.length > 0 ? ` ${cur.code}` : ''}`}
              icon={<CalendarClock size={18} color={colors.warning} />}
              changePercent={
                data.monthSalesChangePct === null ? undefined : Number(data.monthSalesChangePct)
              }
            />

            {/* ===== رسم 30 يوماً ===== */}
            <View>
              <SectionTitle title={rt.dashChartTitle} />
              <AppCard style={s.chartCard}>
                {data.last30.every((d) => new Decimal(d.sales).isZero()) ? (
                  <EmptyState title={rt.dashChartTitle} message={rt.dashChartEmpty} />
                ) : (
                  <SalesChart data={data} screenW={screenW} fmt={fmt} />
                )}
              </AppCard>
            </View>

            {/* ===== بطاقات التنبيه ===== */}
            {data.dueInstallmentsCount > 0 || data.minStockCount > 0 || data.dueChequesCount > 0 ? (
              <View>
                <SectionTitle title={rt.dashAlertsTitle} />
                <AppCard>
                  {data.dueInstallmentsCount > 0 ? (
                    <AlertRow
                      icon={<CalendarClock size={22} color={colors.warning} />}
                      label={rt.dashDueInstallments}
                      count={data.dueInstallmentsCount}
                      onPress={() => router.push('/installments/due')}
                      first
                    />
                  ) : null}
                  {data.minStockCount > 0 ? (
                    <AlertRow
                      icon={<AlertTriangle size={22} color={colors.error} />}
                      label={rt.dashMinStock}
                      count={data.minStockCount}
                      onPress={() => router.push('/inventory/alerts')}
                    />
                  ) : null}
                  {data.dueChequesCount > 0 ? (
                    <AlertRow
                      icon={<BellRing size={22} color={colors.accent} />}
                      label={rt.dashDueCheques}
                      count={data.dueChequesCount}
                      onPress={() => router.push('/cash/cheques')}
                      last={data.minStockCount === 0}
                    />
                  ) : null}
                </AppCard>
              </View>
            ) : null}

            {/* ===== الأكثر مبيعاً ===== */}
            <View>
              <SectionTitle title={rt.dashTopTitle} />
              <AppCard>
                {data.topProducts.length === 0 ? (
                  <EmptyState title={rt.dashTopTitle} message={rt.dashTopEmpty} />
                ) : (
                  data.topProducts.map((p, i) => (
                    <View key={`${p.name}-${i}`} style={[s.topRow, i === data.topProducts.length - 1 && s.topRowLast]}>
                      <View style={s.topRank}>
                        <Text style={s.topRankText}>{i + 1}</Text>
                      </View>
                      <View style={s.topNameWrap}>
                        <Text style={s.topName} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={s.topQty}>{fill(rt.dashTopQty, { qty: p.qty })}</Text>
                      </View>
                      <Text style={s.topSales}>{fmt(p.sales)}</Text>
                    </View>
                  ))
                )}
              </AppCard>
            </View>
          </>
        )}

        <Text style={s.footnote}>{common.tagline}</Text>
      </ScrollView>
    </Screen>
  );
}

// ============ الرسم: 30 شريط SVG يدوي (FR-09-01) ============

function SalesChart({
  data,
  screenW,
  fmt,
}: {
  data: DashboardData;
  screenW: number;
  fmt: (v: string) => string;
}) {
  const chartW = Math.max(240, screenW - 2 * spacing.lg - 2 * spacing.md);
  const chartH = 132;
  const gap = 2;
  const barW = (chartW - 29 * gap) / 30;
  const labelH = 16;

  const values = data.last30.map((d) => new Decimal(d.sales));
  const max = Decimal.max(...values.map((v) => (v.isNegative() ? v.neg() : v)));
  const maxNonZero = max.greaterThan(0) ? max : new Decimal(1);
  const barH = (v: Decimal): number => {
    const abs = v.isNegative() ? v.neg() : v;
    if (abs.isZero()) return 1.5;
    return Math.max(3, abs.div(maxNonZero).times(chartH - labelH - 4).toNumber());
  };

  // القيم فوق الأعمدة الكبرى فقط: أعلى قيمتين في الشهر (غير الصفرية)
  const sortedIdx = values
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v.greaterThan(0))
    .sort((a, b) => b.v.comparedTo(a.v))
    .slice(0, 2)
    .map((x) => x.i);
  const labeled = new Set(sortedIdx);

  return (
    <Svg width={chartW} height={chartH}>
      {data.last30.map((d, i) => {
        const v = values[i]!;
        // RTL: الأقدم يميناً واليوم الجديد أقصى اليسار
        const x = chartW - (i + 1) * barW - i * gap;
        const h = barH(v);
        const isToday = i === 29;
        return (
          <Rect
            key={d.date}
            x={x}
            y={chartH - labelH - h}
            width={barW}
            height={h}
            rx={1.5}
            fill={isToday ? colors.gradientFrom : colors.accent}
            opacity={isToday ? 1 : 0.75}
          />
        );
      })}
      {data.last30.map((d, i) => {
        if (!labeled.has(i)) return null;
        const v = values[i]!;
        const h = barH(v);
        const x = chartW - (i + 1) * barW - i * gap;
        const label = fmt(d.sales);
        return (
          <SvgText
            key={`lbl-${d.date}`}
            x={x + barW / 2}
            y={Math.max(9, chartH - labelH - h - 3)}
            fontSize={8.5}
            fill={colors.textSecondary}
            textAnchor="middle"
          >
            {label.length > 7 ? `${label.slice(0, 6)}…` : label}
          </SvgText>
        );
      })}
      {/* تاريخا الحدود: الأقدم (يمين) واليوم (يسار) */}
      <SvgText x={chartW} y={chartH - 3} fontSize={8.5} fill={colors.muted} textAnchor="end">
        {data.last30[0]!.date.slice(5)}
      </SvgText>
      <SvgText x={0} y={chartH - 3} fontSize={8.5} fill={colors.muted} textAnchor="start">
        {data.last30[29]!.date.slice(5)}
      </SvgText>
    </Svg>
  );
}

// ============ صف تنبيه قابل للنقر ============

function AlertRow({
  icon,
  label,
  count,
  onPress,
  first = false,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${count}`}
      onPress={onPress}
      style={({ pressed }) => [s.alertRow, pressed && s.alertPressed]}
    >
      <View style={s.alertIconWrap}>{icon}</View>
      <Text style={s.alertLabel}>{label}</Text>
      <View style={s.alertBadge}>
        <Text style={s.alertBadgeText}>{count}</Text>
      </View>
      <ChevronLeft size={20} color={colors.muted} />
    </Pressable>
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
  chartCard: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 48,
  },
  alertPressed: { opacity: 0.85 },
  alertIconWrap: { width: 28, alignItems: 'center' },
  alertLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  alertBadge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.extra.warningSoft,
    alignItems: 'center',
  },
  alertBadgeText: {
    fontFamily: fonts.numeric,
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.warning,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topRowLast: { borderBottomWidth: 0 },
  topRank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.extra.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRankText: {
    fontFamily: fonts.numeric,
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.accent,
  },
  topNameWrap: { flex: 1, gap: 1 },
  topName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  topQty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  topSales: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
  },
});
