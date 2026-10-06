import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Construction } from 'lucide-react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { EmptyState, Screen } from '@/components';

interface ComingSoonProps {
  title: string;
  /** رسالة توضيحية إضافية تحدد موجة البناء */
  message?: string;
  /** إظهار زر رجوع (افتراضي نعم) */
  showBack?: boolean;
}

/** ComingSoon: غلاف موحّد لشاشات الموجات القادمة — Screen + EmptyState + رجوع. */
export function ComingSoon({ title, message, showBack = true }: ComingSoonProps) {
  return (
    <Screen
      title={title}
      onBack={showBack ? () => router.back() : undefined}
      scroll={false}
    >
      <View style={s.center}>
        <EmptyState
          icon={<Construction size={40} color={colors.warning} />}
          title={common.comingSoonTitle}
          message={message ?? common.comingSoonMessage}
        />
        <Text style={s.app}>{common.appName}</Text>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  app: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    marginTop: spacing.md,
  },
});
