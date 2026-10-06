import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold } from '@expo-google-fonts/tajawal';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic';
import { I18nManager } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { FeedbackBar, OfflineBanner } from '@/components';
import { useSessionStore } from '@/store/session';

// RTL قسري عالمياً (DS-16) — استدعاء مبكر آمن (no-op على منصات لا تدعمه)
try {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
} catch {
  // لا يؤثر على المعاينة — dir="rtl" يُحقن في <html> من سكربت البناء
}

/** شاشة الإقلاع — لا شاشة بيضاء أبدًا (DS-32). */
function BootSplash() {
  return (
    <View style={s.boot}>
      <View style={s.logoWrap}>
        <Svg width={72} height={72} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="bootGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.gradientFrom} />
              <Stop offset="1" stopColor={colors.gradientTo} />
            </LinearGradient>
          </Defs>
          <Circle cx={36} cy={36} r={34} fill="url(#bootGrad)" />
        </Svg>
        <Text style={s.logoGlyph}>ح</Text>
      </View>
      <Text style={s.bootName}>{common.appName}</Text>
      <Text style={s.bootTagline}>{common.tagline}</Text>
      <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    IBMPlexSansArabic_600SemiBold,
  });

  const status = useSessionStore((s) => s.status);
  const boot = useSessionStore((s) => s.boot);
  const startWatchers = useSessionStore((s) => s.startWatchers);
  const noteActivity = useSessionStore((s) => s.noteActivity);

  // الإقلاع + مراقبات القفل التلقائي (مرة واحدة)
  useEffect(() => {
    void boot();
    startWatchers();
  }, [boot, startWatchers]);

  // التوجيه حسب حالة الجلسة (Segment)
  useEffect(() => {
    if (status === 'onboarding') router.replace('/auth/onboarding');
    else if (status === 'locked') router.replace('/auth/login');
    else if (status === 'unlocked') router.replace('/');
  }, [status]);

  if (!fontsLoaded) return null;

  return (
    <View
      style={s.root}
      // تتبع لمس بسيط: أي لمسة تعيد مؤقت القفل التلقائي (capture يصل حتى فوق الأزرار)
      onStartShouldSetResponderCapture={() => {
        noteActivity();
        return false;
      }}
      onPointerDown={() => noteActivity()}
      collapsable={false}
    >
      <StatusBar style="light" backgroundColor={colors.bg} />
      <OfflineBanner />
      {status === 'boot' ? (
        <BootSplash />
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        />
      )}
      <FeedbackBar />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
  },
  logoWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoGlyph: {
    fontFamily: fonts.bodyBold,
    fontSize: 30,
    fontWeight: '700',
    color: colors.bg,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  bootName: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.display,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bootTagline: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
});
