import { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
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
import { AppCard, ListRow, Screen, SectionTitle } from '@/components';
import { settings as settingsAr, tabs } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, spacing } from '@/theme';

interface SettingsEntry {
  key: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  /** مسار جاهز — غير موجود → تُدار من شاشاتها (toast) */
  route?: string;
}

/** قائمة الإعدادات — كل المسارات حقيقية (6-a/6-b). */
export default function SettingsScreen() {
  const showToast = useToastStore((s) => s.show);

  const basics: SettingsEntry[] = [
    { key: 'categories', title: settingsAr.categories, icon: <Tags size={22} color={colors.accent} />, route: '/inventory/categories' },
    { key: 'units', title: settingsAr.units, icon: <Ruler size={22} color={colors.accent} />, route: '/inventory/units' },
    { key: 'warehouses', title: settingsAr.warehouses, icon: <Warehouse size={22} color={colors.accent} /> },
    { key: 'cashboxes', title: settingsAr.cashboxes, icon: <Wallet size={22} color={colors.accent} /> },
  ];

  const operations: SettingsEntry[] = [
    {
      key: 'company',
      title: settingsAr.company,
      subtitle: settingsAr.companyDesc,
      icon: <Info size={22} color={colors.accent} />,
      route: '/settings/company',
    },
    {
      key: 'currencies',
      title: settingsAr.currencies,
      subtitle: settingsAr.currenciesDesc,
      icon: <Coins size={22} color={colors.accent} />,
      route: '/settings/currencies',
    },
    {
      key: 'invoicing',
      title: settingsAr.invoicing,
      subtitle: settingsAr.invoicingDesc,
      icon: <Receipt size={22} color={colors.accent} />,
      route: '/settings/invoicing',
    },
    {
      key: 'printing',
      title: settingsAr.printing,
      subtitle: settingsAr.printingDesc,
      icon: <Printer size={22} color={colors.accent} />,
      route: '/settings/printing',
    },
    {
      key: 'backup',
      title: settingsAr.backup,
      subtitle: settingsAr.backupDesc,
      icon: <Save size={22} color={colors.accent} />,
      route: '/settings/backup',
    },
    {
      key: 'about',
      title: settingsAr.about,
      subtitle: settingsAr.aboutDesc,
      icon: <Info size={22} color={colors.accent} />,
      route: '/settings/about',
    },
  ];

  const open = (e: SettingsEntry) => {
    if (e.route !== undefined) {
      router.push(e.route);
      return;
    }
    // مخازن/صناديق: تُدار من شاشات المخزون والنقدية (ملاحظة basicsSoonHint)
    showToast(settingsAr.basicsSoonHint);
  };

  const renderEntry = (e: SettingsEntry, last: boolean) => (
    <ListRow
      key={e.key}
      title={e.title}
      subtitle={e.subtitle}
      leading={e.icon}
      trailing={e.route !== undefined ? <ChevronLeft size={20} color={colors.muted} /> : null}
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
    </Screen>
  );
}

const s = StyleSheet.create({
  sectionNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
});
