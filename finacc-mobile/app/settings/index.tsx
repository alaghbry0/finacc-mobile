import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  ChevronLeft,
  Coins,
  Info,
  Printer,
  Receipt,
  Ruler,
  Save,
  Tags,
  Wallet,
  Warehouse,
} from 'lucide-react-native';
import { AppCard, Chip, ListRow, Screen, SectionTitle } from '@/components';
import { common, settings as settingsAr, tabs } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, spacing } from '@/theme';

interface SettingsEntry {
  key: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  /** مسار جاهز الآن — غير موجود → ComingSoon عبر toast */
  route?: string;
  soon?: boolean;
}

/** قائمة الإعدادات (الموجة 3-b): العملات جاهزة، والبقية مؤرخة بموجاتها. */
export default function SettingsScreen() {
  const showToast = useToastStore((s) => s.show);

  const basics: SettingsEntry[] = [
    { key: 'categories', title: settingsAr.categories, icon: <Tags size={22} color={colors.accent} />, soon: true },
    { key: 'units', title: settingsAr.units, icon: <Ruler size={22} color={colors.accent} />, soon: true },
    { key: 'warehouses', title: settingsAr.warehouses, icon: <Warehouse size={22} color={colors.accent} />, soon: true },
    { key: 'cashboxes', title: settingsAr.cashboxes, icon: <Wallet size={22} color={colors.accent} />, soon: true },
  ];

  const operations: SettingsEntry[] = [
    {
      key: 'currencies',
      title: settingsAr.currencies,
      subtitle: settingsAr.currenciesDesc,
      icon: <Coins size={22} color={colors.accent} />,
      route: '/settings/currencies',
    },
  ];

  const upcoming: SettingsEntry[] = [
    { key: 'invoicing', title: settingsAr.invoicing, subtitle: settingsAr.invoicingDesc, icon: <Receipt size={22} color={colors.textSecondary} />, soon: true },
    { key: 'printing', title: settingsAr.printing, subtitle: settingsAr.printingDesc, icon: <Printer size={22} color={colors.textSecondary} />, route: '/printing', soon: true },
    { key: 'backup', title: settingsAr.backup, subtitle: settingsAr.backupDesc, icon: <Save size={22} color={colors.textSecondary} />, soon: true },
    { key: 'about', title: settingsAr.about, subtitle: settingsAr.aboutDesc, icon: <Info size={22} color={colors.textSecondary} />, soon: true },
  ];

  const open = (e: SettingsEntry) => {
    if (e.route !== undefined) {
      router.push(e.route);
      return;
    }
    showToast(common.comingSoonMessage);
  };

  const renderEntry = (e: SettingsEntry, last: boolean) => (
    <ListRow
      key={e.key}
      title={e.title}
      subtitle={e.subtitle}
      leading={e.icon}
      trailing={
        e.soon === true ? (
          <View style={s.soonWrap}>
            <Chip label={settingsAr.soonBadge} />
            <Text style={s.waveTag}>{settingsAr.waveTag}</Text>
          </View>
        ) : (
          <ChevronLeft size={20} color={colors.muted} />
        )
      }
      onPress={() => open(e)}
      last={last}
    />
  );

  return (
    <Screen title={tabs.settings}>
      <SectionTitle title={settingsAr.sectionBasics} />
      <AppCard>{basics.map((e, i) => renderEntry(e, i === basics.length - 1))}</AppCard>
      <Text style={s.sectionNote}>{settingsAr.basicsSoonHint}</Text>

      <SectionTitle title={settingsAr.sectionOperations} />
      <AppCard>{operations.map((e, i) => renderEntry(e, i === operations.length - 1))}</AppCard>

      <SectionTitle title={settingsAr.sectionUpcoming} />
      <AppCard>{upcoming.map((e, i) => renderEntry(e, i === upcoming.length - 1))}</AppCard>
    </Screen>
  );
}

const s = StyleSheet.create({
  soonWrap: {
    alignItems: 'flex-end',
    gap: 4,
  },
  waveTag: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  sectionNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
});
