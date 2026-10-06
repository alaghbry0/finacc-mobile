import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SearchX } from 'lucide-react-native';
import { SecondaryButton } from './buttons';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface NoResultsStateProps {
  /** عنوان مخصص (افتراضي common.noResults) */
  title?: string;
  message?: string;
  onClearFilters?: () => void;
  clearLabel?: string;
  style?: ViewStyle;
}

/** NoResultsState (DS-35): «لا توجد أصناف ضمن هذه المعايير» + زر مسح الفلاتر — للبحث والفلاتر الفارغة. */
export function NoResultsState({
  title,
  message,
  onClearFilters,
  clearLabel,
  style,
}: NoResultsStateProps) {
  return (
    <View style={[s.wrap, style]}>
      <View style={s.iconCircle}>
        <SearchX size={38} color={colors.muted} />
      </View>
      <Text style={s.title}>{title ?? common.noResults}</Text>
      <Text style={s.message}>{message ?? common.noResultsHint}</Text>
      {onClearFilters !== undefined ? (
        <SecondaryButton label={clearLabel ?? common.clearFilters} onPress={onClearFilters} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: radii.xl,
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
});
