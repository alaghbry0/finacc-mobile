import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';

/**
 * OfflineBanner (DS-34): شريط رمادي أعلى الشاشة عند غياب الشبكة — لا يمنع شيئًا.
 * الويب: navigator.onLine + listeners. الـ Native: مخفي مؤقتًا (TODO: NetInfo عند إضافة الحزمة).
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return; // TODO(native): NetInfo عند تثبيت @react-native-community/netinfo
    const nav = navigator as Navigator & { onLine: boolean };
    const update = () => setOffline(!nav.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <View style={s.wrap} accessibilityLiveRegion="polite">
      <WifiOff size={15} color={colors.textSecondary} />
      <Text style={s.text}>{common.offlineBanner}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.extra.mutedSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
