import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Plus, UserRound, UsersRound } from 'lucide-react-native';
import {
  AmountText,
  EmptyState,
  ListRow,
  LoadingSkeleton,
  NoResultsState,
  Screen,
  SearchBar,
} from '@/components';
import { getBaseCurrency } from '@/domain/currency';
import { searchCustomers, searchSuppliers, type CustomerListRow } from '@/domain/parties';
import { common, parties as partiesAr, tabs } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

type PartyTab = 'customers' | 'suppliers';

/**
 * شاشة الأطراف (الوحدة 03): تبويب داخلي عملاء/موردين + بحث + قائمة
 * بالرصيد المبسّط بعملة الأساس (مدين كهرماني / دائن أخضر) + زر عائم للإضافة.
 * الأرصدة الكاملة لكل عملة داخل ملف الطرف (قرار 8).
 */
export default function PartiesScreen() {
  const [tab, setTab] = useState<PartyTab>('customers');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<CustomerListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseCode, setBaseCode] = useState<string>('');
  const firstFocus = useRef(true);

  // إعادة تحميل القائمة عند العودة من الإضافة/الملف (المعطيات محلية وسريعة)
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void loadRef.current?.();
    }, []),
  );

  // بحث خفيف debounce (البيانات محلية)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = tab === 'customers' ? await searchCustomers(debounced) : await searchSuppliers(debounced);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, debounced]);

  // مرجع حي لآخر نسخة من load (يستخدمه مستمع التركيز أعلاه)
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  loadRef.current = load;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setBaseCode((await getBaseCurrency()).code);
      } catch {
        /* قبل الإعداد الأولي — تعرض القائمة بلا لاحقة */
      }
    })();
  }, []);

  const isCustomers = tab === 'customers';
  const addRoute = isCustomers ? '/parties/customers/new' : '/parties/suppliers/new';

  const renderRow = ({ item, index }: { item: CustomerListRow; index: number }) => {
    const balance = Number(item.baseBalance);
    const isDebit = balance > 0;
    const isCredit = balance < 0;
    return (
      <ListRow
        title={item.name}
        subtitle={item.phone ?? item.area ?? undefined}
        leading={<View style={s.avatar}><Text style={s.avatarLetter}>{item.name.trim().charAt(0)}</Text></View>}
        trailing={
          <View style={s.rowTrailing}>
            <AmountText
              value={item.baseBalance}
              mark="none"
              decimals={0}
              size={fontSizes.body}
              suffix={baseCode.length > 0 ? baseCode : undefined}
              color={isDebit ? colors.warning : isCredit ? colors.success : colors.muted}
            />
            {isDebit ? <Text style={[s.tag, s.tagDebit]}>{partiesAr.debit}</Text> : null}
            {isCredit ? <Text style={[s.tag, s.tagCredit]}>{partiesAr.credit}</Text> : null}
          </View>
        }
        onPress={() => router.push(`${isCustomers ? '/parties/customers/' : '/parties/suppliers/'}${item.id}`)}
        last={index === rows.length - 1}
      />
    );
  };

  const list = useMemo(
    () => (
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderRow}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, isCustomers, baseCode],
  );

  return (
    <Screen title={tabs.parties} scroll={false}>
      {/* تبويب داخلي: عملاء | موردون */}
      <View style={s.tabsRow}>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={partiesAr.customers}
          accessibilityState={{ selected: isCustomers }}
          onPress={() => setTab('customers')}
          style={({ pressed }) => [s.tabBtn, isCustomers && s.tabBtnActive, pressed && s.pressed]}
        >
          <UserRound size={18} color={isCustomers ? colors.accent : colors.textSecondary} />
          <Text style={[s.tabText, isCustomers && s.tabTextActive]}>{partiesAr.customers}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={partiesAr.suppliers}
          accessibilityState={{ selected: !isCustomers }}
          onPress={() => setTab('suppliers')}
          style={({ pressed }) => [s.tabBtn, !isCustomers && s.tabBtnActive, pressed && s.pressed]}
        >
          <UsersRound size={18} color={!isCustomers ? colors.accent : colors.textSecondary} />
          <Text style={[s.tabText, !isCustomers && s.tabTextActive]}>{partiesAr.suppliers}</Text>
        </Pressable>
      </View>

      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={partiesAr.searchPlaceholder}
        style={s.search}
      />

      <View style={s.grow}>
        {loading ? (
          <LoadingSkeleton variant="list" rows={6} style={s.skeleton} />
        ) : error !== null ? (
          <EmptyState title={common.errorTitle} message={error} actionLabel={common.retry} onAction={() => void load()} />
        ) : rows.length === 0 ? (
          debounced.length > 0 ? (
            <NoResultsState onClearFilters={() => setQuery('')} />
          ) : (
            <EmptyState
              icon={<UserRound size={40} color={colors.muted} />}
              title={isCustomers ? partiesAr.emptyCustomersTitle : partiesAr.emptySuppliersTitle}
              message={isCustomers ? partiesAr.emptyCustomersMessage : partiesAr.emptySuppliersMessage}
              actionLabel={isCustomers ? partiesAr.emptyCustomersAction : partiesAr.emptySuppliersAction}
              onAction={() => router.push(addRoute)}
            />
          )
        ) : (
          list
        )}
      </View>

      {/* زر عائم للإضافة (≥56 هدف لمس) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isCustomers ? partiesAr.addCustomer : partiesAr.addSupplier}
        onPress={() => router.push(addRoute)}
        style={({ pressed }) => [s.fab, pressed && s.pressed]}
      >
        <Plus size={28} color={colors.bg} strokeWidth={2.6} />
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.sm,
  },
  tabBtnActive: {
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
  },
  tabText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  tabTextActive: {
    fontFamily: fonts.bodyBold,
    color: colors.accent,
  },
  search: { marginTop: spacing.md },
  skeleton: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  listContent: {
    paddingBottom: 120,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    color: colors.accent,
    includeFontPadding: false,
  },
  rowTrailing: { alignItems: 'flex-end', gap: 2 },
  tag: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  tagDebit: {
    color: colors.warning,
    backgroundColor: colors.extra.warningSoft,
  },
  tagCredit: {
    color: colors.success,
    backgroundColor: colors.extra.successSoft,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 58,
    height: 58,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  pressed: { opacity: 0.85 },
});
