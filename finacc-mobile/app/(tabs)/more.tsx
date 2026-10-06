import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  ChevronLeft,
  FileBarChart,
  Info,
  Printer,
  Settings,
  Users,
  Wallet2,
} from 'lucide-react-native';
import { common, tabs } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';
import { AppCard, ListRow, Screen } from '@/components';

interface MenuEntry {
  key: string;
  title: string;
  icon: ReactNode;
  route: string;
}

/** قائمة «المزيد» الفعلية — LDR-2: الأطراف/التقارير/الأقساط/الطباعة/الإعدادات + حول. */
export default function MoreScreen() {
  const entries: MenuEntry[] = [
    { key: 'parties', title: tabs.parties, icon: <Users size={22} color={colors.accent} />, route: '/parties' },
    { key: 'reports', title: tabs.reports, icon: <FileBarChart size={22} color={colors.accent} />, route: '/reports' },
    { key: 'installments', title: tabs.installments, icon: <Wallet2 size={22} color={colors.warning} />, route: '/installments' },
    { key: 'printing', title: tabs.printing, icon: <Printer size={22} color={colors.textSecondary} />, route: '/printing' },
    { key: 'settings', title: tabs.settings, icon: <Settings size={22} color={colors.textSecondary} />, route: '/settings' },
  ];

  return (
    <Screen title={tabs.more}>
      <ScrollView
        style={s.grow}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <AppCard>
          {entries.map((e, i) => (
            <ListRow
              key={e.key}
              title={e.title}
              leading={e.icon}
              trailing={<ChevronLeft size={20} color={colors.muted} />}
              onPress={() => router.push(e.route)}
              last={i === entries.length - 1}
            />
          ))}
        </AppCard>

        {/* حول التطبيق — قسم مضمّن (لا مسار مستقل) */}
        <AppCard style={s.aboutCard}>
          <View style={s.aboutHead}>
            <Info size={18} color={colors.muted} />
            <Text style={s.aboutTitle}>{tabs.about}</Text>
          </View>
          <Text style={s.aboutBody}>
            {common.appName} — {common.tagline}.
          </Text>
          <Text style={s.aboutVersion}>v1.0.0</Text>
        </AppCard>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  aboutCard: { gap: spacing.sm },
  aboutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  aboutTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  aboutBody: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  aboutVersion: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
});
