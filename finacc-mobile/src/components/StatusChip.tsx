import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

export type DocStatus = keyof typeof common.statuses;

/** خريطة الدلالة: كل حالة → لون نص + خلفية باهتة + حدود (DS-26). */
const STATUS_COLORS: Record<DocStatus, { fg: string; bg: string; border: string }> = {
  cash: { fg: colors.success, bg: colors.extra.successSoft, border: 'rgba(52, 211, 153, 0.35)' },
  paid: { fg: colors.success, bg: colors.extra.successSoft, border: 'rgba(52, 211, 153, 0.35)' },
  cleared: { fg: colors.success, bg: colors.extra.successSoft, border: 'rgba(52, 211, 153, 0.35)' },
  active: { fg: colors.success, bg: colors.extra.successSoft, border: 'rgba(52, 211, 153, 0.35)' },
  credit: { fg: colors.warning, bg: colors.extra.warningSoft, border: 'rgba(251, 191, 36, 0.35)' },
  partial: { fg: colors.warning, bg: colors.extra.warningSoft, border: 'rgba(251, 191, 36, 0.35)' },
  mixed: { fg: colors.warning, bg: colors.extra.warningSoft, border: 'rgba(251, 191, 36, 0.35)' },
  deposited: { fg: colors.warning, bg: colors.extra.warningSoft, border: 'rgba(251, 191, 36, 0.35)' },
  pending: { fg: colors.textSecondary, bg: colors.extra.mutedSoft, border: colors.border },
  draft: { fg: colors.textSecondary, bg: colors.extra.mutedSoft, border: colors.border },
  archived: { fg: colors.textSecondary, bg: colors.extra.mutedSoft, border: colors.border },
  cancelled: { fg: colors.error, bg: colors.extra.errorSoft, border: 'rgba(248, 113, 113, 0.35)' },
  void: { fg: colors.error, bg: colors.extra.errorSoft, border: 'rgba(248, 113, 113, 0.35)' },
  bounced: { fg: colors.error, bg: colors.extra.errorSoft, border: 'rgba(248, 113, 113, 0.35)' },
  overdue: { fg: colors.error, bg: colors.extra.errorSoft, border: 'rgba(248, 113, 113, 0.35)' },
};

interface StatusChipProps {
  status: DocStatus;
  /** نص مخصص يعلو الافتراضي من i18n */
  label?: string;
  size?: 'sm' | 'md';
  style?: ViewStyle;
  /** تلوين مباشر يتجاوز حالة المستند (لاستخدامات غير مستندية مثل حالة الجرد) */
  tone?: 'success' | 'warning' | 'error' | 'muted';
}

/**
 * StatusChip (DS-26): شريحة حالة — نقدي أخضر / آجل كهرماني / معلّق رمادي /
 * ملغى أحمر باهت. دائمًا نص + لون + نقطة علامة غير لونية (لا اعتماد على اللون وحده).
 */
export function StatusChip({ status, label, size = 'sm', style, tone }: StatusChipProps) {
  const c = tone !== undefined ? TONE_COLORS[tone] : STATUS_COLORS[status];
  return (
    <View
      style={[
        s.chip,
        size === 'md' && s.chipMd,
        { backgroundColor: c.bg, borderColor: c.border },
        style,
      ]}
      accessibilityLabel={label ?? common.statuses[status]}
    >
      <View style={[s.dot, { backgroundColor: c.fg }]} />
      <Text style={[s.text, size === 'md' && s.textMd, { color: c.fg }]} numberOfLines={1}>
        {label ?? common.statuses[status]}
      </Text>
    </View>
  );
}

const TONE_COLORS: Record<'success' | 'warning' | 'error' | 'muted', { bg: string; border: string; fg: string }> = {
  success: { bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.4)', fg: '#34D399' },
  warning: { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.4)', fg: '#FBBF24' },
  error: { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.4)', fg: '#F87171' },
  muted: { bg: 'rgba(100, 116, 139, 0.15)', border: 'rgba(100, 116, 139, 0.4)', fg: '#CBD5E1' },
};

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 24,
  },
  chipMd: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    minHeight: 32,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    fontWeight: '500',
    includeFontPadding: false,
  },
  textMd: {
    fontSize: fontSizes.caption,
  },
});
