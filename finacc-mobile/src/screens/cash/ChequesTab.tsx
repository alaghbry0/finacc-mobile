import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Chip, EmptyState, ErrorState, LoadingSkeleton } from '@/components';
import { cheques as t, common } from '@/i18n/ar';
import { dueSoonCheques, listCheques, type ChequeRow } from '@/domain/cheques';
import { ChequeCard } from '@/screens/cheques/ChequeCard';
import { colors, fontSizes, fonts, spacing } from '@/theme';

type QuickFilter = 'open' | 'all' | 'cleared' | 'bounced';

const FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'open', label: t.filterOpen },
  { key: 'all', label: t.filterAll },
  { key: 'cleared', label: t.statusCleared },
  { key: 'bounced', label: t.statusBounced },
];

/**
 * تبويب الشيكات داخل شاشة النقدية (FR-14-05): قائمة مرتبة بالاستحقاق
 * + فلاتر حالة مختصرة + «شيك جديد» + «عرض الكل». مكوّن مستقل بلا
 * اعتماد على بنية شاشة النقدية (يُضمَّن داخل أي حاوية تمرير).
 */
export function ChequesTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChequeRow[]>([]);
  const [filter, setFilter] = useState<QuickFilter>('open');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCheques({ limit: 60 });
      setRows(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'open':
        return rows.filter((r) => r.status === 'pending' || r.status === 'deposited');
      case 'cleared':
        return rows.filter((r) => r.status === 'cleared');
      case 'bounced':
        return rows.filter((r) => r.status === 'bounced' || r.status === 'void');
      default:
        return rows;
    }
  }, [rows, filter]);

  if (loading && rows.length === 0) {
    return (
      <View style={s.wrap}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={3} />
      </View>
    );
  }

  if (error !== null) {
    return (
      <View style={s.wrap}>
        <ErrorState message={error} onRetry={() => void load()} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {/* رأس القسم + زرا الإضافة والعرض الكل */}
      <View style={s.headRow}>
        <Text style={s.sectionTitle}>{t.tabTitle}</Text>
        <View style={s.headActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.viewAll}
            onPress={() => router.push('/cash/cheques')}
            style={({ pressed }) => [s.viewAllBtn, pressed && s.pressed]}
          >
            <Text style={s.viewAllText}>{t.viewAll}</Text>
            <ChevronLeft size={16} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.addCheque}
            onPress={() => router.push('/cash/cheques/new')}
            style={({ pressed }) => [s.addBtn, pressed && s.pressed]}
          >
            <Plus size={20} color={colors.bg} />
            <Text style={s.addText}>{t.addCheque}</Text>
          </Pressable>
        </View>
      </View>

      {/* فلاتر الحالة المختصرة */}
      <View style={s.filtersRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Plus size={36} color={colors.muted} />}
          title={t.emptyTitle}
          message={t.emptyMessage}
          actionLabel={t.addCheque}
          onAction={() => router.push('/cash/cheques/new')}
        />
      ) : (
        <View>
          {visible.map((row, i) => (
            <ChequeCard
              key={row.id}
              row={row}
              last={i === visible.length - 1}
              onPress={() => router.push(`/cash/cheques/${row.id}`)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** جلب الشيكات المستحقة قريباً — مساعد للداشبورد (موجة 6). */
export { dueSoonCheques };

export default ChequesTab;

const s = StyleSheet.create({
  wrap: { gap: spacing.md },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  viewAllText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  addText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.bg,
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
