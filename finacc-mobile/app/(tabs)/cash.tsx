import { StyleSheet, View } from 'react-native';
import { WalletMinimal } from 'lucide-react-native';
import { tabs } from '@/i18n/ar';
import { colors } from '@/theme';
import { AppCard, EmptyState, Screen } from '@/components';

/** النقدية (مؤقت — يُستبدل في الموجة 5). */
export default function CashScreen() {
  return (
    <Screen title={tabs.cash} scroll={false}>
      <View style={s.center}>
        <AppCard>
          <EmptyState
            icon={<WalletMinimal size={40} color={colors.success} />}
            title={tabs.cashComingTitle}
            message={tabs.cashComingMessage}
          />
        </AppCard>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
});
