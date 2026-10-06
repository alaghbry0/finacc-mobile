import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold } from '@expo-google-fonts/tajawal';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic';
import { I18nManager } from 'react-native';
import { colors } from '@/theme';

// RTL قسري عالمياً (DS-16) — استدعاء مبكر آمن (no-op على منصات لا تدعمه)
try {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
} catch {
  // لا يؤثر على المعاينة — dir="rtl" يُحقن في <html> من سكربت البناء
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    IBMPlexSansArabic_600SemiBold,
  });

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="light" backgroundColor={colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  );
}
