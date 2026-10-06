import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

const WEB = Platform.OS === 'web';
const CLOSE_THRESHOLD = 90;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** السماح بالإغلاق بالنقر خارج الشيت أو سحبه لأسفل أو زر الرجوع (افتراضي نعم) */
  dismissible?: boolean;
  /** نسبة أقصى ارتفاع من الشاشة (الافتراضي 0.9) */
  maxHeightRatio?: number;
}

/**
 * BottomSheet (DS-23): Modal سفلي نصف قطر أعلى 20 + مقبض سحب،
 * يُغلق بالنقر خارجه أو بالسحب لأسفل أو بزجاجة الرجوع.
 * حركة انتقال fade+slide بـ 220ms (DS-28 — لا مبالغات).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  dismissible = true,
  maxHeightRatio = 0.9,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const sheetHeightRef = useRef(600);
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(600)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const animateIn = useCallback(() => {
    translateY.setValue(sheetHeightRef.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: !WEB,
      }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: !WEB }),
    ]).start();
  }, [translateY, backdrop]);

  const animateOut = useCallback(
    (after?: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: sheetHeightRef.current + 40,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: !WEB,
        }),
        Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: !WEB }),
      ]).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          after?.();
        }
      });
    },
    [translateY, backdrop],
  );

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setMounted(true);
    } else if (mounted) {
      closingRef.current = true;
      animateOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (mounted && visible) animateIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible]);

  // زر الرجوع في أندرويد
  useEffect(() => {
    if (!mounted || WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (visible && dismissible) {
        requestClose();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible, dismissible]);

  const requestClose = useCallback(() => {
    if (!dismissible || closingRef.current) return;
    closingRef.current = true;
    animateOut(onClose);
  }, [dismissible, animateOut, onClose]);

  // مراجع حية للقيم التي يلتقطها PanResponder مرة واحدة (تجنب الإغلاق أثناء busy)
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => dismissibleRef.current && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > CLOSE_THRESHOLD || g.vy > 1.4) {
          requestCloseRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: !WEB, friction: 9 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: !WEB, friction: 9 }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  const maxSheetHeight = Math.round(Dimensions.get('window').height * maxHeightRatio);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <View style={s.overlay}>
        <Animated.View style={[s.backdrop, { opacity: backdrop }]} {...{ pointerEvents: 'auto' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={common.close}
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
            disabled={!dismissible}
          />
        </Animated.View>
        <Animated.View
          style={[
            s.sheet,
            {
              maxHeight: maxSheetHeight,
              paddingBottom: insets.bottom + spacing.md,
              transform: [{ translateY }],
            },
          ]}
          {...(dismissible ? pan.panHandlers : {})}
        >
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>
          {title !== undefined ? (
            <View style={s.titleRow}>
              <Text style={s.title} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={common.close}
                onPress={requestClose}
                disabled={!dismissible}
                style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}
                hitSlop={6}
              >
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <View onLayout={(e) => { sheetHeightRef.current = Math.max(160, e.nativeEvent.layout.height + 120); }} collapsable={false}>
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.65)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopRightRadius: radii.xl,
    borderTopLeftRadius: radii.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
