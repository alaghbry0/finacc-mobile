import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/theme';

type SkeletonVariant = 'list' | 'card' | 'tiles' | 'header';

interface LoadingSkeletonProps {
  variant?: SkeletonVariant;
  /** عدد الصفوف في variant="list" (الافتراضي 5) */
  rows?: number;
  style?: StyleProp<ViewStyle>;
}

const WEB = Platform.OS === 'web';

/** بلاطة واحدة مع وميض shimmer — تتحرك مع قيمة الأنيميشن المشتركة. */
function useShimmer() {
  const val = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(val, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: !WEB,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [val]);
  return val;
}

function Bone({ style }: { style?: StyleProp<ViewStyle> }) {
  const shimmer = useShimmer();
  const opacity = shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] });
  return (
    <Animated.View style={[s.bone, { opacity }, style]} />
  );
}

/**
 * LoadingSkeleton (DS-32): هيكل Skeleton بـ shimmer للقوائم والبطاقات والتقارير —
 * لا شاشة بيضاء أبدًا (التقارير حتى 3 ثوانٍ تُظهر هيكلًا حيًّا).
 */
export function LoadingSkeleton({ variant = 'list', rows = 5, style }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return (
      <View style={[s.card, style]}>
        <Bone style={s.cardTitle} />
        <Bone style={[s.line, { width: '90%' }]} />
        <Bone style={[s.line, { width: '70%' }]} />
        <Bone style={[s.line, { width: '45%', height: 22 }]} />
      </View>
    );
  }
  if (variant === 'tiles') {
    return (
      <View style={[s.tilesWrap, style]}>
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} style={s.tile} />
        ))}
      </View>
    );
  }
  if (variant === 'header') {
    return (
      <View style={[style, { gap: spacing.md }]}>
        <Bone style={s.bigTitle} />
        <Bone style={[s.line, { width: '60%' }]} />
      </View>
    );
  }
  // list
  return (
    <View style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={s.row}>
          <Bone style={s.avatar} />
          <View style={s.rowText}>
            <Bone style={[s.line, { width: '75%' }]} />
            <Bone style={[s.line, { width: '45%', height: 10 }]} />
          </View>
          <Bone style={s.rowAmount} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bone: {
    backgroundColor: colors.extra.mutedSoft,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.4)',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { width: '40%', height: 18 },
  line: { height: 14 },
  tilesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: { width: '48%', height: 92, borderRadius: radii.lg, flexGrow: 1 },
  bigTitle: { width: '50%', height: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.4)',
    minHeight: 64,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  rowText: { flex: 1, gap: spacing.sm },
  rowAmount: { width: 72, height: 20 },
});
