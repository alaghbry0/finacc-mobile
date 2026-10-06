import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Plus, Receipt, ShoppingCart } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  Screen,
  SearchBar,
  SelectField,
  StatusChip,
  type SelectOption,
} from '@/components';
import { common, purchases as p, sales as t } from '@/i18n/ar';
import { listInvoices, type InvoiceListRow } from '@/domain/invoicing';
import { colors, fontSizes, fonts, spacing } from '@/theme';

type PayFilter = 'all' | 'cash' | 'credit' | 'mixed';
type StatusFilter = 'all' | 'completed' | 'draft' | 'void';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: t.filterAll },
  { value: 'completed', label: t.statusCompleted },
  { value: 'draft', label: t.statusDraft },
  { value: 'void', label: t.statusVoid },
];

/** قائمة فواتير البيع: بحث بالرقم/العميل + فلتر دفع (Segment) + فلتر حالة (Select). */
export default function SalesListScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [query, setQuery] = useState('');
  const [pay, setPay] = useState<PayFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listInvoices({
        docType: 'sale',
        status: status === 'all' ? undefined : status,
        q: query,
        limit: 200,
      });
      setRows(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const visible = pay === 'all' ? rows : rows.filter((r) => r.payStatus === pay);

  const payFilters: { key: PayFilter; label: string }[] = [
    { key: 'all', label: t.filterAll },
    { key: 'cash', label: common.statuses.cash },
    { key: 'credit', label: common.statuses.credit },
    { key: 'mixed', label: common.statuses.mixed },
  ];

  return (
    <Screen
      title={t.listTitle}
      onBack={() => router.back()}
      actions={[
        {
          icon: <Plus size={24} color={colors.accent} />,
          label: t.newInvoice,
          onPress: () => router.push('/sales/new'),
        },
        {
          icon: <ShoppingCart size={24} color={colors.accent} />,
          label: p.newTitle,
          onPress: () => router.push('/purchases/new'),
        },
      ]}
    >
      <SearchBar
        placeholder={t.listSearch}
        value={query}
        onChangeText={setQuery}
        inputMode="search"
      />

      <View style={s.filtersRow}>
        {payFilters.map((f) => (
          <Chip key={f.key} label={f.label} selected={pay === f.key} onPress={() => setPay(f.key)} />
        ))}
        <View style={s.statusSelect}>
          <SelectField
            label={common.date}
            value={status}
            options={STATUS_OPTIONS}
            onSelect={(v) => setStatus(v as StatusFilter)}
            searchable={false}
          />
        </View>
      </View>

      {loading && rows.length === 0 ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t.noInvoices}
          message={t.noInvoicesHint}
          icon={<Receipt size={40} color={colors.muted} />}
          actionLabel={t.noInvoicesAction}
          onAction={() => router.push('/sales/new')}
        />
      ) : (
        <AppCard style={s.listCard}>
          {visible.map((r, i) => (
            <ListRow
              key={r.id}
              title={r.invoiceNo ?? t.draftTag}
              subtitle={`${r.customerName ?? t.cashCustomerName} · ${common.formatDate(r.issuedAt)}`}
              leading={<Receipt size={20} color={colors.accent} />}
              trailing={
                <View style={s.trailing}>
                  <AmountText
                    value={r.total}
                    decimals={0}
                    suffix={r.currencyCode.length > 0 ? r.currencyCode : undefined}
                    size={fontSizes.body}
                  />
                  <View style={s.chipsRow}>
                    <StatusChip
                      status={r.status === 'completed' ? 'active' : (r.status as 'draft' | 'void')}
                      label={r.status === 'completed' ? t.statusCompleted : r.status === 'draft' ? t.draftTag : t.voidTag}
                    />
                    <StatusChip status={r.payStatus as 'cash' | 'credit' | 'mixed'} />
                  </View>
                </View>
              }
              onPress={() => router.push(`/sales/${r.id}`)}
              last={i === visible.length - 1}
            />
          ))}
          {visible.length === 0 && rows.length > 0 ? (
            <Text style={s.emptyFiltered}>{common.noResults}</Text>
          ) : null}
        </AppCard>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusSelect: {
    flexGrow: 1,
    minWidth: 150,
  },
  listCard: { paddingVertical: spacing.xs },
  trailing: { alignItems: 'flex-end', gap: 6 },
  chipsRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  emptyFiltered: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
