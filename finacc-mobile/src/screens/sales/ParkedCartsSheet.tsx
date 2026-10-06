import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { ShoppingBasket, Trash2 } from 'lucide-react-native';
import { BottomSheet, PrimaryButton, SecondaryButton } from '@/components';
import type { ParkedCartMeta } from '@/store/cart';
import { sales as t } from '@/i18n/ar';
import { common } from '@/i18n/ar';
import { formatMoney } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ParkedCartsSheetProps {
  visible: boolean;
  onClose: () => void;
  parked: ParkedCartMeta[];
  currencyCode: string;
  onRestore: (id: string) => void;
  onForget: (id: string) => void;
}

/** شريط المعلّقات (FR-02-13): استعادة سلة معلّقة أو حذفها — Park سلة محلية وليست مستنداً (قرار 2). */
export function ParkedCartsSheet({ visible, onClose, parked, currencyCode, onRestore, onForget }: ParkedCartsSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.parkedTitle}>
      <View style={s.body}>
        {parked.length === 0 ? (
          <View style={s.empty}>
            <ShoppingBasket size={36} color={colors.muted} />
            <Text style={s.emptyText}>{t.parkedEmpty}</Text>
          </View>
        ) : (
          parked.map((p) => (
            <View key={p.id} style={s.row}>
              <View style={s.rowText}>
                <Text style={s.title} numberOfLines={1}>
                  {p.title}
                </Text>
                <Text style={s.meta} numberOfLines={1}>
                  {/* Intl غير مضمون على Hermes — common.formatDate (Task Android-Fix) */}
                  {common.formatDate(String(p.savedAt).slice(0, 10))} • {p.itemCount} بند •{' '}
                  {formatMoney(Number(p.total), 0)} {currencyCode}
                </Text>
              </View>
              <SecondaryButton label={t.restore} onPress={() => onRestore(p.id)} height={44} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.forget} ${p.title}`}
                onPress={() => onForget(p.id)}
                style={({ pressed }) => [s.delBtn, pressed && s.pressed]}
                hitSlop={4}
              >
                <Trash2 size={18} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
        <PrimaryButton label="تم" onPress={onClose} />
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
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  delBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.extra.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
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
    textAlign: 'center',
  },
  pressed: { opacity: 0.8 },
});
