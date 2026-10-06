import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Printer } from 'lucide-react-native';
import Decimal from 'decimal.js';
import {
  AppCard,
  DateField,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Screen,
  SelectField,
} from '@/components';
import { common, fill, inventory as inv, reports as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { getBaseCurrency } from '@/domain/currency';
import { listBelowMinStock, listWarehouses, searchProducts, type ProductListRow } from '@/domain/inventory';
import { profitLoss, type ProfitLossReport } from '@/domain/reports/profit-loss';
import { salesByCustomer, salesByProduct, salesByDay } from '@/domain/reports/sales-reports';
import { debtAging, type AgingRow } from '@/domain/reports/aging';
import { productCard, stockSummary, type StockCard, type StockSummaryRow } from '@/domain/reports/stock-card';
import { todayISO } from '@/utils/format';
import { printReport, type PrintReportPayload } from '@/services/doc-print';
import { useToastStore } from '@/store/toast';

// ============ أنواع النتائج الموحدة ============

type CustomerRow = { name: string; sales: string; returns: string; net: string; invoices: number };
type ProductSalesRow = { name: string; qtySold: string; sales: string; returns: string };
type DayRow = { date: string; sales: string; net: string };

interface ViewerData {
  pl?: ProfitLossReport;
  customers?: { rows: CustomerRow[]; total: string };
  productsSales?: { rows: ProductSalesRow[]; total: string };
  days?: { rows: DayRow[]; prevPeriodSales: string; changePct: string | null };
  card?: StockCard;
  summary?: StockSummaryRow[];
  aging?: AgingRow[];
  minStock?: ProductListRow[];
}

type LoadState = 'loading' | 'ready' | 'error';

// ============ تجهيز التقرير للطباعة (FR-10-09) ============

/** يحوّل نتائج أي تقرير إلى حمولة طباعة جدولية موحّدة — null إن لا بيانات. */
function buildPrintPayload(
  reportId: string,
  title: string,
  data: ViewerData | null,
  fmt: (v: string) => string,
  dateFrom: string,
  dateTo: string,
): PrintReportPayload | null {
  if (data === null) return null;
  const period = { periodFrom: dateFrom, periodTo: dateTo };
  if (reportId === 'profit-loss' && data.pl !== undefined) {
    const pl = data.pl;
    const num = (v: string, places = 4): string => fmt(new Decimal(v).toFixed(places));
    return {
      ...period,
      title,
      columns: [t.colItem, t.colValue],
      rows: [
        [t.plSales, fmt(pl.sales)],
        [t.plSalesReturns, fmt(pl.salesReturns)],
        [t.plNetSales, num(new Decimal(pl.sales).minus(new Decimal(pl.salesReturns)).toFixed(4))],
        [t.plCogs, fmt(pl.cogs)],
        [t.plCogsReturned, fmt(pl.cogsReturned)],
        [t.plNetCogs, num(new Decimal(pl.cogs).minus(new Decimal(pl.cogsReturned)).toFixed(4))],
        [t.plStocktakeGains, fmt(pl.stocktakeGains)],
        [t.plStocktakeLosses, fmt(pl.stocktakeLosses)],
        [
          t.plFx,
          `${new Decimal(pl.fxGainLoss).isNegative() ? '−' : '+'}${fmt(new Decimal(pl.fxGainLoss).abs().toFixed(4))}`,
        ],
        [t.plGrossProfit, fmt(pl.grossProfit)],
        [t.plExpenses, fmt(pl.expenses)],
        ...pl.expensesByCategory.map((c): string[] => [`— ${c.name}`, fmt(c.amount)]),
        [t.plNetProfit, fmt(pl.netProfit)],
        [t.plOwnerDraws, fmt(pl.ownerDraws)],
      ],
      totalRow: [t.plNetForOwner, fmt(pl.netForOwner)],
      note: t.plFormulaNote,
    };
  }
  if (reportId === 'sales-by-customer' && data.customers !== undefined) {
    const { rows, total } = data.customers;
    return {
      ...period,
      title,
      columns: [t.colCustomer, t.colSales, t.colReturns, t.colNet, t.colInvoices],
      rows: rows.map((r): string[] => [r.name, fmt(r.sales), fmt(r.returns), fmt(r.net), String(r.invoices)]),
      totalRow: [t.colTotal, '', '', fmt(total), ''],
    };
  }
  if (reportId === 'sales-by-product' && data.productsSales !== undefined) {
    const { rows, total } = data.productsSales;
    return {
      ...period,
      title,
      columns: [t.colProduct, t.colQtySold, t.colSales, t.colReturns],
      rows: rows.map((r): string[] => [r.name, r.qtySold, fmt(r.sales), fmt(r.returns)]),
      totalRow: [t.colTotal, '', fmt(total), ''],
    };
  }
  if (reportId === 'sales-by-day' && data.days !== undefined) {
    const { rows, prevPeriodSales, changePct } = data.days;
    return {
      ...period,
      title,
      columns: [t.colDate, t.colSales, t.colNet],
      rows: rows.map((r): string[] => [r.date, fmt(r.sales), fmt(r.net)]),
      note:
        `${t.prevPeriodLabel}: ${fmt(prevPeriodSales)} — ${t.changePctLabel}: ` +
        (changePct === null ? t.noPrevPeriod : `${new Decimal(changePct).isNegative() ? '−' : '+'}${new Decimal(changePct).abs().toFixed(1)}%`),
    };
  }
  if (reportId === 'product-card' && data.card !== undefined) {
    const card = data.card;
    return {
      ...period,
      title,
      columns: [t.colDate, t.colType, t.colRefNo, t.colIn, t.colOut, t.colBalance, t.colUnitCost],
      rows: card.lines.map(
        (l): string[] => [
          l.date,
          typeLabel(l.type),
          l.refNo ?? '',
          l.in !== '0' ? l.in : '',
          l.out !== '0' ? l.out : '',
          l.balance,
          l.unitCost,
        ],
      ),
      totalRow: [t.colClosing, '', '', '', '', card.closing, ''],
      note: `${t.colOpening}: ${card.opening} — ${t.colClosing}: ${card.closing}`,
    };
  }
  if (reportId === 'stock-summary' && data.summary !== undefined) {
    return {
      ...period,
      title,
      columns: [t.colProduct, t.colOpening, t.colIn, t.colOut, t.colReturns, t.colAdjust, t.colClosing],
      rows: data.summary.map(
        (r): string[] => [r.name, r.opening, r.in, r.out, r.returns, r.adjust, r.closing],
      ),
    };
  }
  if (reportId === 'aging' && data.aging !== undefined) {
    return {
      ...period,
      title,
      columns: [t.colCustomer, t.colCurrency, t.colCurrent, t.colD30, t.colD60, t.colD90, t.colTotal],
      rows: data.aging.map(
        (r): string[] => [r.customer, r.currencyCode, fmt(r.current), fmt(r.d30), fmt(r.d60), fmt(r.d90), fmt(r.total)],
      ),
      note: t.agingByInvoice,
    };
  }
  if (reportId === 'min-stock' && data.minStock !== undefined) {
    return {
      title,
      columns: [t.colProduct, t.colOnHand, t.colMin, t.colShortBy],
      rows: data.minStock.map(
        (r): string[] => [
          r.name,
          r.totalQty,
          r.minStock,
          new Decimal(r.minStock).minus(new Decimal(r.totalQty)).toFixed(2),
        ],
      ),
    };
  }
  return null;
}

const REPORT_TITLES: Record<string, string> = {
  'profit-loss': t.plTitle,
  'sales-by-customer': t.byCustomerTitle,
  'sales-by-product': t.byProductTitle,
  'sales-by-day': t.byDayTitle,
  'product-card': t.productCardTitle,
  'stock-summary': t.stockSummaryTitle,
  aging: t.agingTitle,
  'min-stock': t.minStockTitle,
};

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * العارض العام للتقارير (FR-09 — الموجة 6-a): فلترة فترة (من/إلى + جاهزة)
 * + جدول نتائج حسب reportId (بنود تسمية لقائمة الأرباح بألوان ±) + Skeleton
 * (DS-32) + EmptyState + زر طباعة معطّل بتلميح «توصلها الموجة 6-ب».
 */
export default function ReportViewerScreen() {
  const params = useLocalSearchParams<{ reportId: string; productId?: string }>();
  const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const title = REPORT_TITLES[reportId ?? ''] ?? t.galleryTitle;
  const needsPeriod = reportId !== 'min-stock';
  const needsProduct = reportId === 'product-card';

  const today = todayISO();
  const [dateFrom, setDateFrom] = useState(monthStart(today));
  const [dateTo, setDateTo] = useState(today);
  const [productId, setProductId] = useState<string | null>(
    params.productId !== undefined ? String(params.productId) : null,
  );
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<{ value: string; label: string }[]>([]);
  const [data, setData] = useState<ViewerData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [decimals, setDecimals] = useState(2);
  const [baseCode, setBaseCode] = useState('');
  const [printing, setPrinting] = useState(false);
  const showToast = useToastStore((st) => st.show);

  // خيارات الأصناف والمخازن (لبطاقة الصنف)
  useEffect(() => {
    if (!needsProduct) return;
    void (async () => {
      try {
        const [prods, whs] = await Promise.all([searchProducts('', { limit: 300 }), listWarehouses()]);
        setProductOptions(prods.map((p) => ({ value: String(p.id), label: p.name })));
        setWarehouseOptions([{ value: '', label: t.allWarehouses }, ...whs.map((w) => ({ value: String(w.id), label: w.name }))]);
        if (params.productId === undefined && prods.length > 0) setProductId(String(prods[0]!.id));
      } catch {
        /* القوائم تُعاد محاولتها عند التشغيل */
      }
    })();
  }, [needsProduct, params.productId]);

  const run = useCallback(async () => {
    setState('loading');
    setErrorDetail(null);
    try {
      const base = await getBaseCurrency();
      setDecimals(base.decimals);
      setBaseCode(base.code);
      const out: ViewerData = {};
      if (reportId === 'profit-loss') {
        out.pl = await profitLoss({ dateFrom, dateTo });
      } else if (reportId === 'sales-by-customer') {
        out.customers = await salesByCustomer({ dateFrom, dateTo });
      } else if (reportId === 'sales-by-product') {
        out.productsSales = await salesByProduct({ dateFrom, dateTo });
      } else if (reportId === 'sales-by-day') {
        out.days = await salesByDay({ dateFrom, dateTo });
      } else if (reportId === 'product-card') {
        if (productId === null) {
          setState('ready');
          setData({});
          return;
        }
        out.card = await productCard(Number(productId), {
          dateFrom: dateFrom.length > 0 ? dateFrom : undefined,
          dateTo: dateTo.length > 0 ? dateTo : undefined,
          warehouseId: warehouseId !== null && warehouseId !== '' ? Number(warehouseId) : undefined,
        });
      } else if (reportId === 'stock-summary') {
        out.summary = (await stockSummary({ dateFrom, dateTo })).rows;
      } else if (reportId === 'aging') {
        out.aging = await debtAging({ dateTo });
      } else if (reportId === 'min-stock') {
        out.minStock = await listBelowMinStock();
      }
      setData(out);
      setState('ready');
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, [reportId, dateFrom, dateTo, productId, warehouseId]);

  useEffect(() => {
    void run();
  }, [run]);

  const fmt = (v: string): string => {
    const d = new Decimal(v);
    const fixed = d.toFixed(decimals);
    const [int, frac] = fixed.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac !== undefined ? `${grouped}.${frac}` : grouped;
  };

  const quickRanges = useMemo(
    () => [
      { label: t.quickToday, from: today, to: today },
      { label: t.quickThisWeek, from: shiftDay(today, -6), to: today },
      { label: t.quickThisMonth, from: monthStart(today), to: today },
      {
        label: t.quickLastMonth,
        from: monthStart(shiftMonth(today, -1)),
        to: shiftDay(monthStart(today), -1),
      },
      { label: t.quickAll, from: '2000-01-01', to: today },
    ],
    [today],
  );

  const doPrint = useCallback(async (): Promise<void> => {
    const payload = buildPrintPayload(reportId ?? '', title, data, fmt, dateFrom, dateTo);
    if (payload === null) {
      showToast(t.reportEmptyTitle);
      return;
    }
    setPrinting(true);
    try {
      await printReport(payload);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setPrinting(false);
    }
  }, [reportId, title, data, fmt, dateFrom, dateTo, showToast]);

  return (
    <Screen title={title} onBack={() => router.back()} scroll={false}>
      <ScrollView style={s.grow} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* ===== الفلاتر ===== */}
        <AppCard style={s.filtersCard}>
          {needsProduct ? (
            <>
              <SelectField
                label={t.pickProduct}
                value={productId}
                options={productOptions}
                onSelect={(v) => setProductId(v)}
                hint={t.pickProductHint}
              />
              <SelectField
                label={t.pickWarehouse}
                value={warehouseId ?? ''}
                options={warehouseOptions}
                onSelect={(v) => setWarehouseId(v)}
              />
            </>
          ) : null}
          {needsPeriod ? (
            <>
              <View style={s.datesRow}>
                <View style={s.dateField}>
                  <DateField label={t.fromLabel} value={dateFrom} onChange={(v) => setDateFrom(v)} />
                </View>
                <View style={s.dateField}>
                  <DateField label={t.toLabel} value={dateTo} onChange={(v) => setDateTo(v)} />
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                {quickRanges.map((q) => (
                  <Pressable
                    key={q.label}
                    accessibilityRole="button"
                    accessibilityLabel={q.label}
                    onPress={() => {
                      setDateFrom(q.from);
                      setDateTo(q.to);
                    }}
                    style={[s.chip, dateFrom === q.from && dateTo === q.to && s.chipActive]}
                  >
                    <Text style={[s.chipText, dateFrom === q.from && dateTo === q.to && s.chipTextActive]}>{q.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {reportId === 'aging' ? (
                <Text style={s.note}>{fill(t.currencyNote, { code: baseCode })} — {t.agingByInvoice}</Text>
              ) : null}
            </>
          ) : null}
        </AppCard>

        {/* ===== النتائج ===== */}
        {state === 'loading' ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : state === 'error' ? (
          <ErrorState detail={errorDetail ?? undefined} onRetry={() => void run()} />
        ) : (
          <Results reportId={reportId ?? ''} data={data} fmt={fmt} decimals={decimals} />
        )}

        {/* ===== زر الطباعة (FR-10-09) ===== */}
        <View style={s.printWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.printLabel}
            disabled={printing || data === null}
            onPress={() => void doPrint()}
            style={[s.printBtn, (printing || data === null) && s.printBtnDisabled]}
          >
            <Printer size={18} color={colors.accent} />
            <Text style={s.printLabel}>{t.printLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ============ النتائج حسب نوع التقرير ============

function Results({
  reportId,
  data,
  fmt,
  decimals,
}: {
  reportId: string;
  data: ViewerData | null;
  fmt: (v: string) => string;
  decimals: number;
}) {
  if (data === null) return null;

  if (reportId === 'profit-loss' && data.pl !== undefined) {
    return <PlView pl={data.pl} fmt={fmt} />;
  }
  if (reportId === 'sales-by-customer' && data.customers !== undefined) {
    const { rows, total } = data.customers;
    if (rows.length === 0) return <ReportEmpty />;
    return (
      <AppCard>
        <Table
          columns={[
            { label: t.colCustomer, flex: 2, align: 'start' },
            { label: t.colSales, flex: 1.2 },
            { label: t.colReturns, flex: 1.2 },
            { label: t.colNet, flex: 1.2 },
            { label: t.colInvoices, flex: 0.8 },
          ]}
          rows={rows.map((r) => [
            { text: r.name, align: 'start' as const },
            { text: fmt(r.sales) },
            { text: fmt(r.returns) },
            { text: fmt(r.net) },
            { text: String(r.invoices) },
          ])}
          footer={[{ text: t.colTotal, align: 'start' as const, strong: true }, { text: fmt(total), strong: true }, { text: '' }, { text: '' }, { text: '' }]}
        />
      </AppCard>
    );
  }
  if (reportId === 'sales-by-product' && data.productsSales !== undefined) {
    const { rows, total } = data.productsSales;
    if (rows.length === 0) return <ReportEmpty />;
    return (
      <AppCard>
        <Table
          columns={[
            { label: t.colProduct, flex: 2, align: 'start' },
            { label: t.colQtySold, flex: 1 },
            { label: t.colSales, flex: 1.3 },
            { label: t.colReturns, flex: 1.3 },
          ]}
          rows={rows.map((r) => [
            { text: r.name, align: 'start' as const },
            { text: r.qtySold },
            { text: fmt(r.sales) },
            { text: fmt(r.returns) },
          ])}
          footer={[{ text: t.colTotal, align: 'start' as const, strong: true }, { text: '' }, { text: fmt(total), strong: true }, { text: '' }]}
        />
      </AppCard>
    );
  }
  if (reportId === 'sales-by-day' && data.days !== undefined) {
    const { rows, prevPeriodSales, changePct } = data.days;
    if (rows.length === 0) return <ReportEmpty />;
    return (
      <>
        <AppCard>
          <View style={s.compareRow}>
            <View style={s.compareBox}>
              <Text style={s.compareLabel}>{t.prevPeriodLabel}</Text>
              <Text style={s.compareValue}>{fmt(prevPeriodSales)}</Text>
            </View>
            <View style={s.compareBox}>
              <Text style={s.compareLabel}>{t.changePctLabel}</Text>
              {changePct === null ? (
                <Text style={s.compareMuted}>{t.noPrevPeriod}</Text>
              ) : (
                <Text style={[s.compareValue, { color: new Decimal(changePct).isNegative() ? colors.error : colors.success }]}>
                  {new Decimal(changePct).greaterThanOrEqualTo(0) ? '+' : '−'}
                  {fmt(new Decimal(changePct).abs().toFixed(1))}
                </Text>
              )}
            </View>
          </View>
        </AppCard>
        <AppCard>
          <Table
            columns={[
              { label: t.colDate, flex: 1, align: 'start' },
              { label: t.colSales, flex: 1.4 },
              { label: t.colNet, flex: 1.4 },
            ]}
            rows={rows.map((r) => [
              { text: r.date, align: 'start' as const },
              { text: fmt(r.sales) },
              { text: fmt(r.net) },
            ])}
          />
        </AppCard>
      </>
    );
  }
  if (reportId === 'product-card' && data.card !== undefined) {
    const card = data.card;
    return (
      <AppCard>
        <View style={s.cardHeadRow}>
          <HeadValue label={t.colOpening} value={card.opening} />
          <HeadValue label={t.colClosing} value={card.closing} />
        </View>
        {card.lines.length === 0 ? (
          <EmptyState title={t.reportEmptyTitle} message={t.reportEmptyMessage} />
        ) : (
          <Table
            columns={[
              { label: t.colDate, flex: 1, align: 'start' },
              { label: t.colType, flex: 1.1, align: 'start' },
              { label: t.colIn, flex: 0.8 },
              { label: t.colOut, flex: 0.8 },
              { label: t.colBalance, flex: 0.9 },
              { label: t.colUnitCost, flex: 1 },
            ]}
            rows={card.lines.map((l) => [
              { text: l.date, align: 'start' as const },
              { text: typeLabel(l.type), align: 'start' as const },
              { text: l.in !== '0' ? l.in : '', tone: 'in' as const },
              { text: l.out !== '0' ? l.out : '', tone: 'out' as const },
              { text: l.balance, strong: true },
              { text: l.unitCost },
            ])}
          />
        )}
      </AppCard>
    );
  }
  if (reportId === 'stock-summary' && data.summary !== undefined) {
    const rows = data.summary;
    if (rows.length === 0) return <ReportEmpty />;
    return (
      <AppCard>
        <Table
          columns={[
            { label: t.colProduct, flex: 2, align: 'start' },
            { label: t.colOpening, flex: 1 },
            { label: t.colIn, flex: 1 },
            { label: t.colOut, flex: 1 },
            { label: t.colReturns, flex: 1 },
            { label: t.colAdjust, flex: 1 },
            { label: t.colClosing, flex: 1 },
          ]}
          rows={rows.map((r) => [
            { text: r.name, align: 'start' as const },
            { text: r.opening },
            { text: r.in, tone: 'in' as const },
            { text: r.out, tone: 'out' as const },
            { text: r.returns, tone: 'in' as const },
            { text: r.adjust, tone: new Decimal(r.adjust).isNegative() ? ('out' as const) : ('in' as const) },
            { text: r.closing, strong: true },
          ])}
        />
      </AppCard>
    );
  }
  if (reportId === 'aging' && data.aging !== undefined) {
    if (data.aging.length === 0) return <ReportEmpty />;
    return (
      <AppCard>
        <Table
          columns={[
            { label: t.colCustomer, flex: 1.8, align: 'start' },
            { label: t.colCurrency, flex: 0.9, align: 'start' },
            { label: t.colCurrent, flex: 1.1 },
            { label: t.colD30, flex: 1.1 },
            { label: t.colD60, flex: 1.1 },
            { label: t.colD90, flex: 1.1 },
            { label: t.colTotal, flex: 1.2 },
          ]}
          rows={data.aging.map((r) => [
            { text: r.customer, align: 'start' as const },
            { text: r.currencyCode, align: 'start' as const },
            { text: fmt(r.current) },
            { text: fmt(r.d30) },
            { text: fmt(r.d60) },
            { text: fmt(r.d90) },
            { text: fmt(r.total), strong: true },
          ])}
        />
      </AppCard>
    );
  }
  if (reportId === 'min-stock' && data.minStock !== undefined) {
    if (data.minStock.length === 0) {
      return <ReportEmpty title={t.reportEmptyTitle} message={t.minStockDesc} />;
    }
    return (
      <AppCard>
        <Table
          columns={[
            { label: t.colProduct, flex: 2.4, align: 'start' },
            { label: t.colOnHand, flex: 1 },
            { label: t.colMin, flex: 1 },
            { label: t.colShortBy, flex: 1 },
          ]}
          rows={data.minStock.map((r) => [
            { text: r.name, align: 'start' as const },
            { text: r.totalQty },
            { text: r.minStock },
            { text: new Decimal(r.minStock).minus(new Decimal(r.totalQty)).toFixed(decimals), tone: 'out' as const },
          ])}
        />
      </AppCard>
    );
  }
  return <ReportEmpty />;
}

function typeLabel(type: string): string {
  return inv.movementTypes[type] ?? type;
}

// ============ قائمة الأرباح (قرار 7) ============

function PlView({ pl, fmt }: { pl: ProfitLossReport; fmt: (v: string) => string }) {
  const negative = (v: string) => new Decimal(v).isNegative();
  return (
    <>
      <AppCard>
        <PlLine label={t.plSales} value={fmt(pl.sales)} tone="in" />
        <PlLine label={t.plSalesReturns} value={fmt(pl.salesReturns)} tone="out" />
        <PlLine label={t.plNetSales} value={fmt(new Decimal(pl.sales).minus(new Decimal(pl.salesReturns)).toFixed(4))} strong />
        <PlLine label={t.plCogs} value={fmt(pl.cogs)} tone="out" />
        <PlLine label={t.plCogsReturned} value={fmt(pl.cogsReturned)} tone="in" />
        <PlLine label={t.plNetCogs} value={fmt(new Decimal(pl.cogs).minus(new Decimal(pl.cogsReturned)).toFixed(4))} strong />
        <PlLine label={t.plStocktakeGains} value={fmt(pl.stocktakeGains)} tone="in" />
        <PlLine label={t.plStocktakeLosses} value={fmt(pl.stocktakeLosses)} tone="out" />
        <PlLine
          label={t.plFx}
          value={`${negative(pl.fxGainLoss) ? '−' : '+'}${fmt(new Decimal(pl.fxGainLoss).abs().toFixed(4))}`}
          tone={negative(pl.fxGainLoss) ? 'out' : 'in'}
        />
        <PlLine label={t.plGrossProfit} value={fmt(pl.grossProfit)} strong color={negative(pl.grossProfit) ? colors.error : colors.success} />
        <PlLine label={t.plExpenses} value={fmt(pl.expenses)} tone="out" />
        <PlLine label={t.plNetProfit} value={fmt(pl.netProfit)} strong color={negative(pl.netProfit) ? colors.error : colors.success} />
        <PlLine label={t.plOwnerDraws} value={fmt(pl.ownerDraws)} tone="out" />
      </AppCard>

      {/* صافي ما بقي للمالك — بارز أخضر/أحمر */}
      <AppCard style={s.ownerCard}>
        <Text style={s.ownerLabel}>{t.plNetForOwner}</Text>
        <Text
          style={[
            s.ownerValue,
            { color: negative(pl.netForOwner) ? colors.error : colors.success },
          ]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {negative(pl.netForOwner) ? '−' : ''}
          {fmt(new Decimal(pl.netForOwner).abs().toFixed(4))} {pl.currencyCode}
        </Text>
        <Text style={s.ownerHint}>{t.plNetForOwnerHint}</Text>
      </AppCard>

      {/* تفصيل المصاريف بالفئات */}
      {pl.expensesByCategory.length > 0 ? (
        <AppCard>
          <Text style={s.sectionLabel}>{t.plExpensesByCategory}</Text>
          {pl.expensesByCategory.map((c, i) => (
            <View key={`${c.name}-${i}`} style={[s.catRow, i === pl.expensesByCategory.length - 1 && s.catRowLast]}>
              <Text style={s.catName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={s.catValue}>{fmt(c.amount)}</Text>
            </View>
          ))}
        </AppCard>
      ) : null}

      <Text style={s.formulaNote}>{t.plFormulaNote}</Text>
    </>
  );
}

function PlLine({
  label,
  value,
  tone = 'neutral',
  strong = false,
  color,
}: {
  label: string;
  value: string;
  tone?: 'in' | 'out' | 'neutral';
  strong?: boolean;
  color?: string;
}) {
  const c = color ?? (tone === 'in' ? colors.success : tone === 'out' ? colors.error : colors.textPrimary);
  return (
    <View style={s.plLine}>
      <Text style={[s.plLabel, strong && s.plLabelStrong]} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[
          s.plValue,
          { color: c },
          strong && s.plValueStrong,
          tone !== 'neutral' && { fontFamily: fonts.numeric },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ============ جدول بسيط (View rows — بلا مكتبات) ============

interface ColDef {
  label: string;
  flex: number;
  align?: 'start' | 'end';
}

interface Cell {
  text: string;
  align?: 'start' | 'end';
  tone?: 'in' | 'out';
  strong?: boolean;
}

function Table({ columns, rows, footer }: { columns: ColDef[]; rows: Cell[][]; footer?: (Cell | undefined)[] }) {
  return (
    <View>
      <View style={s.tHead}>
        {columns.map((c, i) => (
          <Text key={i} style={[s.tHeadCell, { flex: c.flex }]} numberOfLines={1}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.tRow, ri % 2 === 1 && s.tRowAlt]}>
          {r.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                s.tCell,
                { flex: columns[ci]?.flex ?? 1 },
                (cell.align ?? columns[ci]?.align) !== 'start' && s.tCellNumeric,
                cell.tone === 'in' && { color: colors.success },
                cell.tone === 'out' && { color: colors.error },
                cell.strong && s.tCellStrong,
              ]}
              numberOfLines={1}
            >
              {cell.text}
            </Text>
          ))}
        </View>
      ))}
      {footer !== undefined ? (
        <View style={s.tFoot}>
          {footer.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                s.tFootCell,
                { flex: columns[ci]?.flex ?? 1 },
                (cell?.align ?? columns[ci]?.align) !== 'start' && s.tCellNumeric,
              ]}
              numberOfLines={1}
            >
              {cell?.text ?? ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ============ مساعدات عرض ============

function HeadValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.headBox}>
      <Text style={s.headLabel}>{label}</Text>
      <Text style={s.headValue}>{value}</Text>
    </View>
  );
}

function ReportEmpty({ title, message }: { title?: string; message?: string }) {
  return (
    <AppCard>
      <EmptyState title={title ?? t.reportEmptyTitle} message={message ?? t.reportEmptyMessage} />
    </AppCard>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  filtersCard: { gap: spacing.md },
  datesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dateField: { flex: 1 },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.extra.accentSoft, borderColor: colors.accent },
  chipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  chipTextActive: { color: colors.accent },
  note: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  printWrap: { gap: 6, alignItems: 'center' },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.card,
  },
  printBtnDisabled: {
    borderColor: colors.border,
    opacity: 0.55,
  },
  printLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.accent,
  },
  // قائمة الأرباح
  plLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  plLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  plLabelStrong: { color: colors.textPrimary, fontFamily: fonts.bodyBold },
  plValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  plValueStrong: { fontSize: fontSizes.title, fontWeight: '700' },
  ownerCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderWidth: 1.5,
  },
  ownerLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  ownerValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 30,
    fontWeight: '700',
  },
  ownerHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 40,
  },
  catRowLast: { borderBottomWidth: 0 },
  catName: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  catValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  formulaNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  compareRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  compareBox: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  compareLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  compareValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  compareMuted: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  cardHeadRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.extra.accentSoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  headLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  headValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '700',
    color: colors.accent,
  },
  // الجدول
  tHead: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  tHeadCell: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 36,
    alignItems: 'center',
  },
  tRowAlt: { backgroundColor: 'rgba(51, 65, 85, 0.25)' },
  tCell: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  tCellNumeric: {
    direction: 'ltr',
  },
  tCellStrong: { fontWeight: '700' },
  tFoot: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
    minHeight: 40,
    alignItems: 'center',
  },
  tFootCell: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
});
