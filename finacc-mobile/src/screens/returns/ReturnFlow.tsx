import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import Decimal from 'decimal.js';
import { formatMoney } from '@/utils/money';
import {
  AmountText,
  AppCard,
  BottomSheet,
  Chip,
  ErrorState,
  LoadingSkeleton,
  PrimaryButton,
  QtyStepper,
  Screen,
  SectionTitle,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import { common, invoices as t, purchases as p } from '@/i18n/ar';
import {
  createPurchaseReturn,
  createSaleReturn,
  getReturnContext,
  returnableLines,
  type ReturnableLineRow,
  type ReturnContextRow,
} from '@/domain/returns';
import { listCashboxes, type CashboxLite } from '@/domain/invoicing';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * ReturnFlow (§6.5): بيانات الأصل + القيم القابلة للإرجاع (المباع − المرتجع سابقاً)
 * + QtyStepper محدود بالأقصى + اتجاه إرجاع المبلغ (نقدي من الصندوق / خصم من الحساب)
 * + معاينة الإجمالي + حفظ ذرّي → SRN/PRN → رجوع لتفاصيل الأصل.
 * مكوّن واحد يخدم مرتجع البيع ومرتجع الشراء (kind).
 */
export function ReturnFlow({ kind, originalInvoiceId }: { kind: 'sale' | 'purchase'; originalInvoiceId: number }) {
  const isSale = kind === 'sale';
  const showToast = useToastStore((s) => s.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ReturnContextRow | null>(null);
  const [lines, setLines] = useState<ReturnableLineRow[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [direction, setDirection] = useState<'cash' | 'account'>('account');
  const [cashboxes, setCashboxes] = useState<CashboxLite[]>([]);
  const [cashboxId, setCashboxId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, ls] = await Promise.all([getReturnContext(originalInvoiceId), returnableLines(originalInvoiceId)]);
      if (c === null || c.docType !== kind) {
        setError(t.notFound);
      } else {
        setCtx(c);
        setLines(ls);
        const initial: Record<number, string> = {};
        for (const ln of ls) initial[ln.itemId] = '0';
        setQty(initial);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [originalInvoiceId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // الصناديق عند اختيار الاتجاه النقدي (بعملة الفاتورة فقط — قرار 8)
  useEffect(() => {
    if (direction !== 'cash') return;
    let alive = true;
    void (async () => {
      try {
        const boxes = await listCashboxes();
        if (!alive) return;
        setCashboxes(boxes);
      } catch {
        /* تُعرض رسالة الخطأ عند الحفظ */
      }
    })();
    return () => {
      alive = false;
    };
  }, [direction]);

  useEffect(() => {
    if (direction !== 'cash' || ctx === null || cashboxes.length === 0) return;
    const match = cashboxes.find((b) => b.currencyId === ctx.currencyId);
    setCashboxId((prev) => (prev === '' && match !== undefined ? String(match.id) : prev));
  }, [direction, cashboxes, ctx]);

  const currencyCode = ctx?.currencyCode ?? '';
  const decimals = ctx?.currencyDecimals ?? 2;

  /** معاينة الإجمالي: Σ qty × سعر البند بعد خصم البند (توزيع خصم الفاتورة يُحسم عند الحفظ) */
  const estimate = useMemo(() => {
    let sum = new Decimal(0);
    for (const ln of lines) {
      const q = new Decimal(qty[ln.itemId] ?? '0');
      if (q.lte(0)) continue;
      const gross = q.times(new Decimal(ln.unitPrice));
      const net = gross.minus(gross.times(new Decimal(ln.discountPercent)).div(100));
      sum = sum.plus(net);
    }
    return sum;
  }, [lines, qty]);

  const anySelected = lines.some((ln) => new Decimal(qty[ln.itemId] ?? '0').gt(0));

  const cashboxOptions: SelectOption[] = cashboxes
    .filter((b) => ctx === null || b.currencyId === ctx.currencyId)
    .map((b) => ({ value: String(b.id), label: b.name }));

  const onSave = async () => {
    if (ctx === null || saving) return;
    setSaveError(null);
    const payload = lines
      .filter((ln) => new Decimal(qty[ln.itemId] ?? '0').gt(0))
      .map((ln) => ({ itemId: ln.itemId, qty: qty[ln.itemId]! }));
    if (payload.length === 0) {
      setSaveError('اختر بنداً واحداً على الأقل بكمية أكبر من صفر');
      return;
    }
    if (direction === 'cash' && cashboxId === '') {
      setSaveError('اختر الصندوق الذي ' + (isSale ? 'سيُرد منه المبلغ للعميل' : 'سيستلم المبلغ من المورد'));
      return;
    }
    setSaving(true);
    try {
      const res = isSale
        ? await createSaleReturn({
            originalInvoiceId,
            lines: payload,
            direction,
            cashboxId: direction === 'cash' ? Number(cashboxId) : null,
            reason: reason.trim() === '' ? undefined : reason.trim(),
          })
        : await createPurchaseReturn({
            originalInvoiceId,
            lines: payload,
            direction,
            cashboxId: direction === 'cash' ? Number(cashboxId) : null,
            reason: reason.trim() === '' ? undefined : reason.trim(),
          });
      showToast(isSale ? t.saleReturnSaved(res.invoiceNo) : p.returnSaved(res.invoiceNo));
      router.replace(isSale ? `/sales/${originalInvoiceId}` : `/purchases/${originalInvoiceId}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : common.errorGeneral);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen title={isSale ? t.saleReturnTitle : p.returnTitle} onBack={() => router.back()}>
        <LoadingSkeleton />
      </Screen>
    );
  }

  if (error !== null || ctx === null) {
    return (
      <Screen title={isSale ? t.saleReturnTitle : p.returnTitle} onBack={() => router.back()}>
        <ErrorState message={error ?? t.notFound} onRetry={() => void load()} />
      </Screen>
    );
  }

  const partyLabel = isSale ? t.customerLabel : p.supplierLabel;

  return (
    <Screen
      title={isSale ? t.saleReturnTitle : p.returnTitle}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={common.save}
          onPress={() => void onSave()}
          loading={saving}
          disabled={!anySelected && !saving}
        />
      }
    >
      {/* بيانات الأصل */}
      <AppCard style={s.ctxCard}>
        <Text style={s.ctxFrom}>{isSale ? t.saleReturnFrom : p.returnFrom}</Text>
        <View style={s.ctxRow}>
          <View style={s.ctxMain}>
            <Text style={s.ctxNo}>{ctx.invoiceNo ?? common.statuses.draft}</Text>
            <Text style={s.ctxSub}>
              {partyLabel}: {ctx.partyName ?? (isSale ? t.cashCustomer : p.cashSupplier)} ·{' '}
              {common.formatDate(ctx.issuedAt)}
            </Text>
            <Text style={s.ctxSub}>
              {t.totalLabel}:{' '}
              <Text style={s.ctxNum}>{formatMoney(ctx.total, decimals)}</Text> {currencyCode}
            </Text>
          </View>
          <RotateCcw size={28} color={colors.accent} />
        </View>
        <View style={s.badgeRow}>
          <Chip label={isSale ? t.saleReturnRestock : p.returnExitSnapshot} />
        </View>
      </AppCard>

      {/* البنود القابلة للإرجاع */}
      <SectionTitle title={p.itemsTitle} hint={p.returnableCol} />
      <AppCard style={s.itemsCard}>
        {lines.length === 0 ? (
          <Text style={s.emptyText}>{t.notFound}</Text>
        ) : (
          lines.map((ln) => {
            const max = new Decimal(ln.returnable);
            const disabled = max.lte(0);
            return (
              <View key={ln.itemId} style={[s.lineRow, disabled && s.lineDisabled]}>
                <View style={s.lineInfo}>
                  <Text style={s.lineName} numberOfLines={1}>
                    {ln.name} {ln.isService ? <Text style={s.svcTag}>({t.serviceItem})</Text> : null}
                  </Text>
                  <Text style={s.lineSub} numberOfLines={1}>
                    {common.quantity}: {ln.qtySold} × {formatMoney(ln.unitPrice, decimals)} {currencyCode}
                    {new Decimal(ln.discountPercent).gt(0) ? ` − ${ln.discountPercent}%` : ''}
                  </Text>
                  <Text style={s.lineCap}>
                    {p.returnableCol}: {ln.returnable}
                    {new Decimal(ln.qtyReturned).gt(0) ? ` (مرتجع سابقاً: ${ln.qtyReturned})` : ''}
                  </Text>
                </View>
                <QtyStepper
                  value={qty[ln.itemId] ?? '0'}
                  onChange={(v) => setQty((prev) => ({ ...prev, [ln.itemId]: v }))}
                  max={ln.returnable}
                  disabled={disabled}
                />
              </View>
            );
          })
        )}
      </AppCard>

      {/* اتجاه إرجاع المبلغ */}
      <SectionTitle title={p.returnDirectionLabel} />
      <AppCard style={s.dirCard}>
        <View style={s.segment}>
          <SegButton
            active={direction === 'cash'}
            label={isSale ? t.saleReturnCashDir : p.returnCashDir}
            onPress={() => setDirection('cash')}
          />
          <SegButton
            active={direction === 'account'}
            label={isSale ? t.saleReturnAccountDir : p.returnAccountDir}
            onPress={() => setDirection('account')}
          />
        </View>
        {direction === 'cash' ? (
          <SelectField
            label={p.cashboxLabel}
            value={cashboxId}
            options={cashboxOptions}
            onSelect={setCashboxId}
            required
          />
        ) : (
          <Text style={s.dirHint}>
            {isSale
              ? 'سيُخفَّض دين العميل بمبلغ المرتجع على فاتورة SRN'
              : 'سيُخفَّض رصيد المورد بمبلغ المرتجع على فاتورة PRN'}
          </Text>
        )}
      </AppCard>

      {/* السبب */}
      <AppCard>
        <PrimaryButton
          label={reason.trim() === '' ? p.returnReason : `${p.returnReason}: ${reason.trim()}`}
          onPress={() => setReasonOpen(true)}
        />
      </AppCard>

      {/* معاينة + حفظ */}
      <AppCard style={s.totalCard}>
        <View style={s.totalRow}>
          <View style={s.totalTextWrap}>
            <Text style={s.totalLabel}>{p.returnEstimate}</Text>
            <Text style={s.totalHint}>{p.returnEstimateHint}</Text>
          </View>
          <AmountText
            value={estimate}
            tone="out"
            mark="sign"
            decimals={decimals}
            suffix={currencyCode}
            size={fontSizes.display}
          />
        </View>
        {saveError !== null ? <Text style={s.saveError}>{saveError}</Text> : null}
      </AppCard>

      <BottomSheet visible={reasonOpen} onClose={() => setReasonOpen(false)} title={p.returnReason}>
        <View style={s.sheetBody}>
          <TextField
            label={p.returnReason}
            value={reason}
            onChangeText={setReason}
            placeholder={p.returnReasonPlaceholder}
            multiline
          />
          <PrimaryButton label={common.done} onPress={() => setReasonOpen(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** زر شريحة (Segment) بسيط بأهداف ≥48. */
function SegButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Text
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.segBtn, active && s.segBtnActive]}>
      {label}
    </Text>
  );
}

const s = StyleSheet.create({
  ctxCard: { gap: spacing.md },
  ctxFrom: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  ctxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ctxMain: { flex: 1, gap: 2 },
  ctxNo: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  ctxSub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  ctxNum: { fontFamily: fonts.numeric, fontVariant: ['tabular-nums'] },
  badgeRow: { flexDirection: 'row' },
  itemsCard: { paddingVertical: spacing.xs },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineDisabled: { opacity: 0.45 },
  lineInfo: { flex: 1, gap: 2 },
  lineName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  svcTag: { color: colors.muted, fontSize: fontSizes.micro },
  lineSub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  lineCap: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.warning,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  dirCard: { gap: spacing.md },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: {
    flex: 1,
    minHeight: 48,
    textAlign: 'center',
    textAlignVertical: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.textSecondary,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    overflow: 'hidden',
    paddingTop: 13,
  },
  segBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
    color: colors.accent,
    fontFamily: fonts.bodyBold,
  },
  dirHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  totalCard: { gap: spacing.sm },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  totalTextWrap: { flex: 1, gap: 2 },
  totalLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  totalHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 16,
  },
  saveError: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.error,
    lineHeight: 19,
  },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
});
