import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import Decimal from 'decimal.js';
import { CalendarClock, Check, ClipboardCheck, History } from 'lucide-react-native';
import {
  AppCard,
  BottomSheet,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  NumberPad,
  PrimaryButton,
  Screen,
  SectionTitle,
  SearchBar,
  SelectField,
  StatusChip,
} from '@/components';
import { common, fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { formatMoney, todayISO } from '@/utils/format';
import { listWarehouses } from '@/domain/inventory';
import { getBaseCurrency } from '@/domain/currency';
import {
  applyStocktake,
  listStocktakes,
  setCountedLine,
  startStocktake,
  stocktakeLines,
  type StocktakeLineRow,
  type StocktakeRow,
} from '@/domain/stocktake';
import { useToastStore } from '@/store/toast';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * شاشة الجرد الفعلي (FR-01-08 + AC-04 + §6.5 — الموجة 6-a):
 * اختيار المستودع → «بدء جرد» → قائمة الأصناف (دفتري + إدخال فعلي عبر لوحة
 * أرقام داخل BottomSheet — تحديث فوري وفروق حية بألوان وقيمة الفرق بالتكلفة)
 * → «اعتماد الجرد (N حركة)» عبر ConfirmSheet → applyStocktake → toast → رجوع
 * + سجل الجرد السابق.
 */
export default function StocktakeScreen() {
  const [state, setState] = useState<LoadState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<{ value: string; label: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [stocktakeId, setStocktakeId] = useState<number | null>(null);
  const [lines, setLines] = useState<StocktakeLineRow[]>([]);
  const [history, setHistory] = useState<StocktakeRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [decimals, setDecimals] = useState(2);
  // شيت إدخال العدّ
  const [pad, setPad] = useState<{ productId: number; name: string; bookQty: string; counted: string } | null>(null);
  const [padValue, setPadValue] = useState('');
  const toast = useToastStore((s) => s.show);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [whs, base] = await Promise.all([listWarehouses(), getBaseCurrency().catch(() => null)]);
      const opts = whs.map((w) => ({ value: String(w.id), label: w.isDefault ? `${w.name} — افتراضي` : w.name }));
      setWarehouses(opts);
      if (base !== null) setDecimals(base.decimals);
      const hist = await listStocktakes(20);
      setHistory(hist);
      setState('ready');
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const reloadLines = useCallback(async (id: number) => {
    const ls = await stocktakeLines(id);
    setLines(ls);
  }, []);

  const doStart = async () => {
    if (warehouseId === null) return;
    setBusy(true);
    try {
      const id = await startStocktake(Number(warehouseId));
      setStocktakeId(id);
      await reloadLines(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const openPad = (line: StocktakeLineRow) => {
    setPad({ productId: line.productId, name: line.name, bookQty: line.bookQty, counted: line.countedQty ?? '' });
    setPadValue(line.countedQty ?? '');
  };

  const savePad = async () => {
    if (pad === null || stocktakeId === null) return;
    const v = padValue.trim();
    if (v === '') {
      setPad(null);
      return;
    }
    setBusy(true);
    try {
      await setCountedLine(stocktakeId, pad.productId, v);
      setPad(null);
      await reloadLines(stocktakeId);
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const diffCount = lines.filter((l) => l.diffQty !== null && new Decimal(l.diffQty).greaterThan(0) === true || (l.diffQty !== null && new Decimal(l.diffQty).lessThan(0))).length;

  const doApply = async () => {
    if (stocktakeId === null) return;
    setBusy(true);
    try {
      const res = await applyStocktake(stocktakeId, {});
      const head = history.find((h) => h.id === stocktakeId);
      void head;
      const diffTotal = lines.reduce(
        (acc, l) => (l.diffQty === null ? acc : acc + new Decimal(l.diffQty).toNumber()),
        0,
      );
      setConfirmOpen(false);
      toast(
        res.adjustments > 0
          ? fill(t.stocktakeAppliedToast, { n: String(res.adjustments), diff: formatMoney(new Decimal(diffTotal), decimals) })
          : t.stocktakeNoneAppliedToast,
      );
      router.back();
    } catch (e) {
      setConfirmOpen(false);
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const filtered = query.trim() === '' ? lines : lines.filter((l) => l.name.includes(query.trim()));

  return (
    <Screen title={t.stocktakeTitle} subtitle={t.stocktakeSubtitle} scroll={false}>
      <ScrollView style={s.grow} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {state === 'loading' ? (
          <LoadingSkeleton variant="list" rows={5} />
        ) : state === 'error' ? (
          <ErrorState detail={errorDetail ?? undefined} onRetry={() => void load()} />
        ) : stocktakeId === null ? (
          <>
            {/* ===== اختيار المستودع وبدء الجرد ===== */}
            <AppCard>
              <SelectField
                label={t.stocktakePickWarehouse}
                value={warehouseId}
                options={warehouses}
                onSelect={setWarehouseId}
              />
              <PrimaryButton
                label={t.stocktakeStart}
                onPress={() => void doStart()}
                disabled={warehouseId === null || busy}
                loading={busy}
              />
            </AppCard>

            {/* ===== سجل الجرد السابق ===== */}
            <SectionTitle title={t.stocktakeHistoryTitle} icon={<History size={18} color={colors.textSecondary} />} />
            <AppCard>
              {history.length === 0 ? (
                <EmptyState title={t.stocktakeHistoryTitle} message={t.stocktakeHistoryEmpty} />
              ) : (
                history.map((h) => (
                  <View key={h.id} style={s.histRow}>
                    <View style={s.histIconWrap}>
                      <ClipboardCheck size={18} color={colors.accent} />
                    </View>
                    <View style={s.histMid}>
                      <Text style={s.histWarehouse} numberOfLines={1}>
                        {h.warehouseName}
                      </Text>
                      <Text style={s.histMeta}>
                        {fill(t.stocktakeHistoryMoves, { n: String(h.adjustments) })} • {h.countedAt.slice(0, 10)}
                      </Text>
                    </View>
                    <View style={s.histEnd}>
                      <Text
                        style={[
                          s.histDiff,
                          { color: new Decimal(h.totalDiff).isNegative() ? colors.error : colors.success },
                        ]}
                      >
                        {new Decimal(h.totalDiff).isNegative() ? '−' : '+'}
                        {formatMoney(new Decimal(h.totalDiff).abs(), 3)}
                      </Text>
                      <StatusChip label={h.status === 'completed' ? t.stocktakeCompletedChip : t.stocktakeDraftChip} status={'active' as const}
                          tone={h.status === 'completed' ? 'success' : 'warning'} />
                    </View>
                  </View>
                ))
              )}
            </AppCard>
          </>
        ) : (
          <>
            {/* ===== شريط البحث داخل الجرد ===== */}
            <SearchBar value={query} onChangeText={setQuery} placeholder={t.stocktakeSearchPlaceholder} />

            {/* ===== قائمة العدّ ===== */}
            {lines.length === 0 ? (
              <AppCard>
                <EmptyState title={t.stocktakeEmptyTitle} message={t.stocktakeEmptyMessage} />
              </AppCard>
            ) : (
              <AppCard style={s.listCard}>
                <View style={s.rowHead}>
                  <Text style={[s.rowHeadCell, s.colName]}>{t.colProductLabel}</Text>
                  <Text style={s.rowHeadCell}>{t.stocktakeBook}</Text>
                  <Text style={s.rowHeadCell}>{t.stocktakeCounted}</Text>
                  <Text style={s.rowHeadCell}>{t.stocktakeDiff}</Text>
                </View>
                {filtered.map((l) => (
                  <StocktakeRowView key={l.productId} line={l} decimals={decimals} onPress={() => openPad(l)} />
                ))}
                {filtered.length === 0 ? (
                  <Text style={s.noMatch}>{t.stocktakeSearchNoResults}</Text>
                ) : null}
                <Text style={s.countHint}>{t.stocktakeCountHint}</Text>
              </AppCard>
            )}
          </>
        )}
      </ScrollView>

      {/* ===== زر الاعتماد (شريط سفلي ثابت أثناء الجرد) ===== */}
      {stocktakeId !== null ? (
        <View style={s.footer}>
          <PrimaryButton
            label={diffCount > 0 ? fill(t.stocktakeApplyCount, { n: String(diffCount) }) : t.stocktakeApply}
            onPress={() => setConfirmOpen(true)}
            disabled={busy}
            loading={busy}
          />
        </View>
      ) : null}

      {/* ===== شيت إدخال العدّ ===== */}
      <BottomSheet visible={pad !== null} onClose={() => setPad(null)} title={pad?.name ?? ''}>
        <View style={s.padBody}>
          <View style={s.padHeadRow}>
            <View style={s.padHeadBox}>
              <Text style={s.padHeadLabel}>{t.stocktakeBook}</Text>
              <Text style={s.padHeadValue}>{pad?.bookQty ?? '0'}</Text>
            </View>
            <View style={[s.padHeadBox, s.padHeadAccent]}>
              <Text style={s.padHeadLabel}>{t.stocktakeCounted}</Text>
              <Text style={[s.padHeadValue, { color: colors.accent }]}>
                {padValue === '' ? '—' : formatMoney(new Decimal(padValue === '' ? 0 : padValue), 3)}
              </Text>
            </View>
          </View>
          {pad !== null && padValue !== '' ? (
            <Text style={[s.padDiff, { color: diffColor(pad.bookQty, padValue) }]}>
              {t.stocktakeDiff}: {diffText(pad.bookQty, padValue)}
            </Text>
          ) : null}
          <NumberPad value={padValue} onValue={setPadValue} allowDecimal={true} maxlength={12} />
          <PrimaryButton label={common.done} onPress={() => void savePad()} loading={busy} />
        </View>
      </BottomSheet>

      {/* ===== تأكيد الاعتماد ===== */}
      <ConfirmSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void doApply()}
        title={t.stocktakeApplyTitle}
        message={fill(t.stocktakeApplyMessage, { n: String(diffCount) })}
        confirmLabel={t.stocktakeApplyWord}
        busy={busy}
      />
    </Screen>
  );
}

// ============ صف صنف في الجرد ============

function diffColor(book: string, counted: string): string {
  const d = new Decimal(counted).minus(new Decimal(book));
  if (d.isZero()) return colors.textSecondary;
  return d.isNegative() ? colors.error : colors.success;
}

function diffText(book: string, counted: string): string {
  const d = new Decimal(counted).minus(new Decimal(book));
  const txt = formatMoney(d.abs(), 3);
  return `${d.isNegative() ? '−' : '+'}${txt}`;
}

function StocktakeRowView({
  line,
  decimals,
  onPress,
}: {
  line: StocktakeLineRow;
  decimals: number;
  onPress: () => void;
}) {
  const counted = line.countedQty;
  const diff = line.diffQty;
  const diffValue =
    diff === null ? null : new Decimal(diff).times(new Decimal(line.unitCost));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line.name}: ${counted ?? t.stocktakeCounted}`}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <View style={s.colName}>
        <Text style={s.rowName} numberOfLines={1}>
          {line.name}
        </Text>
        <Text style={s.rowCost}>
          {t.stocktakeDiffValue}: {formatMoney(diffValue?.abs() ?? new Decimal(0), decimals)}
          {diffValue !== null && !diffValue.isZero() ? (diffValue.isNegative() ? ' ↓' : ' ↑') : ''}
        </Text>
      </View>
      <Text style={s.rowNum}>{formatMoney(new Decimal(line.bookQty), 3)}</Text>
      <View style={s.countedCell}>
        {counted === null ? (
          <Text style={s.countedEmpty}>—</Text>
        ) : (
          <View style={s.countedFilled}>
            <Check size={12} color={colors.success} strokeWidth={3} />
            <Text style={s.rowNum}>{formatMoney(new Decimal(counted), 3)}</Text>
          </View>
        )}
      </View>
      <Text style={[s.rowNum, { color: diff === null ? colors.muted : diffColor(line.bookQty, diff) }]}>
        {diff === null ? '—' : diffText(line.bookQty, diff)}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  listCard: { padding: spacing.sm },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 6,
    marginBottom: 2,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  rowHeadCell: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  colName: { flex: 2.2, alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
    minHeight: 56,
  },
  rowPressed: { opacity: 0.8, backgroundColor: 'rgba(34, 211, 238, 0.06)' },
  rowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  rowCost: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  rowNum: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
    direction: 'ltr',
  },
  countedCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  countedEmpty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  countedFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  noMatch: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  countHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  // شيت العدّ
  padBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  padHeadRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  padHeadBox: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.extra.mutedSoft,
    borderRadius: radii.md,
    paddingVertical: 10,
  },
  padHeadAccent: { backgroundColor: colors.extra.accentSoft },
  padHeadLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  padHeadValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  padDiff: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  // السجل
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 60,
  },
  histIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.extra.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  histMid: { flex: 1, gap: 2 },
  histWarehouse: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  histMeta: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  histEnd: { alignItems: 'flex-end', gap: 4 },
  histDiff: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
});
