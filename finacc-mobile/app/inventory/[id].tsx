import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Box } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ConfirmSheet,
  DangerButton,
  ErrorState,
  EmptyState,
  ListRow,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SelectField,
  StatusChip,
  TextField,
} from '@/components';
import { common, fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import {
  adjustStock,
  archiveProduct,
  getProductFull,
  listWarehouses,
  type ProductRowFull,
  type StockMovementRow,
} from '@/domain/inventory';
import { useToastStore } from '@/store/toast';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';

function movementLabel(m: StockMovementRow): string {
  return t.movementTypes[m.movementType] ?? t.movementUnknown;
}

/** منازل العرض للكمية: صفر للأعداد الصحيحة وفعلية للكسور. */
function qtyDecimals(q: string): number {
  const i = q.indexOf('.');
  return i === -1 ? 0 : Math.min(q.length - i - 1, 4);
}

/**
 * بطاقة الصنف (§6.5): رأس + QR الباركود (FR-01-02) + أرصدة لكل مخزن (FR-01-06)
 * + أسعار لكل عملة + آخر الحركات (FR-01-07) + تعديل/أرشفة/تعديل الرصيد.
 */
export default function ProductCardScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const productId = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const [full, setFull] = useState<ProductRowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToastStore((s) => s.show);

  // حالة شيت تعديل الرصيد
  const [adjWarehouse, setAdjWarehouse] = useState<string | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<{ value: string; label: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const row = await getProductFull(productId);
      if (row === null) throw new Error(t.cardNotFound);
      setFull(row);
      const whs = await listWarehouses();
      setWarehouseOptions(whs.map((w) => ({ value: String(w.id), label: w.isDefault ? `${w.name} — افتراضي` : w.name })));
      setAdjWarehouse((prev) => prev ?? (whs.find((w) => w.isDefault) ?? whs[0])?.id?.toString() ?? null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t.cardNotFound);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const doArchive = async () => {
    setBusy(true);
    try {
      await archiveProduct(productId);
      setArchiveOpen(false);
      toast(t.archivedToast);
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const doAdjust = async () => {
    if (adjWarehouse === null || adjQty.trim() === '') {
      toast(t.adjustNewQty);
      return;
    }
    setBusy(true);
    try {
      await adjustStock({
        productId,
        warehouseId: Number(adjWarehouse),
        newQty: adjQty.trim(),
        reason: adjReason.trim() !== '' ? adjReason.trim() : undefined,
      });
      setAdjustOpen(false);
      setAdjQty('');
      setAdjReason('');
      toast(t.adjustedToast);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen onBack={() => router.back()}>
        <LoadingSkeleton variant="header" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  if (failed !== null || full === null) {
    return (
      <Screen onBack={() => router.back()}>
        <ErrorState message={failed ?? t.cardNotFoundHint} detail={failed ?? undefined} onRetry={load} />
      </Screen>
    );
  }

  const currentStock = full.stocks.find((s) => String(s.warehouseId) === adjWarehouse)?.qty;
  const currentLabel =
    currentStock !== undefined
      ? fill(t.adjustCurrent, { qty: String(Number(currentStock)) })
      : fill(t.adjustCurrent, { qty: '0' });

  return (
    <Screen onBack={() => router.back()}>
      {/* الرأس: أيقونة + اسم + باركود + شارات */}
      <View style={s.header}>
        <View style={s.avatar}>
          <Box size={34} color={colors.accent} />
        </View>
        <View style={s.headerText}>
          <Text style={s.name} numberOfLines={2}>
            {full.name}
          </Text>
          {full.barcode !== null ? (
            <Text style={s.barcode} numberOfLines={1}>
              {full.barcode}
            </Text>
          ) : null}
          <View style={s.chips}>
            {full.isService ? <StatusChip status="active" label={t.serviceBadge} /> : null}
            {full.isArchived ? <StatusChip status="archived" label={t.archivedChip} /> : null}
            {full.categoryName !== null ? (
              <StatusChip status="draft" label={full.categoryName} />
            ) : null}
            {full.unitName !== null ? <StatusChip status="draft" label={full.unitName} /> : null}
          </View>
        </View>
      </View>

      {/* QR الباركود (FR-01-02) */}
      {full.barcode !== null ? (
        <AppCard style={s.qrCard}>
          <QRCode value={full.barcode} size={120} color="#F1F5F9" backgroundColor="transparent" />
          <Text style={s.qrHint}>{t.qrHint}</Text>
        </AppCard>
      ) : null}

      {/* أرصدة المخازن (FR-01-06) */}
      {!full.isService ? (
        <AppCard style={s.sectionCard}>
          <Text style={s.sectionTitle}>{t.stocksTitle}</Text>
          <View style={s.stockGrid}>
            {full.stocks.length === 0 ? (
              <Text style={s.muted}>{t.noMovements}</Text>
            ) : (
              full.stocks.map((st) => (
                <View key={st.warehouseId} style={s.stockTile}>
                  <Text style={s.stockName} numberOfLines={1}>
                    {st.warehouseName}
                  </Text>
                  <Text style={s.stockQty}>{st.qty}</Text>
                </View>
              ))
            )}
            <View style={[s.stockTile, s.stockTileTotal]}>
              <Text style={[s.stockName, s.stockNameTotal]}>{t.totalStockLabel}</Text>
              <Text style={[s.stockQty, s.stockQtyTotal]}>{full.totalQty}</Text>
            </View>
          </View>
        </AppCard>
      ) : null}

      {/* أسعار البيع لكل عملة */}
      <AppCard style={s.sectionCard}>
        <Text style={s.sectionTitle}>{t.pricesCardTitle}</Text>
        {full.prices.length === 0 ? (
          <Text style={s.muted}>{t.noPrice}</Text>
        ) : (
          <View style={s.priceGrid}>
            {full.prices.map((p) => (
              <View key={p.currencyId} style={s.priceTile}>
                <Text style={s.priceCode}>{p.code}</Text>
                <AmountText value={p.price} size={fontSizes.body} decimals={p.decimals} />
              </View>
            ))}
          </View>
        )}
        <View style={s.costRow}>
          <Text style={s.costLabel}>{t.costPriceLabel}</Text>
          <AmountText value={full.costPrice} size={fontSizes.body} />
        </View>
      </AppCard>

      {/* آخر الحركات (FR-01-07 / مصفوفة الحالات: صنف بلا حركات) */}
      <AppCard style={s.sectionCard}>
        <Text style={s.sectionTitle}>{t.movementsTitle}</Text>
        {full.movements.length === 0 ? (
          <EmptyState title={t.noMovements} />
        ) : (
          full.movements.map((m, i) => (
            <ListRow
              key={m.id}
              title={`${movementLabel(m)} — ${common.formatDate(m.movedAt.slice(0, 10))}`}
              subtitle={[m.warehouseName, m.notes].filter(Boolean).join(' • ') || undefined}
              leading={
                <View style={[s.moveIcon, Number(m.qty) >= 0 ? s.moveIconIn : s.moveIconOut]}>
                  <Box size={16} color={Number(m.qty) >= 0 ? colors.success : colors.error} />
                </View>
              }
              trailing={
                <AmountText
                  value={m.qty}
                  tone={Number(m.qty) >= 0 ? 'in' : 'out'}
                  mark="sign"
                  decimals={qtyDecimals(m.qty)}
                  size={fontSizes.body}
                />
              }
              last={i === full.movements.length - 1}
            />
          ))
        )}
      </AppCard>

      {/* الأزرار */}
      <View style={s.actions}>
        <SecondaryButton label={t.editButton} onPress={() => router.push(`/inventory/${productId}/edit`)} style={s.actionBtn} />
        <DangerButton label={t.archiveButton} onPress={() => setArchiveOpen(true)} style={s.actionBtn} disabled={full.isArchived} />
      </View>
      {!full.isService ? (
        <PrimaryButton
          label={t.adjustStockButton}
          onPress={() => setAdjustOpen(true)}
          style={s.adjustBtn}
        />
      ) : null}

      {/* أرشفة (كلمة تأكيد — DS-27) */}
      <ConfirmSheet
        visible={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={doArchive}
        title={t.archiveTitle}
        message={fill(t.archiveMessage, { name: full.name })}
        requireText={t.archiveWord}
        confirmLabel={t.archiveButton}
        busy={busy}
      />

      {/* تعديل الرصيد (manual_adjust) */}
      <BottomSheet visible={adjustOpen} onClose={() => setAdjustOpen(false)} title={t.adjustTitle}>
        <View style={s.sheetBody}>
          <Text style={s.currentQty}>{currentLabel}</Text>
          {warehouseOptions.length > 1 ? (
            <SelectField
              label={t.openingWarehouseLabel}
              value={adjWarehouse}
              options={warehouseOptions}
              searchable={false}
              onSelect={setAdjWarehouse}
            />
          ) : null}
          <AmountPadField
            label={t.adjustNewQty}
            value={adjQty}
            onValue={setAdjQty}
          />
          <TextField
            label={t.adjustReason}
            value={adjReason}
            onChangeText={setAdjReason}
            placeholder={t.adjustReasonPlaceholder}
          />
          <PrimaryButton label={t.adjustSave} onPress={doAdjust} loading={busy} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radii.xl,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  barcode: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    direction: 'ltr',
    textAlign: 'right',
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  qrCard: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
    backgroundColor: '#0B1220',
  },
  qrHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  sectionCard: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  stockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stockTile: {
    flexGrow: 1,
    minWidth: '46%',
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  stockTileTotal: {
    backgroundColor: colors.extra.accentSoft,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  stockName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  stockNameTotal: { color: colors.accent, fontFamily: fonts.bodyBold },
  stockQty: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.title,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  stockQtyTotal: { color: colors.accent },
  priceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  priceTile: {
    flexGrow: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  priceCode: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  costLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  moveIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveIconIn: { backgroundColor: colors.extra.successSoft },
  moveIconOut: { backgroundColor: colors.extra.errorSoft },
  muted: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionBtn: { flex: 1 },
  adjustBtn: { marginTop: spacing.sm },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  currentQty: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
