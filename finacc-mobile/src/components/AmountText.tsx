import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Decimal from 'decimal.js';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { formatMoney } from '@/utils/format';
import { colors, fontSizes, fonts, spacing } from '@/theme';

export type AmountTone = 'in' | 'out' | 'neutral';

interface AmountTextProps {
  value: Decimal | number | string;
  /** دلالة الحركة: in=قبض/وارد (أخضر ↓) / out=صرف/خارج (أحمر ↑) / neutral */
  tone?: AmountTone;
  /** العلامة غير اللونية الإلزامية (§6.1): سهم (افتراضي) أو إشارة +/− */
  mark?: 'arrow' | 'sign' | 'none';
  /** عدد الخانات العشرية (افتراضي 2) */
  decimals?: number;
  size?: number;
  /** رمز/كود عملة يظهر بعد الرقم بخط الواجهة */
  suffix?: string;
  /** لون صريح يتجاوز لون الدلالة (أرصدة الأطراف: كهرماني للمدين/أخضر للدائن — Task 3-b) */
  color?: string;
  style?: ViewStyle;
}

function toneColor(tone: AmountTone): string {
  if (tone === 'in') return colors.success;
  if (tone === 'out') return colors.error;
  return colors.textPrimary;
}

/**
 * AmountText (DS-18): مبلغ بخط IBM Plex مع tabular-nums، لون حسب الدلالة
 * + علامة غير لونية إلزامية (سهم ↓↑ أو إشارة +/−) + فواصل آلاف عبر formatMoney.
 * الوصول (DS-30): لا تُعتمد الدلالة على اللون وحده أبدًا.
 */
export function AmountText({
  value,
  tone = 'neutral',
  mark = 'arrow',
  decimals = 2,
  size = fontSizes.title,
  suffix,
  color: colorOverride,
  style,
}: AmountTextProps) {
  const color = colorOverride ?? toneColor(tone);
  const d = new Decimal(value);
  const negative = d.isNegative();
  const body = formatMoney(d.abs(), decimals);

  let content: ReactNode;
  if (mark === 'arrow' && tone !== 'neutral') {
    content = (
      <>
        {tone === 'in' ? (
          <ArrowDownLeft size={size * 0.85} color={color} strokeWidth={2.4} />
        ) : (
          <ArrowUpRight size={size * 0.85} color={color} strokeWidth={2.4} />
        )}
        <Text style={[s.num, { color, fontSize: size, fontFamily: fonts.numeric }]}>{body}</Text>
      </>
    );
  } else if (mark === 'sign' && tone !== 'neutral') {
    content = (
      <Text style={[s.num, { color, fontSize: size, fontFamily: fonts.numeric }]}>
        {tone === 'in' ? '+ ' : '− '}
        {body}
      </Text>
    );
  } else {
    content = (
      <Text style={[s.num, { color, fontSize: size, fontFamily: fonts.numeric }]}>
        {negative ? '− ' : ''}
        {body}
      </Text>
    );
  }

  return (
    <View style={[s.row, style]} pointerEvents="none">
      {content}
      {suffix !== undefined ? (
        <Text style={[s.suffix, { color, fontSize: Math.max(fontSizes.caption, size * 0.62) }]}>
          {' '}
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  num: {
    // DS-18n: أرقام جدولية إلزامية لكل مبلغ
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    includeFontPadding: false,
  },
  suffix: {
    fontFamily: fonts.bodyMedium,
    opacity: 0.9,
  },
});
