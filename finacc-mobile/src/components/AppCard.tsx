import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/theme';

interface AppCardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** حشوة داخلية (افتراضي 16 وفق DS-17) */
  padding?: number;
  /** بلا حشوة (للبطاقات ذات الترويسة المميزة) */
  flush?: boolean;
  onPress?: never;
}

/** AppCard (DS-17): بطاقة #1E293B نصف قطر 16 ظل خفيف حشوة 16 — أساس كل شاشة. */
export function AppCard({ children, style, padding = spacing.lg, flush = false }: AppCardProps) {
  return (
    <View style={[s.card, !flush && { padding }, flush && { padding: 0 }, style as ViewStyle]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    // ظل خفيف (RNW يحوّله box-shadow)
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
});
