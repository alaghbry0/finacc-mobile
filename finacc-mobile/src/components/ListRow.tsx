import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { colors, fontSizes, fonts, spacing } from '@/theme';

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** العنصر البادئ (أيقونة/صورة) */
  leading?: ReactNode;
  /** العنصر الخاتم (مبلغ AmountText عادةً) */
  trailing?: ReactNode;
  onPress?: () => void;
  /** إزالة الفاصل السفلي للصف الأخير (DS-22 فاصل #334155) */
  last?: boolean;
  style?: ViewStyle;
}

/** ListRow (DS-22): صف قائمة — عنوان + سطر ثانوي + مبلغ جانبي، ارتفاع ≥64، فاصل #334155. */
export function ListRow({ title, subtitle, leading, trailing, onPress, last, style }: ListRowProps) {
  const row = (
    <View style={[s.row, !last && s.divider, style]} pointerEvents={onPress !== undefined ? 'box-none' : 'auto'}>
      {leading !== undefined ? <View style={s.leading}>{leading}</View> : null}
      <View style={s.textWrap}>
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text style={s.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing !== undefined ? <View style={s.trailing}>{trailing}</View> : null}
    </View>
  );

  if (onPress === undefined) return row;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [pressed && s.pressed]}
    >
      {row}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  trailing: { alignItems: 'flex-end', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
});
