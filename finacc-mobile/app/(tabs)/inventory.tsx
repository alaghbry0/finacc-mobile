import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Bell, Box, ClipboardCheck, FolderTree, Plus, Ruler } from 'lucide-react-native';
import {
  AmountText,
  EmptyState,
  ListRow,
  LoadingSkeleton,
  NoResultsState,
  Screen,
  SearchBar,
} from '@/components';
import { inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { formatMoney } from '@/utils/format';
import { getBaseCurrency } from '@/domain/currency';
import { findByBarcode, searchProducts, type ProductListRow } from '@/domain/inventory';
import { useToastStore } from '@/store/toast';
import { ScannerSheet } from '@/screens/inventory/ScannerSheet';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * شاشة الأصناف والمخزون (تبويب المخزون — الوحدة 01):
 * بحث فوري بالاسم/الباركود (FR-01-04، debounce 200ms) + مسح باركود (FR-01-03)
 * + قائمة أرصدة وأسعار + مداخل الإدارة (تنبيهات/فئات/وحدات) + زر صنف جديد.
 */
export default function InventoryScreen() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ProductListRow[] | null>(null);
  const [baseCode, setBaseCode] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const toast = useToastStore((s) => s.show);
  const requestIdRef = useRef(0);

  // debounce البحث الفوري أثناء الكتابة (FR-01-04)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchRows = useCallback(async (q: string) => {
    const req = ++requestIdRef.current;
    try {
      const result = await searchProducts(q, { limit: 60 });
      if (req === requestIdRef.current) setRows(result);
    } catch (e) {
      if (req === requestIdRef.current) {
        setRows([]);
        toast(e instanceof Error ? e.message : 'تعذر تحميل الأصناف');
      }
    }
  }, [toast]);

  // رمز العملة الأساسية لعرض الأسعار
  useEffect(() => {
    void (async () => {
      try {
        setBaseCode((await getBaseCurrency()).code);
      } catch {
        setBaseCode(null);
      }
    })();
  }, []);

  useEffect(() => {
    void fetchRows(debounced);
  }, [debounced, fetchRows]);

  // إعادة الجلب عند العودة من شاشات الإنشاء/التعديل
  useFocusEffect(
    useCallback(() => {
      void fetchRows(debounced);
    }, [debounced, fetchRows]),
  );

  const onScanFound = useCallback(
    async (barcode: string) => {
      try {
        const product = await findByBarcode(barcode);
        setScanOpen(false);
        if (product === null) {
          toast(t.scanNotFound);
          return;
        }
        router.push(`/inventory/${product.id}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'تعذر البحث عن الباركود');
      }
    },
    [toast],
  );

  const hasQuery = debounced !== '';
  const loading = rows === null;

  return (
    <Screen title={t.title} scroll={false}>
      <View style={s.searchWrap}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={t.searchPlaceholder}
          onScan={() => setScanOpen(true)}
        />
        <View style={s.manageRow}>
          <ManageTile icon={<Bell size={20} color={colors.warning} />} label={t.alerts} onPress={() => router.push('/inventory/alerts')} />
          <ManageTile icon={<ClipboardCheck size={20} color={colors.accent} />} label={t.stocktakeEntry} onPress={() => router.push('/inventory/stocktake')} />
          <ManageTile icon={<FolderTree size={20} color={colors.accent} />} label={t.categories} onPress={() => router.push('/inventory/categories')} />
          <ManageTile icon={<Ruler size={20} color={colors.success} />} label={t.units} onPress={() => router.push('/inventory/units')} />
        </View>
      </View>

      <ScrollView
        style={s.grow}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : rows !== null && rows.length === 0 ? (
          hasQuery ? (
            <NoResultsState onClearFilters={() => setQuery('')} />
          ) : (
            <EmptyState
              icon={<Box size={40} color={colors.accent} />}
              title={t.emptyTitle}
              message={t.emptyMessage}
              actionLabel={t.emptyAction}
              onAction={() => router.push('/inventory/new')}
            />
          )
        ) : (
          rows!.map((p, i) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={p.barcode ?? t.serviceBadge}
              leading={
                <View style={[s.iconCircle, p.isService && s.iconCircleService]}>
                  <Box size={20} color={p.isService ? colors.accent : colors.textSecondary} />
                </View>
              }
              trailing={
                <View style={s.trailing}>
                  {p.isService ? (
                    <Text style={s.serviceText}>{t.serviceBadge}</Text>
                  ) : (
                    <View style={[s.qtyBadge, p.belowMin && s.qtyBadgeWarn]}>
                      <Text style={[s.qtyBadgeText, p.belowMin && s.qtyBadgeTextWarn]}>
                        {`${t.qtyBadge} ${formatMoney(p.totalQty, 0)}`}
                      </Text>
                    </View>
                  )}
                  {p.basePrice !== null ? (
                    <AmountText value={p.basePrice} size={fontSizes.body} suffix={baseCode ?? undefined} />
                  ) : (
                    <Text style={s.noPrice}>{t.noPrice}</Text>
                  )}
                </View>
              }
              onPress={() => router.push(`/inventory/${p.id}`)}
              last={i === rows!.length - 1}
            />
          ))
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.newProduct}
        onPress={() => router.push('/inventory/new')}
        style={({ pressed }) => [s.fab, pressed && s.pressed]}
      >
        <Plus size={30} color={colors.bg} strokeWidth={2.8} />
      </Pressable>

      <ScannerSheet visible={scanOpen} onClose={() => setScanOpen(false)} onFound={onScanFound} />
    </Screen>
  );
}

function ManageTile({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.manageTile, pressed && s.pressed]}
    >
      {icon}
      <Text style={s.manageLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  manageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  manageTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  manageLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 96,
    flexGrow: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleService: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 6,
  },
  qtyBadge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.extra.mutedSoft,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    minHeight: 24,
    justifyContent: 'center',
  },
  qtyBadgeWarn: {
    borderColor: 'rgba(248, 113, 113, 0.35)',
    backgroundColor: colors.extra.errorSoft,
  },
  qtyBadgeText: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  qtyBadgeTextWarn: {
    color: colors.error,
    fontFamily: fonts.bodyBold,
  },
  serviceText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.accent,
  },
  noPrice: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  fab: {
    position: 'absolute',
    left: spacing.lg,
    bottom: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#22D3EE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
  },
  pressed: { opacity: 0.85 },
});
