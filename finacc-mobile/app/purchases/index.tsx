import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Plus, ShoppingCart } from 'lucide-react-native';
import { formatMoney } from '@/utils/money';
import {
  AppCard,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  Screen,
  SearchBar,
  StatusChip,
} from '@/components';
import { common, purchases as p } from '@/i18n/ar';
import { listPurchaseInvoices, type PurchaseListRow } from '@/domain/purchasing';
import { getBaseCurrency } from '@/domain/currency';
import { colors, fontSizes, fonts, spacing } from '@/theme';

type StatusFilter = 'all' | 'completed' | 'draft' | 'void';

/** قائمة فواتير الشراء بفلاتر (شاشة purchases/index) — مدخل وحدة الشراء. */
export default function PurchasesListScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PurchaseListRow[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [baseCode, setBaseCode] = useState('');
  const [baseDecimals, setBaseDecimals] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPurchaseInvoices({
        status: status === 'all' ? 'all' : status,
        q: query,
      });
      setRows(res);
      if (baseCode === '') {
        try {
          const base = await getBaseCurrency();
          setBaseCode(base.code);
          setBaseDecimals(Number(base.decimals ?? 2));
        } catch {
          /* العملة تعرض من الصف نفسه */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [status, query, baseCode]);

  useEffect(() => {
    // debounce بحث خفيف
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: p.filterAll },
    { key: 'completed', label: p.filterCompleted },
    { key: 'draft', label: p.filterDraft },
    { key: 'void', label: p.filterVoid },
  ];

  return (
    <Screen
      title={p.listTitle}
      onBack={() => router.back()}
      actions={[
        {
          icon: <Plus size={24} color={colors.accent} />,
          label: p.newTitle,
          onPress: () => router.push('/purchases/new'),
        },
      ]}
    >
      <SearchBar placeholder={common.search} value={query} onChangeText={setQuery} />

      <View style={s.filtersRow}>
        {filters.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={status === f.key}
            onPress={() => setStatus(f.key)}
          />
        ))}
      </View>

      {loading && rows.length === 0 ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyState title={p.listEmpty} message={p.listEmptyHint} icon={<ShoppingCart size={40} color={colors.muted} />} actionLabel={p.newTitle} onAction={() => router.push('/purchases/new')} />
      ) : (
        <AppCard style={s.listCard}>
          {rows.map((r, i) => (
            <ListRow
              key={r.id}
              title={r.invoiceNo ?? p.noNumber}
              subtitle={`${r.supplierName ?? p.cashSupplier} · ${common.formatDate(r.issuedAt)} · ${r.itemCount} ${common.quantity}`}
              leading={<ShoppingCart size={20} color={colors.accent} />}
              trailing={
                <View style={s.trailing}>
                  <Text style={s.amount}>
                    {formatMoney(r.total, baseDecimals)} <Text style={s.cur}>{r.currencyCode || baseCode}</Text>
                  </Text>
                  <View style={s.chipsRow}>
                    <StatusChip status={r.status === 'completed' ? 'active' : (r.status as 'draft' | 'void')} label={r.status === 'completed' ? p.filterCompleted : r.status === 'draft' ? common.statuses.draft : common.statuses.void} />
                    <StatusChip status={r.payStatus as 'cash' | 'credit' | 'mixed'} />
                  </View>
                </View>
              }
              onPress={() => router.push(`/purchases/${r.id}`)}
              last={i === rows.length - 1}
            />
          ))}
        </AppCard>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  listCard: { paddingVertical: spacing.xs },
  trailing: { alignItems: 'flex-end', gap: 6 },
  amount: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  cur: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  chipsRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
});
