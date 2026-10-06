import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Printer } from 'lucide-react-native';
import { AppCard, LoadingSkeleton, Screen, SectionTitle, SelectField, type SelectOption } from '@/components';
import { common, settings as t, printing as pr } from '@/i18n/ar';
import { getSettings, setSetting } from '@/domain/settings';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * إعدادات الطباعة (FR-13-03): الورق الافتراضي + مختصر/مفصّل + نسخ عند الحفظ —
 * كلها مفاتيح printing.* في سجل الإعدادات (أُضيفت توثيقاً في الموجة 6-b).
 */
export default function PrintingSettingsScreen() {
  const showToast = useToastStore((s) => s.show);
  const [loading, setLoading] = useState(true);
  const [paper, setPaper] = useState('receipt80');
  const [detailed, setDetailed] = useState('off');
  const [copies, setCopies] = useState('1');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all = await getSettings();
        if (!alive) return;
        setPaper(all['printing.paper']);
        setDetailed(all['printing.detailed']);
        setCopies(all['printing.copies']);
      } catch (e) {
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showToast]);

  const persist = useCallback(
    async (key: 'printing.paper' | 'printing.detailed' | 'printing.copies', value: string, setter: (v: string) => void) => {
      setter(value);
      try {
        await setSetting(key, value);
        showToast(t.settingsSaved);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.settingsSaveFailed, { duration: 7000 });
      }
    },
    [showToast],
  );

  if (loading) {
    return (
      <Screen title={t.printingTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
      </Screen>
    );
  }

  const paperOptions: SelectOption[] = [
    { value: 'receipt58', label: pr.paperReceipt58 },
    { value: 'receipt80', label: pr.paperReceipt80 },
    { value: 'a4', label: pr.paperA4 },
  ];
  const detailedOptions: SelectOption[] = [
    { value: 'off', label: t.printingDetailedShort },
    { value: 'on', label: t.printingDetailedFull },
  ];
  const copiesOptions: SelectOption[] = [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }));

  return (
    <Screen title={t.printingTitle} onBack={() => router.back()}>
      <AppCard>
        <SelectField
          label={t.printingPaperLabel}
          value={paper}
          options={paperOptions}
          onSelect={(v) => void persist('printing.paper', v, setPaper)}
          hint={pr.paperHint}
        />
        <SelectField
          label={t.printingDetailedLabel}
          value={detailed}
          options={detailedOptions}
          onSelect={(v) => void persist('printing.detailed', v, setDetailed)}
          hint={pr.detailedHint}
        />
        <SelectField
          label={t.printingCopiesLabel}
          value={copies}
          options={copiesOptions}
          onSelect={(v) => void persist('printing.copies', v, setCopies)}
          searchable={false}
        />
      </AppCard>

      <SectionTitle title={t.printingThermalTitle} />
      <AppCard>
        <View style={s.thermalRow}>
          <Printer size={26} color={colors.accent} />
          <Text style={s.thermalText}>{t.printingThermalNote}</Text>
        </View>
      </AppCard>
    </Screen>
  );
}

const s = StyleSheet.create({
  thermalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  thermalText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
