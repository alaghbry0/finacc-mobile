import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Undo2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '@/store/toast';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

const WEB = Platform.OS === 'web';

/**
 * FeedbackBar (DS-37): snackbar سفلي 5 ثوانٍ بزر «تراجع» — يُركَّب مرة واحدة في جذر التطبيق.
 * مصدر الحالة: `useToastStore` (zustand).
 */
export function FeedbackBar() {
  const visible = useToastStore((s) => s.visible);
  const message = useToastStore((s) => s.message);
  const undo = useToastStore((s) => s.undo);
  const dismiss = useToastStore((s) => s.dismiss);
  const runUndo = useToastStore((s) => s.runUndo);
  const insets = useSafeAreaInsets();

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: !WEB,
    }).start();
  }, [visible, anim]);

  if (message.length === 0) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrap,
        { marginBottom: insets.bottom + spacing.sm },
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
            },
          ],
        },
      ]}
    >
      <View style={styles.bar}>
        <Text style={styles.message} numberOfLines={3}>
          {message}
        </Text>
        {undo !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={undo.label}
            onPress={runUndo}
            style={({ pressed }) => [styles.undoBtn, pressed && styles.pressed]}
          >
            <Undo2 size={16} color={colors.accent} />
            <Text style={styles.undoText}>{undo.label || common.undo}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={common.dismiss}
            onPress={dismiss}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            hitSlop={8}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    maxWidth: 640,
    width: '100%',
  },
  message: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    lineHeight: 19,
  },
  undoBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.extra.accentSoft,
  },
  undoText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 22,
    color: colors.muted,
    includeFontPadding: false,
    lineHeight: 24,
  },
  pressed: { opacity: 0.85 },
});
