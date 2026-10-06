import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { Plus, SearchX } from 'lucide-react-native';
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Screen,
  SearchBar,
  SectionTitle,
} from '@/components';
import { cheques as t, common } from '@/i18n/ar';
import { listCheques, type ChequeRow } from '@/domain/cheques';
import { ChequeCard } from '@/screens/cheques/ChequeCard';
import { colors, fontSizes, fonts, spacing } from '@/theme';

type StatusFilter = 'all' | 'pending' | 'deposited' | 'cleared' | 'bounced' | 'void';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: t.filterAll },
  { key: 'pending', label: t.statusPending },
  { key: 'deposited', label: t.statusDeposited },
  { key: 'cleared', label: t.statusCleared },
  { key: 'bounced', label: t.statusBounced },
  { key: 'void', label: t.statusVoid },
];

/** قائمة الشيكات الكاملة (FR-14-05): بحث + فلاتر حالة + شيك جديد. */
export default function ChequesScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChequeRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCheques({ limit: 200 }));
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
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (q.length === 0) return true;
      return (
        r.chequeNo.toLowerCase().includes(q) ||
        (r.bankName ?? '').toLowerCase().includes(q) ||
        r.partyName.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, query]);

  const hasAny = rows.length > 0;

  if (loading && rows.length === 0) {
    return (
      <Screen title={t.listTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen title={t.listTitle} onBack={() => router.back()}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen title={t.listTitle} onBack={() => router.back()}>
      <SearchBar value={query} onChangeText={setQuery} placeholder={t.searchHint} inputMode="search" />

      <View style={s.filtersRow}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {!hasAny ? (
        <EmptyState
          icon={<Plus size={36} color={colors.muted} />}
          title={t.emptyTitle}
          message={t.emptyMessage}
          actionLabel={t.addCheque}
          onAction={() => router.push('/cash/cheques/new')}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchX size={36} color={colors.muted} />}
          title={common.noResults}
          message={common.noResultsHint}
        />
      ) : (
        <View style={s.list}>
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.addCheque}
        onPress={() => router.push('/cash/cheques/new')}
        style={({ pressed }) => [s.addBtn, pressed && s.pressed]}
      >
        <Plus size={22} color={colors.bg} />
        <Text style={s.addText}>{t.addCheque}</Text>
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  list: { gap: spacing.sm, paddingBottom: spacing.sm },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  addText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.bg,
  },
  pressed: { opacity: 0.85 },
});
