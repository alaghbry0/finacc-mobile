import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import {
  EmptyState,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  Screen,
} from '@/components';
import { fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { listBelowMinStock, minStockGap, type ProductListRow } from '@/domain/inventory';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { formatMoney } from '@/utils/format';

/** شاشة تنبيهات المخزون (FR-01-12): الأصناف التي هبط رصيدها الكلي تحت حدّها الأدنى. */
export default function InventoryAlertsScreen() {
  const [rows, setRows] = useState<ProductListRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const toast = useToastStore((s) => s.show);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setRows(await listBelowMinStock());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'تعذر تحميل التنبيهات');
      setRows([]);
      toast(e instanceof Error ? e.message : 'تعذر تحميل التنبيهات');
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen title={t.alertsTitle} onBack={() => router.back()}>
      {failed !== null ? (
        <ErrorState message={failed} onRetry={load} />
      ) : rows === null ? (
        <LoadingSkeleton variant="list" rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Bell size={40} color={colors.success} />} title={t.alertsEmptyTitle} message={t.alertsEmptyMessage} />
      ) : (
        <View style={s.list}>
          {rows.map((p, i) => {
            const gap = minStockGap(p);
            return (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={p.barcode ?? t.serviceBadge}
                leading={
                  <View style={s.bell}>
                    <Bell size={18} color={colors.warning} />
                  </View>
                }
                trailing={
                  <View style={s.trailing}>
                    <Text style={s.gapText}>
                      {fill(t.shortBy, { qty: formatMoney(gap, qtyDecimals(p)) })}
                    </Text>
                    <Text style={s.qtyText}>
                      {`${t.onHandLabel} ${formatMoney(p.totalQty, qtyDecimals(p))} / ${t.minLabel} ${formatMoney(p.minStock, qtyDecimals(p))}`}
                    </Text>
                  </View>
                }
                onPress={() => router.push(`/inventory/${p.id}`)}
                last={i === rows.length - 1}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function qtyDecimals(p: ProductListRow): number {
  const hasFrac = (q: string) => dec(q).mod(1).greaterThan(0);
  return hasFrac(p.totalQty) || hasFrac(p.minStock) ? 2 : 0;
}

const s = StyleSheet.create({
  list: {
    gap: 0,
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 4,
  },
  gapText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.warning,
  },
  qtyText: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
});
