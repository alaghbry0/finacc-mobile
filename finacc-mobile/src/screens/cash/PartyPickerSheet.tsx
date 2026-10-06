import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Check, UserRound, UsersRound } from 'lucide-react-native';
import { BottomSheet, SearchBar, AmountText } from '@/components';
import { searchCustomers, searchSuppliers, type CustomerListRow } from '@/domain/parties';
import { common } from '@/i18n/ar';
import { cash as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface PartyPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (party: { id: number; name: string }) => void;
  kind: 'customer' | 'supplier';
  /** اسم الطرف المختار حالياً (للتمييز في القائمة). */
  selectedName?: string | null;
}

/**
 * شيت اختيار طرف (عميل/مورّد) لنموذج الحركة النقدية — بحث فوري بالاسم/الهاتف
 * + رصيد مبسّط بعملة الأساس (مدين كهرماني / دائن أخضر — دائماً بإشارة غير لونية).
 */
export function PartyPickerSheet({ visible, onClose, onPick, kind, selectedName }: PartyPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CustomerListRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        setRows(kind === 'customer' ? await searchCustomers(q) : await searchSuppliers(q));
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    if (!visible) {
      setQuery('');
      return;
    }
    void load('');
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => void load(query), 200);
    return () => clearTimeout(handle);
  }, [query, visible, load]);

  const title = kind === 'customer' ? t.pickCustomer : t.pickSupplier;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={s.body}>
        <SearchBar value={query} onChangeText={setQuery} placeholder={common.search} inputMode="search" />

        {rows.map((c) => {
          const balance = Number(c.baseBalance);
          const isDebit = balance > 0.0001;
          const isCredit = balance < -0.0001;
          const selected = selectedName !== null && selectedName !== undefined && c.name === selectedName;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => {
                onPick({ id: c.id, name: c.name });
                onClose();
              }}
              style={({ pressed }) => [s.row, pressed && s.pressed, selected && s.rowSelected]}
            >
              {kind === 'customer' ? (
                <UserRound size={22} color={selected ? colors.accent : colors.textSecondary} />
              ) : (
                <UsersRound size={22} color={selected ? colors.accent : colors.textSecondary} />
              )}
              <View style={s.rowText}>
                <Text style={s.name} numberOfLines={1}>
                  {c.name}
                </Text>
                {c.phone !== null && c.phone.length > 0 ? (
                  <Text style={s.phone} numberOfLines={1}>
                    {c.phone}
                  </Text>
                ) : null}
              </View>
              <AmountText
                value={c.baseBalance}
                decimals={0}
                size={fontSizes.caption}
                mark="sign"
                tone={isDebit ? 'out' : 'in'}
                color={isDebit ? colors.warning : isCredit ? colors.success : colors.textSecondary}
              />
              {selected ? <Check size={20} color={colors.accent} strokeWidth={2.6} /> : null}
            </Pressable>
          );
        })}

        {!loading && rows.length === 0 ? (
          <View style={s.empty}>
            <UserRound size={34} color={colors.muted} />
            <Text style={s.emptyText}>{common.noResults}</Text>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  rowText: { flex: 1, gap: 2 },
  name: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  phone: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  pressed: { opacity: 0.85 },
});
