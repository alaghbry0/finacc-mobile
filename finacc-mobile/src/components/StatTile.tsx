import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface StatTileProps {
  /** عنوان صغير */
  label: string;
  /** القيمة (نص منسَّق مسبقًا أو رقم) */
  value: ReactNode;
  /** لون القيمة (افتراضي النص الأساسي) */
  valueColor?: string;
  /** نسبة التغير عن الفترة السابقة بالنسبة المئوية (مثال 12.5) — تُخفى إن لم تُمرَّر */
  changePercent?: number;
  /** أيقونة صغيرة أعلى البلاطة */
  icon?: ReactNode;
  style?: ViewStyle;
}

/**
 * StatTile (DS-19): بلاطة إحصائية — عنوان صغير + رقم كبير (IBM Plex tnum)
 * + سهم نسبة تغيّر (علامة غير لونية + لون).
 */
export function StatTile({ label, value, valueColor = colors.textPrimary, changePercent, icon, style }: StatTileProps) {
  const up = (changePercent ?? 0) >= 0;
  return (
    <View style={[s.tile, style]}>
      <View style={s.topRow}>
        {icon !== undefined ? <View style={s.iconWrap}>{icon}</View> : null}
        <Text style={s.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[s.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {changePercent !== undefined ? (
        <View style={s.changeRow}>
          {up ? (
            <TrendingUp size={14} color={colors.success} strokeWidth={2.4} />
          ) : (
            <TrendingDown size={14} color={colors.error} strokeWidth={2.4} />
          )}
          <Text style={[s.change, { color: up ? colors.success : colors.error }]}>
            {up ? '+' : '−'}
            {Math.abs(changePercent).toFixed(1)}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 96,
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: { opacity: 0.9 },
  label: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  value: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 22,
    fontWeight: '600',
    includeFontPadding: false,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  change: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    fontWeight: '600',
  },
});
