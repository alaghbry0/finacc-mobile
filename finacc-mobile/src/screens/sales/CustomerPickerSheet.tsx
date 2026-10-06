import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Check, PackageSearch, UserRound } from 'lucide-react-native';
import { BottomSheet, SearchBar, AmountText } from '@/components';
import { searchCustomers, type CustomerListRow } from '@/domain/parties';
import { sales as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface CustomerPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** null = عميل نقدي (بيع مباشر بلا حساب). */
  onPick: (party: { id: number; name: string } | null) => void;
}

/**
 * شيت اختيار العميل (شريط الأعلى §6.5): بحث فوري بالاسم/الهاتف + زر «عميل نقدي».
 * الرصيد المبسط بعملة الأساس (مدين كهرماني / دائن أخضر — دائماً مع إشارة غير لونية).
 */
export function CustomerPickerSheet({ visible, onClose, onPick }: CustomerPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CustomerListRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      setRows(await searchCustomers(q));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.customerPickerTitle}>
      <View style={s.body}>
        <SearchBar value={query} onChangeText={setQuery} placeholder={t.customerSearch} inputMode="search" />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.walkInCustomer}
          onPress={() => {
            onPick(null);
            onClose();
          }}
          style={({ pressed }) => [s.walkIn, pressed && s.pressed]}
        >
          <UserRound size={22} color={colors.accent} />
          <View style={s.walkInText}>
            <Text style={s.walkInTitle}>{t.walkInCustomer}</Text>
            <Text style={s.walkInHint}>{t.walkInHint}</Text>
          </View>
          <Check size={20} color={colors.accent} strokeWidth={2.6} />
        </Pressable>

        {rows.map((c) => {
          const balance = Number(c.baseBalance);
          const isDebit = balance > 0.0001;
          const isCredit = balance < -0.0001;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => {
                onPick({ id: c.id, name: c.name });
                onClose();
              }}
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
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
            </Pressable>
          );
        })}

        {!loading && rows.length === 0 ? (
          <View style={s.empty}>
            <PackageSearch size={34} color={colors.muted} />
            <Text style={s.emptyText}>{t.noCustomers}</Text>
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
  walkIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    borderRadius: radii.md,
  },
  walkInText: { flex: 1, gap: 2 },
  walkInTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  walkInHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
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
