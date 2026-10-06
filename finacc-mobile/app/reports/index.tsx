import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronLeft,
  Clock4,
  PackageSearch,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { reports as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { Screen } from '@/components';

interface ReportCardDef {
  id: string;
  title: string;
  desc: string;
  icon: ReactNode;
  color: string;
}

const CARDS: ReportCardDef[] = [
  {
    id: 'profit-loss',
    title: t.plTitle,
    desc: t.plDesc,
    icon: <TrendingUp size={24} color={colors.success} />,
    color: colors.extra.successSoft,
  },
  {
    id: 'sales-by-customer',
    title: t.byCustomerTitle,
    desc: t.byCustomerDesc,
    icon: <Users size={24} color={colors.accent} />,
    color: colors.extra.accentSoft,
  },
  {
    id: 'sales-by-product',
    title: t.byProductTitle,
    desc: t.byProductDesc,
    icon: <PackageSearch size={24} color={colors.warning} />,
    color: colors.extra.warningSoft,
  },
  {
    id: 'sales-by-day',
    title: t.byDayTitle,
    desc: t.byDayDesc,
    icon: <CalendarDays size={24} color={colors.accent} />,
    color: colors.extra.accentSoft,
  },
  {
    id: 'product-card',
    title: t.productCardTitle,
    desc: t.productCardDesc,
    icon: <BarChart3 size={24} color={colors.success} />,
    color: colors.extra.successSoft,
  },
  {
    id: 'stock-summary',
    title: t.stockSummaryTitle,
    desc: t.stockSummaryDesc,
    icon: <Boxes size={24} color={colors.textSecondary} />,
    color: colors.extra.mutedSoft,
  },
  {
    id: 'aging',
    title: t.agingTitle,
    desc: t.agingDesc,
    icon: <Clock4 size={24} color={colors.error} />,
    color: colors.extra.errorSoft,
  },
  {
    id: 'min-stock',
    title: t.minStockTitle,
    desc: t.minStockDesc,
    icon: <AlertTriangle size={24} color={colors.warning} />,
    color: colors.extra.warningSoft,
  },
];

/** معرض التقارير (FR-09 — الموجة 6-a): بطاقات بأيقونات ووصف → العارض العام. */
export default function ReportsScreen() {
  return (
    <Screen title={t.galleryTitle} subtitle={t.gallerySubtitle}>
      <ScrollView style={s.grow} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          {CARDS.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.title}
              onPress={() => router.push(`/reports/${c.id}`)}
              style={({ pressed }) => [s.card, pressed && s.pressed]}
            >
              <View style={[s.iconWrap, { backgroundColor: c.color }]}>{c.icon}</View>
              <View style={s.textWrap}>
                <Text style={s.cardTitle}>{c.title}</Text>
                <Text style={s.cardDesc} numberOfLines={3}>
                  {c.desc}
                </Text>
              </View>
              <ChevronLeft size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    paddingBottom: spacing.xxl,
  },
  grid: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    minHeight: 84,
  },
  pressed: { opacity: 0.85 },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  cardDesc: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
});
