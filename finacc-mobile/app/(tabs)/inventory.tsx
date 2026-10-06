import { StyleSheet, View } from 'react-native';
import { PackageSearch } from 'lucide-react-native';
import { tabs } from '@/i18n/ar';
import { colors } from '@/theme';
import { AppCard, EmptyState, Screen } from '@/components';

/** المخزون (مؤقت — يُستبدل في الموجة 3). */
export default function InventoryScreen() {
  return (
    <Screen title={tabs.inventory} scroll={false}>
      <View style={s.center}>
        <AppCard>
          <EmptyState
            icon={<PackageSearch size={40} color={colors.accent} />}
            title={tabs.inventoryComingTitle}
            message={tabs.inventoryComingMessage}
          />
        </AppCard>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
});
