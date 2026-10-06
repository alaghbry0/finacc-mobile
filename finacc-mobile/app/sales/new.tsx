import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckCircle2,
  Coins,
  History,
  ListOrdered,
  Plus,
  ScanBarcode,
  ShoppingBasket,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react-native';
import {
  AmountText,
  BottomSheet,
  EmptyState,
  LoadingSkeleton,
  NumberPad,
  PrimaryButton,
  QtyStepper,
  Screen,
  ScreenHeaderAction,
  SearchBar,
  SecondaryButton,
} from '@/components';
import { CustomerPickerSheet } from '@/screens/sales/CustomerPickerSheet';
import { ExtrasSheet } from '@/screens/sales/ExtrasSheet';
import { ParkedCartsSheet } from '@/screens/sales/ParkedCartsSheet';
import { PaymentSheet } from '@/screens/sales/PaymentSheet';
import { ScanSaleSheet } from '@/screens/sales/ScanSaleSheet';
import { DailyRateSheet } from '@/screens/invoices/DailyRateSheet';
import { printInvoice } from '@/services/doc-print';
import { printing as pr } from '@/i18n/ar';
import { common, fill, sales as t } from '@/i18n/ar';
import {
  CreditLimitConfirmationRequiredError,
  StockShortageError,
  findSaleProductByBarcode,
  getSaleDefaults,
  listBestSellers,
  listCashboxes,
  saveSaleInvoice,
  searchSaleProducts,
  type CashboxLite,
  type SaleDefaults,
  type SaleProductRow,
} from '@/domain/invoicing';
import { BackdateConfirmationRequiredError } from '@/domain/fiscal';
import { MissingRateError, listActiveCurrencies, type CurrencyRow } from '@/domain/currency';
import { useCartStore, computeCartTotals, type CartItem } from '@/store/cart';
import { useToastStore } from '@/store/toast';
import { dec, money } from '@/utils/money';
import { formatMoney } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * شاشة البيع — الكاشير (§6.5 حرفياً + LDR-1):
 * شريط أهداف (عميل/صندوق/عملة) + بنود بـ QtyStepper وسعر قابل للنقر + مسح باركود
 * + تعليق/مسودة + دفع نقدي/آجل عبر PaymentSheet. كل الحسابات النهائية في الدومين —
 * الإجماليات المعروضة من computeCartTotals للمؤشر اللحظي فقط.
 */

interface SaveOpts {
  payType: 'cash' | 'credit' | 'mixed';
  cashPart?: string;
  saveAsDraft?: boolean;
  creditLimitConfirmed?: boolean;
  managerConfirmedBackdate?: boolean;
}

type SimpleSheet = 'customer' | 'cashbox' | 'currency' | 'parked' | null;

export default function NewSaleScreen() {
  const showToast = useToastStore((s) => s.show);

  // ---- سلة المخزن (zustand) ----
  const ready = useCartStore((s) => s.ready);
  const restored = useCartStore((s) => s.restored);
  const items = useCartStore((s) => s.items);
  const party = useCartStore((s) => s.party);
  const cashboxName = useCartStore((s) => s.cashboxName);
  const currencyId = useCartStore((s) => s.currencyId);
  const parked = useCartStore((s) => s.parked);
  const issuedAt = useCartStore((s) => s.issuedAt);
  const invoiceDiscount = useCartStore((s) => s.invoiceDiscount);
  const notesInternal = useCartStore((s) => s.notesInternal);
  const notesPrinted = useCartStore((s) => s.notesPrinted);
  const taxMode = useCartStore((s) => s.taxMode);
  const taxRate = useCartStore((s) => s.taxRate);

  // ---- ثوابت الشاشة (عملات/صناديق/إعدادات) ----
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [cashboxes, setCashboxes] = useState<CashboxLite[]>([]);
  const [defaults, setDefaults] = useState<SaleDefaults | null>(null);

  // ---- الشيتات ----
  const [simpleSheet, setSimpleSheet] = useState<SimpleSheet>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [paymentTotal, setPaymentTotal] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState<{ key: string; name: string; value: string } | null>(null);
  const [overAvail, setOverAvail] = useState<{ key: string; name: string; requested: string; available: string } | null>(null);
  const [rateSheet, setRateSheet] = useState<{ currencyId: number; date: string } | null>(null);
  const [shortage, setShortage] = useState<StockShortageError | null>(null);
  const [creditConfirm, setCreditConfirm] = useState<{ message: string; opts: SaveOpts } | null>(null);
  const [backdateConfirm, setBackdateConfirm] = useState<{ message: string; opts: SaveOpts } | null>(null);
  const [success, setSuccess] = useState<{ id: number; no: string | null } | null>(null);

  const [saving, setSaving] = useState(false);
  const [pendingCredit, setPendingCredit] = useState(false);
  const pendingRetryRef = useRef<(() => Promise<void>) | null>(null);

  // ---- بحث شيت الأصناف ----
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<SaleProductRow[]>([]);

  const currency = useMemo(
    () => currencies.find((c) => Number(c.id) === currencyId) ?? null,
    [currencies, currencyId],
  );
  const currencyCode = currency?.code ?? '';
  const currencyDecimals = currency === null ? 2 : Number(currency.decimals ?? 2);

  const totals = useMemo(
    () => computeCartTotals(items, invoiceDiscount, taxMode, taxRate),
    [items, invoiceDiscount, taxMode, taxRate],
  );

  // ---- التهيئة: مسودة + معلّقات + افتراضيات (getStore عبر getSaleDefaults داخل المخزن) ----
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await useCartStore.getState().init();
        const [curs, boxes, defs] = await Promise.all([
          listActiveCurrencies(),
          listCashboxes(),
          getSaleDefaults(),
        ]);
        if (!alive) return;
        setCurrencies(curs);
        setCashboxes(boxes);
        setDefaults(defs);
      } catch (e) {
        if (alive) showToast(e instanceof Error ? e.message : common.errorGeneral);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showToast]);

  // ---- بحث فوري debounce 200ms (searchSaleProducts/الأكثر مبيعاً) ----
  useEffect(() => {
    if (!itemPickerOpen || currencyId === null) return;
    let alive = true;
    const handle = setTimeout(
      () =>
        void (async () => {
          try {
            const res =
              pickerQuery.trim() === ''
                ? await listBestSellers(currencyId)
                : await searchSaleProducts(pickerQuery, currencyId);
            if (alive) setPickerResults(res);
          } catch {
            /* تبقى النتائج السابقة */
          }
        })(),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [itemPickerOpen, pickerQuery, currencyId]);

  // ---- حذف بتراجع (FeedbackBar DS-37) ----
  const removeWithUndo = useCallback(
    (item: CartItem) => {
      const removed = useCartStore.getState().removeItem(item.key);
      if (removed !== null) {
        showToast(fill(t.lineRemoved, { name: removed.name }), {
          undo: { run: () => useCartStore.getState().undoRemove(removed) },
        });
      }
    },
    [showToast],
  );

  // ---- تعديل الكمية (تجاوز المتاح FR-02-02) ----
  const changeQty = useCallback(
    (item: CartItem, next: string) => {
      const nextD = dec(next === '' ? '0' : next);
      if (nextD.lessThanOrEqualTo(0)) {
        removeWithUndo(item);
        return;
      }
      const store = useCartStore.getState();
      if (
        item.available !== null &&
        !item.isService &&
        nextD.greaterThan(dec(item.available))
      ) {
        if (defaults?.overAvailPolicy === 'add_available') {
          store.setQty(item.key, item.available);
          return;
        }
        setOverAvail({
          key: item.key,
          name: item.name,
          requested: money(nextD),
          available: item.available,
        });
        return;
      }
      store.setQty(item.key, money(nextD));
    },
    [defaults?.overAvailPolicy, removeWithUndo],
  );

  // ---- إضافة صنف (من الشبكة أو المسح) ----
  const addProduct = useCallback(
    async (product: SaleProductRow, opts?: { closePicker?: boolean; closeScan?: boolean }) => {
      if (currencyId === null) return;
      await useCartStore.getState().addItem(product, '1');
      // أغلق الشيتات دائماً بعد الإضافة (المسح المتتابع يمرر closeScan:false)
      if (opts?.closeScan === true) setScanOpen(false);
      if (opts?.closePicker !== false) setItemPickerOpen(false);
      const hasPrice = product.price !== null && dec(product.price).greaterThan(0);
      if (!hasPrice) {
        // بلا سعر بعملة الفاتورة → افتح محرر السعر فوراً + تحذير (سلوك §6.5)
        const st = useCartStore.getState();
        const it = st.items.find((x) => x.productId === product.id);
        if (it !== undefined) setPriceEdit({ key: it.key, name: product.name, value: '' });
        showToast(t.noPriceAddedWarn);
      }
    },
    [currencyId],
  );

  // ---- مسح باركود (يبقى الشيت مفتوحاً للمسح المتتابع) ----
  const onScanFound = useCallback(
    async (barcode: string) => {
      if (currencyId === null) return;
      try {
        const product = await findSaleProductByBarcode(barcode, currencyId);
        if (product === null) {
          showToast(t.scanNotFound);
          return;
        }
        await addProduct(product, { closeScan: true });
      } catch (e) {
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      }
    },
    [currencyId, addProduct, showToast],
  );

  // ---- تقليم كمية صنف إلى المتاح (زر «إضافة كموجود») ----
  const clampProductToAvailable = useCallback((productName: string, available: string) => {
    const st = useCartStore.getState();
    let remaining = dec(available);
    for (const it of st.items.filter((x) => x.name === productName)) {
      const q = dec(it.qty);
      const allowed = q.lessThan(remaining) ? q : remaining;
      remaining = remaining.minus(allowed);
      if (allowed.greaterThan(0)) {
        useCartStore.getState().setQty(it.key, money(allowed));
      } else {
        useCartStore.getState().removeItem(it.key);
      }
    }
  }, []);

  // ---- الحفظ (كل الحسابات في الدومين) ----
  const performSave = useCallback(
    async (opts: SaveOpts): Promise<void> => {
      const st = useCartStore.getState();
      if (st.items.length === 0) {
        showToast(t.saveAbortedEmpty);
        return;
      }
      if (st.warehouseId === null || st.currencyId === null) {
        showToast(common.errorGeneral);
        return;
      }
      setSaving(true);
      try {
        const res = await saveSaleInvoice({
          items: st.items.map((it) => ({
            productId: it.productId,
            lineDesc: it.lineDesc,
            qty: it.qty,
            unitPrice: it.unitPrice === '' ? '0' : it.unitPrice,
            discountPercent: it.discountPercent,
          })),
          payType: opts.payType,
          cashPart: opts.cashPart,
          customerId: st.party?.id ?? null,
          cashboxId: opts.saveAsDraft === true ? null : opts.payType === 'credit' ? null : st.cashboxId,
          warehouseId: st.warehouseId,
          currencyId: st.currencyId,
          invoiceDiscount: st.invoiceDiscount,
          notesInternal: st.notesInternal.trim() === '' ? undefined : st.notesInternal.trim(),
          notesPrinted: st.notesPrinted.trim() === '' ? undefined : st.notesPrinted.trim(),
          issuedAt: st.issuedAt,
          saveAsDraft: opts.saveAsDraft === true,
          managerConfirmedBackdate: opts.managerConfirmedBackdate,
          creditLimitConfirmed: opts.creditLimitConfirmed,
        });

        if (opts.saveAsDraft === true) {
          useCartStore.getState().clear();
          setExtrasOpen(false);
          showToast(t.draftDone);
          return;
        }

        // نجاح الفاتورة المكتملة: تفريغ + toast + طباعة عند الحفظ (FR-02-14) + بطاقة النجاح
        setPaymentTotal(null);
        useCartStore.getState().clear();
        showToast(fill(t.savedToast, { no: res.invoiceNo ?? String(res.invoiceId) }));
        setSuccess({ id: res.invoiceId, no: res.invoiceNo });
        // invoicing.print_on_save = 'print' → تُفتح الطباعة تلقائياً فور الحفظ
        if (defaults?.printOnSave === 'print') {
          void printInvoice('sale', res.invoiceId).catch((err: unknown) => {
            showToast(err instanceof Error ? err.message : pr.printFailed, { duration: 7000 });
          });
        }
      } catch (e) {
        if (e instanceof MissingRateError) {
          setRateSheet({ currencyId: e.currencyId, date: e.date });
          pendingRetryRef.current = () => performSave({ ...opts });
          return;
        }
        if (e instanceof StockShortageError) {
          setShortage(e);
          return;
        }
        if (e instanceof CreditLimitConfirmationRequiredError) {
          setCreditConfirm({ message: e.message, opts });
          return;
        }
        if (e instanceof BackdateConfirmationRequiredError) {
          setBackdateConfirm({ message: e.message, opts });
          return;
        }
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      } finally {
        setSaving(false);
      }
    },
    [defaults?.printOnSave, showToast],
  );

  // ---- مداخل الحفظ ----
  const startCashSave = useCallback(() => {
    if (saving) return;
    if (items.length === 0) {
      showToast(t.saveAbortedEmpty);
      return;
    }
    if (totals === null) {
      showToast(t.saveFailed);
      return;
    }
    if (defaults?.paymentSheetOn === true) {
      setPaymentTotal(totals.total);
      return;
    }
    void performSave({ payType: 'cash' });
  }, [saving, items.length, totals, defaults?.paymentSheetOn, performSave, showToast]);

  const startCreditSave = useCallback(() => {
    if (saving) return;
    if (items.length === 0) {
      showToast(t.saveAbortedEmpty);
      return;
    }
    if (party === null) {
      setPendingCredit(true);
      setSimpleSheet('customer');
      showToast(t.creditNeedsCustomer);
      return;
    }
    void performSave({ payType: 'credit' });
  }, [saving, items.length, party, performSave, showToast]);

  const onPaymentConfirm = useCallback(
    (opts: { mode: 'cash' | 'mixed'; received: string }) => {
      if (totals === null) return;
      const totalD = dec(totals.total);
      const receivedD = dec(opts.received);
      setPaymentTotal(null);
      if (opts.mode === 'mixed') {
        // الجزء النقدي = min(received,total) والباقي آجل (FR-02-10)
        const cashPart = receivedD.lessThan(totalD) ? receivedD : totalD;
        void performSave({ payType: 'mixed', cashPart: money(cashPart) });
      } else {
        void performSave({ payType: 'cash' });
      }
    },
    [totals, performSave],
  );

  const onCustomerPicked = useCallback(
    (picked: { id: number; name: string } | null) => {
      useCartStore.getState().setParty(picked);
      if (pendingCredit) {
        setPendingCredit(false);
        if (picked !== null) void performSave({ payType: 'credit' });
      }
    },
    [pendingCredit, performSave],
  );

  const pickCurrency = useCallback(
    async (id: number) => {
      setSimpleSheet(null);
      const res = await useCartStore.getState().setCurrency(id);
      const code = currencies.find((c) => Number(c.id) === id)?.code ?? '';
      if (res.zeroed > 0) {
        showToast(fill(t.zeroedN, { n: res.zeroed, code }));
      } else if (res.repriced > 0) {
        showToast(fill(t.repricedN, { n: res.repriced, code }));
      }
    },
    [currencies, showToast],
  );

  const doPark = useCallback(async () => {
    if (items.length === 0) return;
    await useCartStore.getState().park();
    showToast(t.parkDone);
  }, [items.length, showToast]);

  // ---- أزرار الهيدر ----
  const headerActions: ScreenHeaderAction[] = [
    {
      icon: <ListOrdered size={24} color={colors.accent} />,
      label: t.listTitle,
      onPress: () => router.push('/sales'),
    },
    {
      icon: (
        <View>
          <ShoppingBasket size={24} color={parked.length > 0 ? colors.warning : colors.accent} />
          {parked.length > 0 ? (
            <View style={s.badge} pointerEvents="none">
              <Text style={s.badgeText}>{parked.length}</Text>
            </View>
          ) : null}
        </View>
      ),
      label: t.parkedTitle,
      onPress: () => setSimpleSheet('parked'),
    },
  ];

  if (!ready) {
    return (
      <Screen title={t.newTitle}>
        <LoadingSkeleton variant="list" rows={4} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t.newTitle}
      onBack={() => router.back()}
      actions={headerActions}
      scroll={false}
      footer={
        <View style={s.footerWrap}>
          {/* صف الإجماليات (عرض لحظي — الحساب النهائي في الدومين) */}
          <View style={s.totalsRow}>
            <View style={s.totalsMini}>
              <View style={s.miniRow}>
                <Text style={s.miniLabel}>{t.subtotalLabel}</Text>
                <Text style={s.miniValue}>{formatMoney(totals?.subtotal ?? 0, currencyDecimals)}</Text>
              </View>
              <View style={s.miniRow}>
                <Text style={s.miniLabel}>{t.discountLabel}</Text>
                <Text style={s.miniValue}>−{formatMoney(totals?.invoiceDiscount ?? 0, currencyDecimals)}</Text>
              </View>
              <View style={s.miniRow}>
                <Text style={s.miniLabel}>{t.taxLabel}</Text>
                <Text style={s.miniValue}>+{formatMoney(totals?.taxAmount ?? 0, currencyDecimals)}</Text>
              </View>
            </View>
            <View style={s.totalBox}>
              <Text style={s.totalLabel}>{t.totalLabel}</Text>
              <AmountText
                value={totals?.total ?? 0}
                decimals={currencyDecimals}
                suffix={currencyCode}
                size={24}
              />
            </View>
          </View>

          {/* شريط الأزرار الأربعة (LDR-1) */}
          <View style={s.btnGrid}>
            <PayAction
              label={saving ? t.saving : t.saveCash}
              tone="green"
              disabled={saving || items.length === 0}
              onPress={startCashSave}
            />
            <PayAction
              label={t.saveCredit}
              tone="amber"
              disabled={saving || items.length === 0}
              onPress={startCreditSave}
            />
            <SecondaryButton
              label={t.park}
              disabled={saving || items.length === 0}
              onPress={() => void doPark()}
            />
            <SecondaryButton label={t.extras} disabled={saving} onPress={() => setExtrasOpen(true)} />
          </View>
        </View>
      }
    >
      {/* شريط استعادة المسودة (AC-23) */}
      {restored ? (
        <View style={s.restoredBanner}>
          <History size={18} color={colors.warning} />
          <Text style={s.restoredText}>{t.restoredBanner}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.restoredDismiss}
            onPress={() => useCartStore.getState().dismissRestored()}
            style={({ pressed }) => [s.restoredDismiss, pressed && s.pressed]}
            hitSlop={6}
          >
            <Text style={s.restoredDismissText}>{t.restoredDismiss}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* شريط الأهداف: العميل / الصندوق / العملة */}
      <View style={s.chipsRow}>
        <ChipBtn
          icon={<UserRound size={16} color={colors.accent} />}
          label={party?.name ?? t.customerChip}
          onPress={() => setSimpleSheet('customer')}
        />
        <ChipBtn
          icon={<Wallet size={16} color={colors.accent} />}
          label={cashboxName ?? t.cashboxChip}
          onPress={() => setSimpleSheet('cashbox')}
        />
        <ChipBtn
          icon={<Coins size={16} color={colors.accent} />}
          label={currencyCode.length > 0 ? currencyCode : t.currencyChip}
          onPress={() => setSimpleSheet('currency')}
        />
      </View>

      {/* شريط المعلّقات */}
      {parked.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.parkedTitle}
          onPress={() => setSimpleSheet('parked')}
          style={({ pressed }) => [s.parkedStrip, pressed && s.pressed]}
        >
          <ShoppingBasket size={18} color={colors.warning} />
          <Text style={s.parkedStripText}>
            {fill(parked.length === 1 ? t.parkedCount : t.parkedCountPlural, { n: parked.length })}
          </Text>
        </Pressable>
      ) : null}

      {/* قائمة البنود + زر المسح العائم */}
      <View style={s.listArea}>
        <ScrollView contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled">
          {items.length === 0 ? (
            <EmptyState
              title={t.cartEmpty}
              message={t.cartEmptyHint}
              actionLabel={t.addItem}
              onAction={() => setItemPickerOpen(true)}
              style={s.emptyState}
            />
          ) : (
            items.map((it) => {
              const over = it.available !== null && !it.isService && dec(it.qty).greaterThan(dec(it.available));
              const lineTotal = dec(it.qty)
                .times(dec(it.unitPrice === '' ? '0' : it.unitPrice))
                .times(dec(100).minus(dec(it.discountPercent)).div(100));
              return (
                <View key={it.key} style={s.lineCard}>
                  <View style={s.lineHead}>
                    <View style={s.lineTitleWrap}>
                      <Text style={s.lineName} numberOfLines={1}>
                        {it.name}
                      </Text>
                      {it.isService ? (
                        <View style={s.serviceTag}>
                          <Text style={s.serviceTagText}>{t.serviceTag}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${common.remove} ${it.name}`}
                      onPress={() => removeWithUndo(it)}
                      hitSlop={6}
                      style={({ pressed }) => [s.removeBtn, pressed && s.pressed]}
                    >
                      <Trash2 size={18} color={colors.error} />
                    </Pressable>
                  </View>

                  {it.available !== null && !it.isService ? (
                    <Text style={[s.avail, over && s.availOver]}>
                      {fill(t.availableLabel, { n: it.available })}
                    </Text>
                  ) : null}

                  <View style={s.lineControls}>
                    <QtyStepper value={it.qty} onChange={(v) => changeQty(it, v)} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t.priceLabel} ${it.name}`}
                      onPress={() => setPriceEdit({ key: it.key, name: it.name, value: it.unitPrice })}
                      style={({ pressed }) => [s.priceBtn, pressed && s.pressed]}
                    >
                      <Text style={s.priceBtnLabel}>{t.priceLabel}</Text>
                      <Text style={[s.priceBtnValue, dec(it.unitPrice).isZero() && s.priceZero]}>
                        {formatMoney(it.unitPrice === '' ? 0 : it.unitPrice, currencyDecimals)} {currencyCode}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={s.lineFoot}>
                    <Text style={s.lineFootLabel}>{t.totalLabel}</Text>
                    <AmountText value={lineTotal} decimals={currencyDecimals} suffix={currencyCode} size={fontSizes.body} />
                  </View>
                </View>
              );
            })
          )}
          <SecondaryButton label={t.addItem} onPress={() => setItemPickerOpen(true)} />
        </ScrollView>

        {/* زر المسح العائم */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={common.scanBarcode}
          onPress={() => setScanOpen(true)}
          style={({ pressed }) => [s.fab, pressed && s.pressed]}
        >
          <ScanBarcode size={26} color={colors.bg} strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* ============ الشيتات ============ */}

      {/* اختيار العميل */}
      <CustomerPickerSheet
        visible={simpleSheet === 'customer'}
        onClose={() => setSimpleSheet(null)}
        onPick={onCustomerPicked}
      />

      {/* اختيار الصندوق */}
      <BottomSheet
        visible={simpleSheet === 'cashbox'}
        onClose={() => setSimpleSheet(null)}
        title={t.chooseCashbox}
      >
        <View style={s.sheetBody}>
          {cashboxes.map((b) => (
            <OptionRow
              key={b.id}
              label={b.name}
              active={b.name === cashboxName}
              onPress={() => {
                useCartStore.getState().setCashbox(b.id, b.name);
                setSimpleSheet(null);
              }}
            />
          ))}
          {cashboxes.length === 0 ? <Text style={s.sheetEmpty}>{common.noResults}</Text> : null}
        </View>
      </BottomSheet>

      {/* اختيار العملة (إعادة تسعير من product_price) */}
      <BottomSheet
        visible={simpleSheet === 'currency'}
        onClose={() => setSimpleSheet(null)}
        title={t.chooseCurrency}
      >
        <View style={s.sheetBody}>
          {currencies.map((c) => (
            <OptionRow
              key={Number(c.id)}
              label={`${c.code} — ${c.name}`}
              description={Number(c.is_base) === 1 ? t.isBaseCurrency : undefined}
              active={Number(c.id) === currencyId}
              onPress={() => void pickCurrency(Number(c.id))}
            />
          ))}
        </View>
      </BottomSheet>

      {/* السلال المعلّقة */}
      <ParkedCartsSheet
        visible={simpleSheet === 'parked'}
        onClose={() => setSimpleSheet(null)}
        parked={parked}
        currencyCode={currencyCode}
        onRestore={(id) => {
          void useCartStore.getState().restoreParked(id).then((ok) => {
            if (ok) setSimpleSheet(null);
          });
        }}
        onForget={(id) => void useCartStore.getState().forgetParked(id)}
      />

      {/* شيت الأصناف: بحث فوري + شبكة الأكثر مبيعاً */}
      <BottomSheet
        visible={itemPickerOpen}
        onClose={() => setItemPickerOpen(false)}
        title={t.itemPickerTitle}
        maxHeightRatio={0.92}
      >
        <View style={s.pickerBody}>
          <SearchBar
            placeholder={t.itemPickerSearch}
            value={pickerQuery}
            onChangeText={setPickerQuery}
            inputMode="search"
          />
          {pickerQuery.trim() === '' ? (
            <Text style={s.pickerSection}>{t.bestSellers}</Text>
          ) : null}
          <ScrollView style={s.pickerScroll} contentContainerStyle={s.pickerGrid}>
            {pickerResults.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                onPress={() => void addProduct(p)}
                style={({ pressed }) => [s.pickerCard, pressed && s.pressed]}
              >
                <Text style={s.pickerName} numberOfLines={2}>
                  {p.name}
                </Text>
                <Text
                  style={[
                    s.pickerPrice,
                    (p.price === null || dec(p.price).isZero()) && s.pickerNoPrice,
                  ]}
                  numberOfLines={1}
                >
                  {p.price !== null && dec(p.price).greaterThan(0)
                    ? `${formatMoney(p.price, currencyDecimals)} ${currencyCode}`
                    : t.noPrice}
                </Text>
                {!p.isService ? (
                  <Text style={s.pickerQty} numberOfLines={1}>
                    {fill(t.availableLabel, { n: p.totalQty })}
                  </Text>
                ) : (
                  <Text style={[s.pickerQty, s.pickerQtyService]} numberOfLines={1}>
                    {t.serviceTag}
                  </Text>
                )}
              </Pressable>
            ))}
            {pickerResults.length === 0 ? (
              <Text style={s.sheetEmpty}>{common.noResults}</Text>
            ) : null}
          </ScrollView>
        </View>
      </BottomSheet>

      {/* مسح الباركود */}
      <ScanSaleSheet visible={scanOpen} onClose={() => setScanOpen(false)} onFound={(b) => void onScanFound(b)} />

      {/* تعديل سعر البند */}
      <BottomSheet
        visible={priceEdit !== null}
        onClose={() => setPriceEdit(null)}
        title={`${t.priceLabel}${priceEdit !== null ? ` — ${priceEdit.name}` : ''}`}
      >
        <View style={s.pickerBody}>
          <NumberPad
            value={priceEdit?.value ?? ''}
            onValue={(v) => setPriceEdit((prev) => (prev === null ? prev : { ...prev, value: v }))}
            allowDecimal={currencyDecimals > 0}
            suffix={currencyCode}
            maxlength={13}
          />
          <PrimaryButton
            label={common.done}
            onPress={() => {
              if (priceEdit !== null) {
                useCartStore.getState().setPrice(priceEdit.key, priceEdit.value === '' ? '0' : priceEdit.value);
              }
              setPriceEdit(null);
            }}
          />
        </View>
      </BottomSheet>

      {/* تجاوز المتاح: «إضافة كموجود» / «متابعة» */}
      <BottomSheet visible={overAvail !== null} onClose={() => setOverAvail(null)} title={t.overAvailTitle}>
        <View style={s.sheetBody}>
          {overAvail !== null ? (
            <>
              <Text style={s.sheetMessage}>
                {fill(t.overAvailMessage, {
                  name: overAvail.name,
                  requested: overAvail.requested,
                  available: overAvail.available,
                })}
              </Text>
              <PrimaryButton
                label={t.addAvailable}
                onPress={() => {
                  useCartStore.getState().setQty(overAvail.key, overAvail.available);
                  setOverAvail(null);
                }}
              />
              <SecondaryButton
                label={t.continueAnyway}
                onPress={() => {
                  useCartStore.getState().setQty(overAvail.key, overAvail.requested);
                  setOverAvail(null);
                }}
              />
            </>
          ) : null}
        </View>
      </BottomSheet>

      {/* نقص مخزون عند الحفظ (رسالة نمط 6.3 + إضافة كموجود) */}
      <BottomSheet visible={shortage !== null} onClose={() => setShortage(null)} title={t.saveFailed}>
        <View style={s.sheetBody}>
          {shortage !== null ? (
            <>
              <Text style={s.sheetMessage}>{shortage.message}</Text>
              <PrimaryButton
                label={t.addAvailable}
                onPress={() => {
                  clampProductToAvailable(shortage.productName, shortage.available);
                  setShortage(null);
                }}
              />
              <SecondaryButton label={common.close} onPress={() => setShortage(null)} />
            </>
          ) : null}
        </View>
      </BottomSheet>

      {/* سعر صرف اليوم مفقود */}
      <DailyRateSheet
        visible={rateSheet !== null}
        onClose={() => setRateSheet(null)}
        currencyId={rateSheet?.currencyId ?? 0}
        date={rateSheet?.date ?? ''}
        currencyCode={currencyCode}
        onSaved={() => {
          setRateSheet(null);
          showToast(t.rateSavedRetry);
          const retry = pendingRetryRef.current;
          pendingRetryRef.current = null;
          if (retry !== null) void retry();
        }}
      />

      {/* تجاوز حد الائتمان (FR-03-05) */}
      <ConfirmSheetInline
        visible={creditConfirm !== null}
        onClose={() => setCreditConfirm(null)}
        title={t.creditLimitTitle}
        message={creditConfirm?.message ?? ''}
        confirmLabel={t.continueAnyway}
        onConfirm={() => {
          const opts = creditConfirm?.opts;
          setCreditConfirm(null);
          if (opts !== undefined) void performSave({ ...opts, creditLimitConfirmed: true });
        }}
      />

      {/* تأريخ رجعي (قرار 6) */}
      <ConfirmSheetInline
        visible={backdateConfirm !== null}
        onClose={() => setBackdateConfirm(null)}
        title={t.backdateTitle}
        message={backdateConfirm?.message ?? ''}
        confirmLabel={common.confirm}
        onConfirm={() => {
          const opts = backdateConfirm?.opts;
          setBackdateConfirm(null);
          if (opts !== undefined) void performSave({ ...opts, managerConfirmedBackdate: true });
        }}
      />

      {/* الدفع (DS-40) */}
      <PaymentSheet
        visible={paymentTotal !== null}
        onClose={() => setPaymentTotal(null)}
        total={paymentTotal ?? '0'}
        currencyCode={currencyCode}
        decimals={currencyDecimals}
        hasCustomer={party !== null}
        busy={saving}
        onConfirm={onPaymentConfirm}
      />

      {/* الإضافات: تاريخ/خصم/ملاحظات/مسودة */}
      <ExtrasSheet
        visible={extrasOpen}
        onClose={() => setExtrasOpen(false)}
        currencyCode={currencyCode}
        issuedAt={issuedAt}
        onSetIssuedAt={(iso) => useCartStore.getState().setIssuedAt(iso)}
        invoiceDiscount={invoiceDiscount}
        onSetInvoiceDiscount={(v) => useCartStore.getState().setInvoiceDiscount(v)}
        notesInternal={notesInternal}
        notesPrinted={notesPrinted}
        onSetNotes={(internal, printed) => useCartStore.getState().setNotes(internal, printed)}
        onSaveDraft={() => void performSave({ payType: 'cash', saveAsDraft: true })}
        busy={saving}
      />

      {/* نجاح الحفظ + الطباعة (ask) + عرض الفاتورة */}
      <BottomSheet
        visible={success !== null}
        onClose={() => setSuccess(null)}
        title={t.savedTitle}
      >
        <View style={s.sheetBody}>
          <View style={s.successIcon}>
            <CheckCircle2 size={44} color={colors.success} />
          </View>
          <Text style={s.successNo} numberOfLines={1} adjustsFontSizeToFit>
            {success?.no ?? ''}
          </Text>
          <PrimaryButton
            label={t.viewInvoice}
            onPress={() => {
              const target = success;
              setSuccess(null);
              if (target !== null) router.push(`/sales/${target.id}`);
            }}
          />
          {defaults?.printOnSave === 'ask' ? (
            <SecondaryButton
              label={t.printNow}
              onPress={() => {
                const target = success;
                setSuccess(null);
                if (target !== null) {
                  void printInvoice('sale', target.id).catch((err: unknown) => {
                    showToast(err instanceof Error ? err.message : pr.printFailed, { duration: 7000 });
                  });
                }
              }}
            />
          ) : null}
          <SecondaryButton label={t.printLater} onPress={() => setSuccess(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** زر دفع ملوّن (أخضر/كهرماني) بارتفاع 48 (DS-20/29). */
function PayAction({
  label,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  tone: 'green' | 'amber';
  onPress: () => void;
  disabled?: boolean;
}) {
  const bg = tone === 'green' ? colors.success : colors.warning;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.payBtn, { backgroundColor: bg }, pressed && s.pressed, disabled && s.disabled]}
    >
      <Text style={s.payBtnText}>{label}</Text>
    </Pressable>
  );
}

/** شريحة هدف قابلة للنقر (عميل/صندوق/عملة). */
function ChipBtn({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.chipBtn, pressed && s.pressed]}
    >
      {icon}
      <Text style={s.chipBtnText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** صف خيار داخل شيت الصندوق/العملة. */
function OptionRow({
  label,
  description,
  active,
  onPress,
}: {
  label: string;
  description?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.optionRow, active && s.optionActive, pressed && s.pressed]}
    >
      <View style={s.optionTextWrap}>
        <Text style={[s.optionLabel, active && s.optionLabelActive]} numberOfLines={1}>
          {label}
        </Text>
        {description !== undefined ? (
          <Text style={s.optionDesc} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      {active ? <CheckCircle2 size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

/** تأكيد بسيط (بلا كتابة كلمة) — للائتمان والتأريخ الرجعي. */
function ConfirmSheetInline({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={s.sheetBody}>
        <Text style={s.sheetMessage}>{message}</Text>
        <PrimaryButton label={confirmLabel} onPress={onConfirm} />
        <SecondaryButton label={common.cancel} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // الشريط العلوي
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 190,
  },
  chipBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  restoredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  restoredText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.warning,
  },
  restoredDismiss: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  restoredDismissText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  parkedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: radii.md,
    alignSelf: 'flex-start',
  },
  parkedStripText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.warning,
  },
  badge: {
    position: 'absolute',
    top: -6,
    left: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 11,
    color: colors.bg,
    includeFontPadding: false,
  },

  // قائمة البنود
  listArea: { flex: 1 },
  listContent: { gap: spacing.sm, paddingBottom: spacing.xl },
  emptyState: { flexGrow: 1 },
  lineCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineName: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  serviceTag: {
    backgroundColor: colors.extra.mutedSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  serviceTagText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  removeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  avail: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.warning,
  },
  availOver: { color: colors.error, fontFamily: fonts.bodyBold },
  lineControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  priceBtn: {
    alignItems: 'flex-end',
    gap: 2,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  priceBtnLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  priceBtnValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  priceZero: { color: colors.error },
  lineFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  lineFootLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },

  // التذييل
  footerWrap: { gap: spacing.sm },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  totalsMini: { flex: 1, gap: 1 },
  miniRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  miniLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  miniValue: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  totalBox: { alignItems: 'flex-end', gap: 2 },
  totalLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  btnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  payBtn: {
    flexGrow: 1,
    flexBasis: '44%',
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  payBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.bg,
    includeFontPadding: false,
  },

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
    lineHeight: 22,
  },
  sheetEmpty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  pickerBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pickerSection: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  pickerScroll: { flexGrow: 0, maxHeight: 380 },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pickerCard: {
    width: '48%',
    flexGrow: 1,
    gap: 4,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 92,
  },
  pickerName: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  pickerPrice: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.accent,
    includeFontPadding: false,
  },
  pickerNoPrice: { color: colors.warning, fontFamily: fonts.bodyMedium },
  pickerQty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  pickerQtyService: { color: colors.muted },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  optionActive: { borderColor: colors.accent, backgroundColor: colors.extra.accentSoft },
  optionTextWrap: { flex: 1, gap: 2 },
  optionLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  optionLabelActive: { color: colors.accent, fontFamily: fonts.bodyBold },
  optionDesc: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },

  // النجاح
  successIcon: { alignSelf: 'center', padding: spacing.sm },
  successNo: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.display,
    color: colors.success,
    textAlign: 'center',
    includeFontPadding: false,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
