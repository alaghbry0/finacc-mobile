import { ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { Filter } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  DateField,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Screen,
  SecondaryButton,
  SectionTitle,
  SelectField,
  type SelectOption,
} from '@/components';
import { common, statement as t } from '@/i18n/ar';
import { customerStatement, supplierStatement, type StatementLine, type StatementResult } from '@/domain/statements';
import { getBaseCurrency, listActiveCurrencies, type CurrencyRow } from '@/domain/currency';
import { dec } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface StatementViewProps {
  kind: 'customer' | 'supplier';
  partyId: number;
}

/** نص نوع المستند. */
function docTypeLabel(dt: StatementLine['docType']): string {
  switch (dt) {
    case 'sale':
      return t.docSale;
    case 'sale_return':
      return t.docSaleReturn;
    case 'receipt':
      return t.docReceipt;
    case 'purchase':
      return t.docPurchase;
    case 'purchase_return':
      return t.docPurchaseReturn;
    case 'payment':
      return t.docPayment;
    case 'cheque':
      return t.docCheque;
    default:
      return dt;
  }
}

/** نقطة لون حسب نوع المستند (شكل + لون معاً — لا اعتماد على اللون وحده). */
function docTypeDot(dt: StatementLine['docType']): string {
  switch (dt) {
    case 'sale':
    case 'purchase':
      return colors.warning;
    case 'sale_return':
    case 'purchase_return':
      return colors.accent;
    default:
      return colors.success;
  }
}

function openDoc(line: StatementLine): void {
  if (line.refScreen === undefined || line.refId === undefined) return;
  if (line.refScreen === 'sales') router.push(`/sales/${line.refId}`);
  else if (line.refScreen === 'purchases') router.push(`/purchases/${line.refId}`);
  else if (line.refScreen === 'cheque') router.push(`/cash/cheques/${line.refId}`);
  else if (line.refScreen === 'cash') router.push('/cash');
}

/**
 * كشف حساب الطرف (FR-03-04 + AC-18): فترة اختيارية + عملة الكشف + رصيد
 * افتتاحي/ختامي + أسطر بترصيد متحرك. مشترك للعميل والمورّد (غلافان رفيعان).
 */
export function StatementView({ kind, partyId }: StatementViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StatementResult | null>(null);

  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [currencyId, setCurrencyId] = useState('');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(
    async (curId: string, from: string, to: string) => {
      if (curId === '') return;
      setLoading(true);
      setError(null);
      try {
        const opts = {
          currencyId: Number(curId),
          dateFrom: from.length > 0 ? from : undefined,
          dateTo: to.length > 0 ? to : undefined,
        };
        setData(kind === 'customer' ? await customerStatement(partyId, opts) : await supplierStatement(partyId, opts));
      } catch (e) {
        setError(e instanceof Error ? e.message : common.errorGeneral);
      } finally {
        setLoading(false);
      }
    },
    [kind, partyId],
  );

  // العملات (الأساس افتراضياً)
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [list, base] = await Promise.all([listActiveCurrencies(), getBaseCurrency()]);
        if (!alive) return;
        setCurrencies(list);
        setCurrencyId(String(base.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : common.errorGeneral);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (currencyId !== '') void load(currencyId, dateFrom, dateTo);
  }, [currencyId, dateFrom, dateTo, load]);

  const currencyOptions: SelectOption[] = currencies.map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));

  const hasPeriod = dateFrom.length > 0 || dateTo.length > 0;
  const closingNegative = data !== null ? dec(data.closing).isNegative() : false;
  const title = kind === 'customer' ? t.titleCustomer : t.titleSupplier;

  return (
    <Screen title={title} subtitle={data?.partyName} onBack={() => router.back()}>
      {/* العملة + الفترة */}
      <SelectField
        label={t.currencyLabel}
        value={currencyId}
        options={currencyOptions}
        onSelect={setCurrencyId}
        hint={t.currencyHint}
        required
      />
      <View style={s.filterHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.filterSection}
          onPress={() => setFiltersOpen((v) => !v)}
          style={({ pressed }) => [s.filterBtn, pressed && s.pressed]}
        >
          <Filter size={16} color={hasPeriod ? colors.accent : colors.textSecondary} />
          <Text style={[s.filterText, hasPeriod && s.filterTextActive]}>{t.filterSection}</Text>
        </Pressable>
        {hasPeriod ? (
          <SecondaryButton
            label={t.clearFilters}
            onPress={() => {
              setDateFrom('');
              setDateTo('');
            }}
            height={40}
          />
        ) : null}
      </View>
      {filtersOpen ? (
        <View style={s.periodRow}>
          <DateField
            label={t.fromLabel}
            value={dateFrom}
            onChange={(v) => setDateFrom(v === dateFrom ? '' : v)}
          />
          <DateField
            label={t.toLabel}
            value={dateTo}
            onChange={(v) => setDateTo(v === dateTo ? '' : v)}
          />
        </View>
      ) : null}

      {loading && data === null ? (
        <>
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="list" rows={5} />
        </>
      ) : error !== null ? (
        <ErrorState message={error} onRetry={() => void load(currencyId, dateFrom, dateTo)} />
      ) : data === null ? (
        <EmptyState title={t.notFound} />
      ) : (
        <>
          {/* الأرصدة */}
          <View style={s.balanceRow}>
            <View style={s.balanceCard}>
              <Text style={s.balanceLabel}>{t.openingLabel}</Text>
              <AmountText
                value={data.opening}
                decimals={2}
                tone="neutral"
                mark="none"
                size={fontSizes.body}
                suffix={data.currencyCode}
              />
            </View>
            <View style={s.balanceCard}>
              <Text style={s.balanceLabel}>{t.closingLabel}</Text>
              <AmountText
                value={data.closing}
                decimals={2}
                tone="neutral"
                mark="none"
                size={fontSizes.body}
                color={closingNegative ? colors.error : colors.success}
                suffix={data.currencyCode}
              />
            </View>
          </View>

          {data.hasOtherCurrencyEvents ? (
            <View style={s.otherNote}>
              <Text style={s.otherNoteText}>{t.otherCurrencyNote}</Text>
            </View>
          ) : null}

          {/* الأسطر */}
          <SectionTitle title={`${t.linesCount.replace('{n}', String(data.lines.length))} · ${data.currencyCode}`} />
          {data.lines.length === 0 ? (
            <EmptyState title={t.emptyTitle} message={t.emptyMessage} />
          ) : (
            <AppCard flush style={s.tableCard}>
              <View style={s.tableHead}>
                <Text style={[s.th, s.colDoc]}>{t.colDoc}</Text>
                <Text style={s.th}>{t.colDebit}</Text>
                <Text style={s.th}>{t.colCredit}</Text>
                <Text style={s.th}>{t.colBalance}</Text>
              </View>
              {data.lines.map((line, i) => (
                <Pressable
                  key={`${line.docNo}-${line.refId ?? 0}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${line.docNo} — ${docTypeLabel(line.docType)}`}
                  onPress={() => openDoc(line)}
                  style={({ pressed }) => [s.tr, pressed && s.pressed]}
                >
                  <View style={[s.docCell, s.colDoc]}>
                    <View style={s.docTop}>
                      <View style={[s.docDot, { backgroundColor: docTypeDot(line.docType) }]} />
                      <Text style={s.docNo} numberOfLines={1}>
                        {line.docNo}
                      </Text>
                    </View>
                    <Text style={s.docType}>
                      {docTypeLabel(line.docType)} · {line.date}
                    </Text>
                  </View>
                  <Text style={[s.td, s.tdMono, hasValue(line.debit) ? s.tdDebit : s.tdMuted]}>
                    {hasValue(line.debit) ? line.debit : '—'}
                  </Text>
                  <Text style={[s.td, s.tdMono, hasValue(line.credit) ? s.tdCredit : s.tdMuted]}>
                    {hasValue(line.credit) ? line.credit : '—'}
                  </Text>
                  <AmountText
                    value={line.balance}
                    decimals={2}
                    tone="neutral"
                    mark="none"
                    size={fontSizes.caption}
                    color={dec(line.balance).isNegative() ? colors.error : colors.textPrimary}
                  />
                </Pressable>
              ))}
            </AppCard>
          )}

          {/* تصدير — الموجة 6 */}
          <View style={s.exportWrap}>
            <SecondaryButton label={t.exportPdf} disabled onPress={() => undefined} style={s.exportBtn} />
            <Text style={s.exportHint}>{t.exportPdfHint}</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function hasValue(v: string): boolean {
  return dec(v).greaterThan(0);
}

const s = StyleSheet.create({
  filterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  filterText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  filterTextActive: { color: colors.accent, fontFamily: fonts.bodyBold },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },

  balanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
    alignItems: 'center',
  },
  balanceLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  otherNote: {
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  otherNoteText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    lineHeight: 19,
  },

  tableCard: { paddingHorizontal: spacing.md },
  tableHead: {
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  th: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  colDoc: { flex: 1.8, alignItems: 'stretch' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
  },
  docCell: { gap: 2 },
  docTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  docDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  docNo: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.accent,
    direction: 'ltr',
    textAlign: 'right',
  },
  docType: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  td: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tdMono: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  tdDebit: { color: colors.warning },
  tdCredit: { color: colors.success },
  tdMuted: { color: colors.muted },
  pressed: { opacity: 0.8 },

  exportWrap: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  exportBtn: { alignSelf: 'stretch' },
  exportHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
  },
});
