import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Tabs, router } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Home, LayoutGrid, Package, Plus, Wallet } from 'lucide-react-native';
import { tabs } from '@/i18n/ar';
import { colors, fontSizes, fonts } from '@/theme';
import { LoadingSkeleton } from '@/components';
import { useSessionStore } from '@/store/session';

const ICON_SIZE = 22;

function tabIcon(routeName: string, focused: boolean): ReactNode {
  const color = focused ? colors.accent : colors.muted;
  switch (routeName) {
    case 'index':
      return <Home size={ICON_SIZE} color={color} strokeWidth={focused ? 2.4 : 2} />;
    case 'inventory':
      return <Package size={ICON_SIZE} color={color} strokeWidth={focused ? 2.4 : 2} />;
    case 'cash':
      return <Wallet size={ICON_SIZE} color={color} strokeWidth={focused ? 2.4 : 2} />;
    case 'more':
      return <LayoutGrid size={ICON_SIZE} color={color} strokeWidth={focused ? 2.4 : 2} />;
    default:
      return null;
  }
}

function tabLabel(routeName: string): string {
  switch (routeName) {
    case 'index':
      return tabs.home;
    case 'inventory':
      return tabs.inventory;
    case 'cash':
      return tabs.cash;
    case 'more':
      return tabs.more;
    default:
      return '';
  }
}

function TabButton({
  routeName,
  focused,
  onPress,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tabLabel(routeName)}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={({ pressed }) => [s.tabBtn, pressed && s.pressed]}
    >
      {tabIcon(routeName, focused)}
      <Text style={[s.tabLabel, focused && s.tabLabelActive]} numberOfLines={1}>
        {tabLabel(routeName)}
      </Text>
    </Pressable>
  );
}

/** زر البيع البارز وسط الشريط (LDR-1/LDR-2): دائرة مرتفعة بتدرج #06B6D4→#0EA5E9. */
function SellButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tabs.sell} جديد`}
      onPress={() => router.push('/sales/new')}
      style={({ pressed }) => [s.sellWrap, pressed && s.pressed]}
    >
      <View style={s.sellCircle}>
        <Svg width={62} height={62} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="sellGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.gradientFrom} />
              <Stop offset="1" stopColor={colors.gradientTo} />
            </LinearGradient>
          </Defs>
          <Circle cx={31} cy={31} r={31} fill="url(#sellGrad)" />
        </Svg>
        <Plus size={30} color={colors.bg} strokeWidth={2.8} />
      </View>
      <Text style={s.tabLabel}>{tabs.sell}</Text>
    </Pressable>
  );
}

/** الشريط السفلي المخصص: 4 تبويبات + زر بيع وسط بارز — داكن #0F172A بحد علوي #334155. */
function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  // الترتيب المرئي: [0] الرئيسية، [1] المخزون، (زر البيع)، [2] النقدية، [3] المزيد
  const home = routes[0];
  const inv = routes[1];
  const cash = routes[2];
  const more = routes[3];
  if (home === undefined || inv === undefined || cash === undefined || more === undefined) return null;

  const navigate = (name: string) => {
    navigation.navigate(name as never);
  };

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <View style={s.row}>
        <TabButton routeName={home.name} focused={state.index === 0} onPress={() => navigate(home.name)} />
        <TabButton routeName={inv.name} focused={state.index === 1} onPress={() => navigate(inv.name)} />
        <SellButton />
        <TabButton routeName={cash.name} focused={state.index === 2} onPress={() => navigate(cash.name)} />
        <TabButton routeName={more.name} focused={state.index === 3} onPress={() => navigate(more.name)} />
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const status = useSessionStore((s) => s.status);

  // حارس الجلسة: لا تُعرض التبويبات قبل الفتح (لا وميض ولا تسريب محتوى)
  if (status !== 'unlocked') {
    return (
      <View style={s.guard}>
        <LoadingSkeleton variant="tiles" />
        <LoadingSkeleton variant="list" rows={3} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
      backBehavior="history"
    >
      <Tabs.Screen name="index" options={{ title: tabs.home }} />
      <Tabs.Screen name="inventory" options={{ title: tabs.inventory }} />
      <Tabs.Screen name="cash" options={{ title: tabs.cash }} />
      <Tabs.Screen name="more" options={{ title: tabs.more }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  guard: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
    gap: 16,
  },
  bar: {
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 60,
  },
  tabBtn: {
    flex: 1,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  sellWrap: {
    width: 76,
    height: 60,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  sellCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    elevation: 8,
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
  },
  tabLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.muted,
    includeFontPadding: false,
  },
  tabLabelActive: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
  },
  pressed: { opacity: 0.85 },
});
