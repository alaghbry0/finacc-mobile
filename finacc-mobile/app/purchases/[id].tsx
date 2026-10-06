import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, FileText, Printer, RotateCcw } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  StatusChip,
} from '@/components';
import { VoidInvoiceSheet } from '@/screens/invoices/VoidInvoiceSheet';
import { common, invoices as t, purchases as p } from '@/i18n/ar';
import { getPurchaseInvoice, voidPurchaseInvoice, type PurchaseInvoiceFull } from '@/domain/purchasing';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * تفاصيل فاتورة الشراء (مرآة مبسطة لتفاصيل البيع — Task 4-c):
 * المورد بدل العميل + عمود «تكلفة الوحدة بعد التوزيع» (WAC) بدل الربح +
 * مرتجعات مرتبطة + إلغاء عبر voidPurchaseInvoice.
 */
export default function PurchaseInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number(Array.isArray(id) ? id[0] : id);
  const showToast = useToastStore((s) => s.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PurchaseInvoiceFull | null>(null);

  const [printOpen, setPrintOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const full = await getPurchaseInvoice(invoiceId);
      if (full === null) {
        setData(null);
        setError(t.notFound);
      } else {
        setData(full);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doVoid = useCallback(
    async (reason: string) => {
      setVoidBusy(true);
      try {
        await voidPurchaseInvoice(invoiceId, { managerConfirmed: true, reason });
        setVoidOpen(false);
        showToast(p.voidSuccess);
        await load();
      } catch (e) {
        // رسالة الخطأ تُعرض كما هي (مرتجعات مكتملة / رصيد غير كافٍ للعكس)
        showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
      } finally {
        setVoidBusy(false);
      }
    },
    [invoiceId, load, showToast],
  );

  if (loading) {
    return (
      <Screen title={p.detailsTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton rows={3} />
      </Screen>
    );
  }

  if (error !== null || data === null) {
    return (
      <Screen title={p.detailsTitle} onBack={() => router.back()}>
        <ErrorState message={error ?? t.notFound} onRetry={() => void load()} />
      </Screen>
    );
  }

  const isReturnDoc = data.docType === 'purchase_return';
  const isDraft = data.status === 'draft';
  const isVoid = data.status === 'void';
  const decimals = data.currencyDecimals;
  const code = data.currencyCode;
  const title = isReturnDoc ? p.returnDocTitle : p.detailsTitle;

  return (
    <Screen
      title={title}
      onBack={() => router.back()}
      footer={
        <View style={s.footerWrap}>
          {!isVoid && !isDraft && !isReturnDoc ? (
            <SecondaryButton
              label={p.returnAction}
              onPress={() => router.push(`/purchases/${invoiceId}/return`)}
            />
          ) : null}
          {!isVoid && !isDraft && !isReturnDoc ? (
            <SecondaryButton label={p.voidAction} onPress={() => setVoidOpen(true)} />
          ) : null}
          {isReturnDoc && data.originalInvoiceId !== null ? (
            <SecondaryButton
              label={t.viewOriginal}
              onPress={() => router.push(`/purchases/${data.originalInvoiceId}`)}
            />
          ) : null}
          <SecondaryButton label={t.printAction} onPress={() => setPrintOpen(true)} />
        </View>
      }
    >
      {/* أشرطة الحالة */}
      {isVoid ? (
        <View style={s.voidBanner}>
          <AlertTriangle size={20} color={colors.error} />
          <Text style={s.voidBannerText}>{t.voidBanner}</Text>
        </View>
      ) : null}
      {isDraft ? (
        <View style={s.draftBanner}>
          <FileText size={20} color={colors.warning} />
          <Text style={s.draftBannerText}>{t.draftBanner}</Text>
        </View>
      ) : null}

      {/* رأس الفاتورة */}
      <AppCard>
        <View style={s.headRow}>
          <Text style={s.docNo} numberOfLines={1} adjustsFontSizeToFit>
            {data.invoiceNo ?? p.noNumber}
          </Text>
          <View style={s.headChips}>
            <StatusChip
              status={data.status === 'completed' ? 'active' : (data.status as 'draft' | 'void')}
              label={
                data.status === 'completed'
                  ? p.filterCompleted
                  : data.status === 'draft'
                    ? p.filterDraft
                    : p.filterVoid
              }
            />
            <StatusChip status={data.payStatus as 'cash' | 'credit' | 'mixed'} />
          </View>
        </View>
        <View style={s.metaGrid}>
          <MetaRow label={t.issueDate} value={common.formatDate(data.issuedAt)} />
          <MetaRow label={p.supplierLabel} value={data.supplierName ?? p.cashSupplier} />
          <MetaRow label={p.cashboxLabel} value={data.cashboxName ?? '—'} />
          <MetaRow label={p.warehouse} value={data.warehouseName ?? '—'} />
          <MetaRow
            label={t.currencyLabel}
            value={`${data.currencyCode}${data.rateIsFallback ? '' : ` · ${t.exchangeRateLabel} ${formatRate(data.exchangeRate)}`}`}
          />
        </View>
        {data.rateIsFallback ? (
          <View style={s.fallbackBadge}>
            <AlertTriangle size={14} color={colors.warning} />
            <Text style={s.fallbackBadgeText}>{t.rateFallbackBadge}</Text>
          </View>
        ) : null}
        {isReturnDoc ? (
          <Text style={s.originalNote}>
            {p.originalInvoice}: {data.originalInvoiceNo ?? '—'}
          </Text>
        ) : null}
        {data.notesInternal !== null && data.notesInternal.length > 0 ? (
          <Text style={s.note}>{data.notesInternal}</Text>
        ) : null}
      </AppCard>

      {/* جدول البنود — تكلفة الوحدة بعد توزيع خصم الفاتورة (WAC) */}
      <SectionTitle title={t.itemsHeader} hint={p.costNote} />
      <AppCard flush>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tableWrap}>
          <View>
            <View style={s.tableHead}>
              <Text style={[s.th, s.cName]}>{t.colProduct}</Text>
              <Text style={s.th}>{t.colQty}</Text>
              <Text style={s.th}>{p.purchasePrice}</Text>
              <Text style={s.th}>{t.colDiscount}</Text>
              <Text style={s.th}>{t.colTotal}</Text>
              <Text style={s.th}>{p.unitCostCol}</Text>
            </View>
            {data.items.map((it) => (
              <View key={it.id} style={s.tr}>
                <View style={[s.tdNameWrap, s.cName]}>
                  <Text style={s.tdName} numberOfLines={2}>
                    {it.name}
                  </Text>
                  {it.isService ? <Text style={s.tdService}>{t.serviceItem}</Text> : null}
                  {!it.isService && it.barcode !== null ? (
                    <Text style={s.tdBarcode} numberOfLines={1}>
                      {it.barcode}
                    </Text>
                  ) : null}
                </View>
                <Text style={s.td}>{formatQty(it.qty)}</Text>
                <Text style={s.td}>{shortMoney(it.unitPrice, decimals)}</Text>
                <Text style={s.td}>
                  {dec(it.discountPercent).greaterThan(0) ? `${formatQty(it.discountPercent)}%` : '—'}
                </Text>
                <Text style={[s.td, s.tdStrong]}>{shortMoney(it.lineTotal, decimals)}</Text>
                <Text style={[s.td, s.tdCost]}>{shortMoney(it.unitCost, decimals)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </AppCard>

      {/* الإجماليات */}
      <SectionTitle title={t.totalsHeader} />
      <AppCard style={s.totalsCard}>
        <TotalRow label={t.subtotalLabel} value={data.subtotal} decimals={decimals} />
        <TotalRow label={t.discountLabel} value={data.discountAmount} decimals={decimals} sign="minus" />
        <TotalRow label={t.taxLabel} value={data.taxAmount} decimals={decimals} sign="plus" />
        <View style={s.grandRow}>
          <Text style={s.grandLabel}>{t.totalLabel}</Text>
          <AmountText value={data.total} decimals={decimals} suffix={code} size={fontSizes.display} />
        </View>
        <TotalRow label={t.paidLabel} value={data.paidAmount} decimals={decimals} />
        <TotalRow
          label={p.dueOnSupplier}
          value={data.dueAmount}
          decimals={decimals}
          color={dec(data.dueAmount).greaterThan(0) ? colors.warning : undefined}
        />
      </AppCard>

      {/* المرتجعات المرتبطة */}
      <SectionTitle title={p.linkedReturns} />
      {data.returns.length === 0 ? (
        <Text style={s.noReturns}>{p.noLinkedReturns}</Text>
      ) : (
        <AppCard style={s.listCard}>
          {data.returns.map((r, i) => (
            <ListRow
              key={r.id}
              title={r.invoiceNo ?? p.noNumber}
              subtitle={common.formatDate(r.issuedAt)}
              leading={<RotateCcw size={20} color={colors.accent} />}
              trailing={
                <View style={s.trailing}>
                  <AmountText value={r.total} decimals={decimals} suffix={code} size={fontSizes.body} />
                  <StatusChip
                    status={r.status === 'completed' ? 'active' : (r.status as 'draft' | 'void')}
                    label={
                      r.status === 'completed'
                        ? p.filterCompleted
                        : r.status === 'draft'
                          ? p.filterDraft
                          : p.filterVoid
                    }
                  />
                </View>
              }
              onPress={() => router.push(`/purchases/${r.id}`)}
              last={i === data.returns.length - 1}
            />
          ))}
        </AppCard>
      )}

      <View style={s.bottomSpace} />

      {/* الطباعة/المشاركة — قوالب الموجة 6 */}
      <BottomSheet visible={printOpen} onClose={() => setPrintOpen(false)} title={t.printSheetTitle}>
        <View style={s.sheetBody}>
          <View style={s.printIcon}>
            <Printer size={38} color={colors.muted} />
          </View>
          <Text style={s.sheetMessage}>{t.printComingSoon}</Text>
          <PrimaryButton label={t.printAction} disabled onPress={() => undefined} />
          <SecondaryButton label={common.close} onPress={() => setPrintOpen(false)} />
        </View>
      </BottomSheet>

      {/* إلغاء فاتورة الشراء */}
      <VoidInvoiceSheet
        visible={voidOpen}
        onClose={() => setVoidOpen(false)}
        docNo={data.invoiceNo ?? p.noNumber}
        busy={voidBusy}
        onVoid={(reason) => void doVoid(reason)}
      />
    </Screen>
  );
}

// ============ مكونات محلية ============

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={[s.metaValue, mono === true && s.metaValueMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  decimals,
  sign,
  color,
}: {
  label: string;
  value: string;
  decimals: number;
  sign?: 'minus' | 'plus';
  color?: string;
}) {
  return (
    <View style={s.totalRow}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text
        style={[
          s.totalValue,
          sign === 'minus' && { color: colors.warning },
          sign === 'plus' && { color: colors.success },
          color !== undefined && { color },
        ]}
      >
        {sign === 'minus' ? '− ' : sign === 'plus' ? '+ ' : ''}
        {dec(value).toFixed(decimals > 2 ? 2 : decimals)}
      </Text>
    </View>
  );
}

// ============ مساعدات ============

function formatRate(rate: string): string {
  const d = dec(rate);
  return d.toFixed(d.decimalPlaces() > 2 ? 4 : 2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatQty(v: string): string {
  const d = dec(v);
  return d.isInteger() ? d.toFixed(0) : d.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function shortMoney(v: string, decimals: number): string {
  return dec(v).toFixed(decimals > 2 ? 2 : decimals).replace(/\.00$/, '');
}

const s = StyleSheet.create({
  voidBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  voidBannerText: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.error,
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  draftBannerText: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.warning,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  docNo: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
    direction: 'ltr',
    textAlign: 'left',
    includeFontPadding: false,
  },
  headChips: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  metaGrid: { gap: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  metaLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  metaValue: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  metaValueMono: { fontFamily: fonts.numeric, fontVariant: ['tabular-nums'] },
  fallbackBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  fallbackBadgeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.warning,
  },
  originalNote: {
    marginTop: spacing.sm,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  note: {
    marginTop: spacing.sm,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  tableWrap: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
    gap: 8,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
  },
  th: {
    width: 74,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  td: {
    width: 74,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
    includeFontPadding: false,
  },
  cName: { width: 160, textAlign: 'right' },
  tdNameWrap: { width: 160, gap: 1 },
  tdName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  tdService: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  tdBarcode: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  tdStrong: { fontWeight: '700' },
  tdCost: { color: colors.accent },
  totalsCard: { gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  totalValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  grandLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  noReturns: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    paddingVertical: spacing.md,
  },
  listCard: { paddingVertical: spacing.xs },
  trailing: { alignItems: 'flex-end', gap: 6 },
  bottomSpace: { height: spacing.lg },
  footerWrap: { gap: spacing.sm },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  sheetMessage: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  printIcon: { alignSelf: 'center', padding: spacing.md },
});
