import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AlertTriangle,
  FileText,
  Printer,
  RotateCcw,
} from 'lucide-react-native';
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
  SelectField,
  StatusChip,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { CustomerPickerSheet } from '@/screens/sales/CustomerPickerSheet';
import { DailyRateSheet } from '@/screens/invoices/DailyRateSheet';
import { VoidInvoiceSheet } from '@/screens/invoices/VoidInvoiceSheet';
import { PlanFormSheet } from '@/screens/installments/PlanFormSheet';
import { common, invoices as t, installments as inst, purchases as p, sales as st } from '@/i18n/ar';
import {
  CreditLimitConfirmationRequiredError,
  getSaleInvoice,
  listCashboxes,
  convertDraftToCompleted,
  voidInvoice,
  type CashboxLite,
  type InvoiceFull,
} from '@/domain/invoicing';
import { MissingRateError } from '@/domain/currency';
import { getDb } from '@/db/client';
import { useToastStore } from '@/store/toast';
import { dec, money } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface LinkedReturnRow {
  id: number;
  invoiceNo: string | null;
  issuedAt: string;
  total: string;
  status: string;
}

/** تفاصيل فاتورة البيع (أو مرتجع بيع مفتوح من نفس المسار): رأس + بنود بالتكلفة والربح + إجماليات + مرتجعات مرتبطة + إجراءات. */
export default function SaleInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number(Array.isArray(id) ? id[0] : id);
  const showToast = useToastStore((s) => s.show);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InvoiceFull | null>(null);
  const [returns, setReturns] = useState<LinkedReturnRow[]>([]);

  const [printOpen, setPrintOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  // حالة التحويل (مسودة → مكتملة)
  const [payType, setPayType] = useState<'cash' | 'credit' | 'mixed'>('cash');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [customerSheet, setCustomerSheet] = useState(false);
  const [cashPart, setCashPart] = useState('');
  const [cashboxes, setCashboxes] = useState<CashboxLite[]>([]);
  const [cashboxId, setCashboxId] = useState<string>('');
  const [convertBusy, setConvertBusy] = useState(false);

  // حواجز الحفظ أثناء التحويل
  const [rateSheet, setRateSheet] = useState<{ currencyId: number; date: string } | null>(null);
  const [creditConfirm, setCreditConfirm] = useState<string | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const full = await getSaleInvoice(invoiceId);
      if (full === null) {
        setData(null);
        setError(t.notFound);
      } else {
        setData(full);
        setCustomerId(full.invoice.customerId);
        setCustomerName(full.customerName);
        // المرتجعات المرتبطة — استعلام محلي (getSaleInvoice لا يشملها)
        const db = await getDb();
        const rows = await db.all<{ id: number; invoice_no: string | null; issued_at: string; total: string | number; status: string }>(
          "SELECT id, invoice_no, issued_at, total, status FROM invoice " +
            "WHERE original_invoice_id = ? AND doc_type = 'sale_return' ORDER BY issued_at DESC, id DESC",
          [invoiceId],
        );
        setReturns(
          rows.map((r) => ({
            id: Number(r.id),
            invoiceNo: r.invoice_no,
            issuedAt: r.issued_at,
            total: money(r.total),
            status: r.status,
          })),
        );
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

  // صناديق للتحويل المختلط/النقدي (بعملة الفاتورة — قرار 8)
  useEffect(() => {
    if (!convertOpen || data === null) return;
    let alive = true;
    void (async () => {
      try {
        const boxes = await listCashboxes();
        if (!alive) return;
        setCashboxes(boxes);
        const match = boxes.find((b) => b.currencyId === data.invoice.currencyId);
        setCashboxId((prev) => {
          if (prev !== '') return prev;
          if (data.invoice.cashboxId !== null) return String(data.invoice.cashboxId);
          return match !== undefined ? String(match.id) : '';
        });
      } catch {
        /* تُعرض رسالة الخطأ عند التحويل */
      }
    })();
    return () => {
      alive = false;
    };
  }, [convertOpen, data]);

  // ---- التحويل (FR-02-18): اختيار الدفع ثم convertDraftToCompleted ----
  const runConvert = useCallback(
    async (flags?: { creditLimitConfirmed?: boolean }) => {
      if (data === null) return;
      if ((payType === 'credit' || payType === 'mixed') && customerId === null) {
        showToast(t.convertNeedsCustomer);
        setCustomerSheet(true);
        return;
      }
      if (payType === 'mixed' && dec(cashPart === '' ? '0' : cashPart).lessThanOrEqualTo(0)) {
        showToast(t.convertNeedsCashPart);
        return;
      }
      if ((payType === 'cash' || payType === 'mixed') && cashboxId === '') {
        showToast(t.convertNeedsCashbox);
        return;
      }
      setConvertBusy(true);
      try {
        const res = await convertDraftToCompleted(invoiceId, {
          payType,
          cashPart: payType === 'mixed' ? cashPart : undefined,
          customerId,
          cashboxId: payType === 'credit' ? null : Number(cashboxId),
          creditLimitConfirmed: flags?.creditLimitConfirmed,
        });
        setConvertOpen(false);
        showToast(t.convertSuccess(res.invoiceNo ?? ''));
        await load();
      } catch (e) {
        if (e instanceof MissingRateError) {
          setRateSheet({ currencyId: e.currencyId, date: e.date });
          retryRef.current = () => runConvert(flags);
          return;
        }
        if (e instanceof CreditLimitConfirmationRequiredError) {
          setCreditConfirm(e.message);
          return;
        }
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      } finally {
        setConvertBusy(false);
      }
    },
    [data, payType, customerId, cashPart, cashboxId, invoiceId, load, showToast],
  );

  // ---- الإلغاء (FR-02-15) ----
  const doVoid = useCallback(
    async (reason: string) => {
      setVoidBusy(true);
      try {
        await voidInvoice(invoiceId, { managerConfirmed: true, reason });
        setVoidOpen(false);
        showToast(t.voidSuccess);
        await load();
      } catch (e) {
        // رسالة الخطأ تُعرض كما هي (مثل وجود مرتجعات مكتملة)
        showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
      } finally {
        setVoidBusy(false);
      }
    },
    [invoiceId, load, showToast],
  );

  if (loading) {
    return (
      <Screen title={st.newTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton rows={3} />
      </Screen>
    );
  }

  if (error !== null || data === null) {
    return (
      <Screen title={st.newTitle} onBack={() => router.back()}>
        <ErrorState message={error ?? t.notFound} onRetry={() => void load()} />
      </Screen>
    );
  }

  const inv = data.invoice;
  const isReturnDoc = inv.docType === 'sale_return';
  const isDraft = inv.status === 'draft';
  const isVoid = inv.status === 'void';
  const decimals = data.currencyDecimals;
  const code = data.currencyCode;
  const cashboxOptions: SelectOption[] = cashboxes
    .filter((b) => b.currencyId === inv.currencyId)
    .map((b) => ({ value: String(b.id), label: b.name }));

  return (
    <Screen
      title={isReturnDoc ? t.saleReturnTitle : st.newTitle}
      onBack={() => router.back()}
      footer={
        <View style={s.footerWrap}>
          {isDraft && !isReturnDoc ? (
            <PrimaryButton label={t.convertAction} onPress={() => setConvertOpen(true)} />
          ) : null}
          {!isVoid && !isDraft && !isReturnDoc && inv.docType === 'sale' && inv.payStatus === 'credit' && dec(inv.dueAmount).greaterThan(0) ? (
            <SecondaryButton
              label={inst.planButton}
              onPress={() => setPlanOpen(true)}
            />
          ) : null}
          {!isVoid && !isDraft && !isReturnDoc ? (
            <SecondaryButton
              label={t.saleReturnTitle}
              onPress={() => router.push(`/sales/${invoiceId}/return`)}
            />
          ) : null}
          {!isVoid && !isReturnDoc ? (
            <SecondaryButton label={t.voidTitle} onPress={() => setVoidOpen(true)} />
          ) : null}
          {isReturnDoc && inv.originalInvoiceId !== null ? (
            <SecondaryButton
              label={t.viewOriginal}
              onPress={() => router.push(`/sales/${inv.originalInvoiceId}`)}
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
            {inv.invoiceNo ?? st.draftTag}
          </Text>
          <View style={s.headChips}>
            <StatusChip
              status={inv.status === 'completed' ? 'active' : (inv.status as 'draft' | 'void')}
              label={inv.status === 'completed' ? st.statusCompleted : inv.status === 'draft' ? st.draftTag : st.voidTag}
            />
            <StatusChip status={inv.payStatus as 'cash' | 'credit' | 'mixed'} />
          </View>
        </View>
        <View style={s.metaGrid}>
          <MetaRow label={t.issueDate} value={common.formatDate(inv.issuedAt)} />
          <MetaRow label={t.customerLabel} value={data.customerName ?? t.cashCustomer} />
          <MetaRow label={st.cashboxChip} value={data.cashboxName ?? '—'} />
          <MetaRow label={t.currencyLabel} value={`${data.currencyName} (${code})`} />
          <MetaRow label={t.exchangeRateLabel} value={formatRate(inv.exchangeRate)} mono />
        </View>
        {inv.rateIsFallback ? (
          <View style={s.fallbackBadge}>
            <AlertTriangle size={14} color={colors.warning} />
            <Text style={s.fallbackBadgeText}>{t.rateFallbackBadge}</Text>
          </View>
        ) : null}
        {inv.notesPrinted !== null && inv.notesPrinted.length > 0 ? (
          <Text style={s.note}>{inv.notesPrinted}</Text>
        ) : null}
      </AppCard>

      {/* جدول البنود (تكلفة/ربح — للمدير) */}
      <SectionTitle title={t.itemsHeader} hint={t.profitNote} />
      <AppCard flush>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tableWrap}>
          <View>
            <View style={s.tableHead}>
              <Text style={[s.th, s.cName]}>{t.colProduct}</Text>
              <Text style={s.th}>{t.colQty}</Text>
              <Text style={s.th}>{t.colPrice}</Text>
              <Text style={s.th}>{t.colDiscount}</Text>
              <Text style={s.th}>{t.colTotal}</Text>
              <Text style={s.th}>{t.colCost}</Text>
              <Text style={s.th}>{t.colProfit}</Text>
            </View>
            {data.items.map((it) => {
              const profit = dec(it.lineTotal).minus(dec(it.lineCost));
              return (
                <View key={it.id} style={s.tr}>
                  <View style={[s.tdNameWrap, s.cName]}>
                    <Text style={s.tdName} numberOfLines={2}>
                      {it.productName ?? it.lineDesc ?? '—'}
                    </Text>
                    {it.productId === null ? (
                      <Text style={s.tdService}>{t.serviceItem}</Text>
                    ) : null}
                  </View>
                  <Text style={s.td}>{formatQty(it.qty)}</Text>
                  <Text style={s.td}>{shortMoney(it.unitPrice, decimals)}</Text>
                  <Text style={s.td}>
                    {dec(it.discountPercent).greaterThan(0) ? `${formatQty(it.discountPercent)}%` : '—'}
                  </Text>
                  <Text style={[s.td, s.tdStrong]}>{shortMoney(it.lineTotal, decimals)}</Text>
                  <Text style={s.td}>{shortMoney(it.lineCost, decimals)}</Text>
                  <Text style={[s.td, profit.isNegative() ? s.tdLoss : s.tdProfit]}>
                    {shortMoney(profit, decimals)}
                  </Text>
                </View>
              );
            })}
            <View style={[s.tr, s.trTotal]}>
              <Text style={[s.tdName, s.cName]}>{t.profitInvoice}</Text>
              <Text style={s.td}>{formatQty(data.items.reduce((acc, it) => acc.plus(dec(it.qty)), dec(0)).toString())}</Text>
              <Text style={s.td}>—</Text>
              <Text style={s.td}>—</Text>
              <Text style={[s.td, s.tdStrong]}>{shortMoney(inv.total, decimals)}</Text>
              <Text style={s.td}>{shortMoney(inv.costTotal, decimals)}</Text>
              <Text
                style={[
                  s.td,
                  dec(inv.total).minus(dec(inv.costTotal)).isNegative() ? s.tdLoss : s.tdProfit,
                ]}
              >
                {shortMoney(dec(inv.total).minus(dec(inv.costTotal)), decimals)}
              </Text>
            </View>
          </View>
        </ScrollView>
      </AppCard>

      {/* الإجماليات */}
      <SectionTitle title={t.totalsHeader} />
      <AppCard style={s.totalsCard}>
        <TotalRow label={t.subtotalLabel} value={inv.subtotal} decimals={decimals} />
        <TotalRow label={t.discountLabel} value={inv.discountAmount} decimals={decimals} sign="minus" />
        <TotalRow label={t.taxLabel} value={inv.taxAmount} decimals={decimals} sign="plus" />
        <View style={s.grandRow}>
          <Text style={s.grandLabel}>{t.totalLabel}</Text>
          <AmountText value={inv.total} decimals={decimals} suffix={code} size={fontSizes.display} />
        </View>
        <TotalRow label={t.paidLabel} value={inv.paidAmount} decimals={decimals} />
        <TotalRow
          label={t.dueLabel}
          value={inv.dueAmount}
          decimals={decimals}
          color={dec(inv.dueAmount).greaterThan(0) ? colors.warning : undefined}
        />
      </AppCard>

      {/* المرتجعات المرتبطة */}
      <SectionTitle title={t.linkedReturnsTitle} />
      {returns.length === 0 ? (
        <Text style={s.noReturns}>{t.noLinkedReturns}</Text>
      ) : (
        <AppCard style={s.listCard}>
          {returns.map((r, i) => (
            <ListRow
              key={r.id}
              title={r.invoiceNo ?? st.draftTag}
              subtitle={common.formatDate(r.issuedAt)}
              leading={<RotateCcw size={20} color={colors.accent} />}
              trailing={
                <View style={s.trailing}>
                  <AmountText value={r.total} decimals={decimals} suffix={code} size={fontSizes.body} />
                  <StatusChip
                    status={r.status === 'completed' ? 'active' : (r.status as 'draft' | 'void')}
                    label={r.status === 'completed' ? st.statusCompleted : r.status === 'draft' ? st.draftTag : st.voidTag}
                  />
                </View>
              }
              onPress={() => router.push(`/sales/${r.id}`)}
              last={i === returns.length - 1}
            />
          ))}
        </AppCard>
      )}

      <View style={s.bottomSpace} />

      {/* ============ الشيتات ============ */}

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

      {/* إلغاء الفاتورة */}
      <VoidInvoiceSheet
        visible={voidOpen}
        onClose={() => setVoidOpen(false)}
        docNo={inv.invoiceNo ?? st.draftTag}
        busy={voidBusy}
        onVoid={(reason) => void doVoid(reason)}
      />

      {/* تحويل المسودة إلى مكتملة */}
      <BottomSheet
        visible={convertOpen}
        onClose={() => setConvertOpen(false)}
        title={t.convertSheetTitle}
        dismissible={!convertBusy}
      >
        <View style={s.sheetBody}>
          <Text style={s.sheetMessage}>{t.convertHint}</Text>
          <View style={s.segment}>
            <SegBtn active={payType === 'cash'} label={common.statuses.cash} onPress={() => setPayType('cash')} />
            <SegBtn active={payType === 'credit'} label={common.statuses.credit} onPress={() => setPayType('credit')} />
            <SegBtn active={payType === 'mixed'} label={common.statuses.mixed} onPress={() => setPayType('mixed')} />
          </View>
          {payType !== 'cash' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.customerLabel}
              onPress={() => setCustomerSheet(true)}
              style={({ pressed }) => [s.customerRow, pressed && s.pressed]}
            >
              <Text style={s.customerRowLabel}>{t.customerLabel}</Text>
              <Text style={[s.customerRowValue, customerId === null && s.customerRowEmpty]}>
                {customerName ?? t.cashCustomer}
              </Text>
            </Pressable>
          ) : null}
          {payType !== 'credit' ? (
            <SelectField
              label={st.cashboxChip}
              value={cashboxId}
              options={cashboxOptions}
              onSelect={setCashboxId}
              required
            />
          ) : null}
          {payType === 'mixed' ? (
            <AmountPadField
              label={p.cashPartLabel}
              value={cashPart}
              onValue={setCashPart}
              suffix={code}
              required
            />
          ) : null}
          <PrimaryButton
            label={t.convertAction}
            loading={convertBusy}
            disabled={convertBusy}
            onPress={() => void runConvert()}
          />
        </View>
      </BottomSheet>

      <CustomerPickerSheet
        visible={customerSheet}
        onClose={() => setCustomerSheet(false)}
        onPick={(picked) => {
          setCustomerId(picked?.id ?? null);
          setCustomerName(picked?.name ?? null);
        }}
      />

      {/* سعر الصرف المفقود أثناء التحويل */}
      <DailyRateSheet
        visible={rateSheet !== null}
        onClose={() => setRateSheet(null)}
        currencyId={rateSheet?.currencyId ?? 0}
        date={rateSheet?.date ?? ''}
        currencyCode={code}
        onSaved={() => {
          setRateSheet(null);
          const retry = retryRef.current;
          retryRef.current = null;
          if (retry !== null) void retry();
        }}
      />

      {/* تقسيط الفاتورة الآجلة (FR-05-01) */}
      <PlanFormSheet
        visible={planOpen}
        onClose={() => setPlanOpen(false)}
        invoiceId={invoiceId}
        currencyId={inv.currencyId}
        currencyCode={code}
        currencyDecimals={decimals}
        invoiceNo={inv.invoiceNo}
        onCreated={() => {
          setPlanOpen(false);
          void load();
        }}
      />

      {/* تأكيد تجاوز حد الائتمان أثناء التحويل */}
      <BottomSheet visible={creditConfirm !== null} onClose={() => setCreditConfirm(null)} title={st.creditLimitTitle}>
        <View style={s.sheetBody}>
          <Text style={s.sheetMessage}>{creditConfirm ?? ''}</Text>
          <PrimaryButton
            label={st.continueAnyway}
            onPress={() => {
              setCreditConfirm(null);
              void runConvert({ creditLimitConfirmed: true });
            }}
          />
          <SecondaryButton label={common.cancel} onPress={() => setCreditConfirm(null)} />
        </View>
      </BottomSheet>
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
        {formatMoneySafe(value, decimals)}
      </Text>
    </View>
  );
}

function SegBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Text
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.segBtn, active && s.segBtnActive]}
    >
      {label}
    </Text>
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
function shortMoney(v: string | import('decimal.js').Decimal, decimals: number): string {
  const d = dec(typeof v === 'string' ? v : v.toString());
  return d.toFixed(decimals > 2 ? 2 : decimals).replace(/\.00$/, '');
}
function formatMoneySafe(v: string, decimals: number): string {
  return dec(v).toFixed(decimals > 2 ? 2 : decimals);
}

const s = StyleSheet.create({
  // أشرطة الحالة
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

  // رأس الفاتورة
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
  note: {
    marginTop: spacing.sm,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },

  // جدول البنود
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
  trTotal: { borderBottomWidth: 0, backgroundColor: colors.extra.accentSoft, borderRadius: radii.sm, paddingHorizontal: 6 },
  th: {
    width: 72,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  td: {
    width: 72,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
    includeFontPadding: false,
  },
  cName: { width: 150, textAlign: 'right' },
  tdNameWrap: { width: 150, gap: 1 },
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
  tdStrong: { fontWeight: '700' },
  tdProfit: { color: colors.success },
  tdLoss: { color: colors.error },

  // الإجماليات
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
  dueHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'left',
  },

  // المرتجعات
  noReturns: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    paddingVertical: spacing.md,
  },
  listCard: { paddingVertical: spacing.xs },
  trailing: { alignItems: 'flex-end', gap: 6 },
  bottomSpace: { height: spacing.lg },

  // التذييل
  footerWrap: { gap: spacing.sm },

  // الشيتات
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
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  customerRowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  customerRowValue: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  customerRowEmpty: { color: colors.muted, fontFamily: fonts.bodyMedium },
  pressed: { opacity: 0.85 },
});
