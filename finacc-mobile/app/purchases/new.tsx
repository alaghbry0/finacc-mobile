import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus, ShoppingCart, Trash2, UserPlus } from 'lucide-react-native';
import Decimal from 'decimal.js';
import {
  AmountText,
  AppCard,
  BottomSheet,
  ErrorState,
  LoadingSkeleton,
  PrimaryButton,
  QtyStepper,
  Screen,
  SearchBar,
  SecondaryButton,
  SectionTitle,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { common, purchases as p } from '@/i18n/ar';
import { savePurchaseInvoice } from '@/domain/purchasing';
import { searchProducts, type ProductListRow } from '@/domain/inventory';
import { searchSuppliers, createSupplier, type SupplierListRow } from '@/domain/parties';
import { getBaseCurrency } from '@/domain/currency';
import { listCashboxes, type CashboxLite } from '@/domain/invoicing';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * فاتورة شراء جديدة (FR-02-08) — نسخة مبسطة من شاشة البيع:
 * سلة محلية داخل الشاشة (useState بلا Park — الشراء أقل حيوية)، مورد (بحث +
 * «مورد نقدي» + إنشاء سريع)، بنود بسعر شراء يبدأ من التكلفة الحالية، خصم رأس
 * يوزَّع pro-rata قبل تحديث WAC، ودفع نقدي/آجل/مختلط.
 * قرار موثق: عملة الفاتورة = العملة الأساسية في V1 (لوحة اختيار العملات تخص
 * شاشة البيع الأكثر استخداماً؛ الدومين يدعم أي عملة).
 */
interface CartLine {
  key: string;
  productId: number;
  name: string;
  qty: string;
  unitPrice: string;
  isService: boolean;
}

export default function NewPurchaseScreen() {
  const showToast = useToastStore((s) => s.show);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [supplierSheet, setSupplierSheet] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<SupplierListRow[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [productSheet, setProductSheet] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductListRow[]>([]);

  const [invoiceDiscount, setInvoiceDiscount] = useState('');
  const [payType, setPayType] = useState<'cash' | 'credit' | 'mixed'>('cash');
  const [cashPart, setCashPart] = useState('');
  const [cashboxes, setCashboxes] = useState<CashboxLite[]>([]);
  const [cashboxId, setCashboxId] = useState<string>('');
  const [note, setNote] = useState('');

  const [baseCurrencyId, setBaseCurrencyId] = useState<number | null>(null);
  const [baseCurrencyCode, setBaseCurrencyCode] = useState('');
  const [baseDecimals, setBaseDecimals] = useState(0);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFatal(null);
    try {
      const base = await getBaseCurrency();
      const boxes = await listCashboxes();
      const match = boxes.find((b) => b.currencyId === base.id) ?? boxes[0];
      setBaseCurrencyId(base.id);
      setBaseCurrencyCode(base.code);
      setBaseDecimals(Number(base.decimals ?? 2));
      setCashboxes(boxes);
      if (match !== undefined) setCashboxId(String(match.id));
      setWarehouseId(1); // المخزن الرئيسي من الإعداد — يُثبَّت في V1
    } catch (e) {
      setFatal(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // بحث الموردين داخل الشيت
  useEffect(() => {
    if (!supplierSheet) return;
    let alive = true;
    void (async () => {
      try {
        const res = await searchSuppliers(supplierQuery);
        if (alive) setSupplierResults(res);
      } catch {
        /* النتائج تبقى كما هي */
      }
    })();
    return () => {
      alive = false;
    };
  }, [supplierSheet, supplierQuery]);

  // بحث الأصناف داخل الشيت
  useEffect(() => {
    if (!productSheet) return;
    let alive = true;
    void (async () => {
      try {
        const res = await searchProducts(productQuery, { limit: 40 });
        if (alive) setProductResults(res);
      } catch {
        /* النتائج تبقى كما هي */
      }
    })();
    return () => {
      alive = false;
    };
  }, [productSheet, productQuery]);

  const subtotal = useMemo(
    () => lines.reduce((acc, l) => acc.plus(new Decimal(l.qty || '0').times(new Decimal(l.unitPrice || '0'))), new Decimal(0)),
    [lines],
  );
  const discount = new Decimal(invoiceDiscount || '0');
  const total = Decimal.max(subtotal.minus(discount), new Decimal(0));

  const cashboxOptions: SelectOption[] = cashboxes
    .filter((b) => baseCurrencyId === null || b.currencyId === baseCurrencyId)
    .map((b) => ({ value: String(b.id), label: b.name }));

  const pickSupplier = (row: SupplierListRow) => {
    setSupplierId(row.id);
    setSupplierName(row.name);
    setSupplierSheet(false);
  };
  const pickCashSupplier = () => {
    setSupplierId(null);
    setSupplierName(null);
    setSupplierSheet(false);
  };

  const quickAddSupplier = async () => {
    if (quickBusy) return;
    setQuickError(null);
    const name = quickName.trim();
    if (name === '') {
      setQuickError(common.requiredField);
      return;
    }
    setQuickBusy(true);
    try {
      const id = await createSupplier({ name, phone: quickPhone.trim() === '' ? undefined : quickPhone.trim() });
      setSupplierId(id);
      setSupplierName(name);
      setQuickAddOpen(false);
      setSupplierSheet(false);
      setQuickName('');
      setQuickPhone('');
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setQuickBusy(false);
    }
  };

  const addProduct = (row: ProductListRow) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === row.id);
      if (existing !== undefined) {
        return prev.map((l) =>
          l.productId === row.id ? { ...l, qty: new Decimal(l.qty).plus(1).toString() } : l,
        );
      }
      return [
        ...prev,
        {
          key: `${row.id}-${Date.now()}`,
          productId: row.id,
          name: row.name,
          qty: '1',
          unitPrice: row.costPrice,
          isService: row.isService,
        },
      ];
    });
    setProductSheet(false);
    setProductQuery('');
  };

  const setLine = (key: string, patch: Partial<CartLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const save = async () => {
    if (saving) return;
    setSaveError(null);
    if (lines.length === 0) {
      setSaveError('أضف بنداً واحداً على الأقل إلى فاتورة الشراء');
      return;
    }
    if ((payType === 'credit' || payType === 'mixed') && supplierId === null) {
      setSaveError('الشراء الآجل/المختلط يتطلب اختيار مورّد — اختر مورداً أو حوّل الفاتورة نقدياً');
      return;
    }
    if ((payType === 'cash' || payType === 'mixed') && cashboxId === '') {
      setSaveError('الدفع النقدي يتطلب اختيار صندوق');
      return;
    }
    if (payType === 'mixed' && new Decimal(cashPart || '0').lte(0)) {
      setSaveError('الفاتورة المختلطة تتطلب تحديد مبلغ الجزء النقدي');
      return;
    }
    if (warehouseId === null || baseCurrencyId === null) {
      setSaveError(common.errorGeneral);
      return;
    }
    setSaving(true);
    try {
      const res = await savePurchaseInvoice({
        items: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        payType,
        cashPart: payType === 'mixed' ? cashPart : undefined,
        supplierId,
        cashboxId: payType === 'credit' ? null : Number(cashboxId),
        warehouseId,
        currencyId: baseCurrencyId,
        invoiceDiscount: invoiceDiscount.trim() === '' ? undefined : invoiceDiscount.trim(),
        notesInternal: note.trim() === '' ? undefined : note.trim(),
      });
      showToast(p.savedToast(res.invoiceNo ?? ''));
      router.replace(`/purchases/${res.invoiceId}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : common.errorGeneral);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen title={p.newTitle} onBack={() => router.back()}>
        <LoadingSkeleton />
      </Screen>
    );
  }

  if (fatal !== null) {
    return (
      <Screen title={p.newTitle} onBack={() => router.back()}>
        <ErrorState message={fatal} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen
      title={p.newTitle}
      onBack={() => router.back()}
      footer={
        <View style={s.footerWrap}>
          <AmountText value={total} decimals={baseDecimals} suffix={baseCurrencyCode} size={fontSizes.title} />
          <PrimaryButton label={p.savePurchase} onPress={() => void save()} loading={saving} />
        </View>
      }
    >
      {/* المورد */}
      <SectionTitle title={p.supplierLabel} hint={p.supplierRequiredHint} />
      <AppCard>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.supplierLabel}
          onPress={() => setSupplierSheet(true)}
          style={({ pressed }) => [s.supplierRow, pressed && s.pressed]}
        >
          <ShoppingCart size={22} color={colors.accent} />
          <View style={s.supplierTextWrap}>
            <Text style={s.supplierName}>{supplierName ?? p.cashSupplier}</Text>
            <Text style={s.supplierSub}>{supplierId === null ? 'لن يقيَّد على حساب مورد' : 'شراء يقيَّد على حساب المورد'}</Text>
          </View>
          <Text style={s.changeBtn}>{common.edit}</Text>
        </Pressable>
      </AppCard>

      {/* البنود */}
      <SectionTitle title={p.itemsTitle} hint={p.purchasePrice} />
      <AppCard style={s.itemsCard}>
        {lines.length === 0 ? (
          <Text style={s.noItems}>{p.noItemsYet}</Text>
        ) : (
          lines.map((l) => (
            <View key={l.key} style={s.lineRow}>
              <View style={s.lineHead}>
                <Text style={l.isService ? s.lineNameSvc : s.lineName} numberOfLines={1}>
                  {l.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={common.remove}
                  onPress={() => removeLine(l.key)}
                  hitSlop={8}
                  style={s.removeBtn}
                >
                  <Trash2 size={18} color={colors.error} />
                </Pressable>
              </View>
              <View style={s.lineControls}>
                <View style={s.qtyWrap}>
                  <Text style={s.miniLabel}>{common.quantity}</Text>
                  <QtyStepper value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
                </View>
                <View style={s.priceWrap}>
                  <AmountPadField
                    label={p.purchasePrice}
                    value={l.unitPrice}
                    onValue={(v) => setLine(l.key, { unitPrice: v })}
                    suffix={baseCurrencyCode}
                    sheetTitle={`${p.purchasePrice} — ${l.name}`}
                  />
                </View>
              </View>
              <View style={s.lineTotalRow}>
                <Text style={s.miniLabel}>{p.lineTotal}</Text>
                <AmountText value={new Decimal(l.qty || '0').times(new Decimal(l.unitPrice || '0'))} decimals={baseDecimals} suffix={baseCurrencyCode} size={fontSizes.body} />
              </View>
            </View>
          ))
        )}
        <SecondaryButton label={p.addItem} onPress={() => setProductSheet(true)} />
      </AppCard>

      {/* خصم رأس الفاتورة */}
      <SectionTitle title={p.invoiceDiscount} hint={p.invoiceDiscountHint} />
      <AppCard>
        <AmountPadField label={p.invoiceDiscount} value={invoiceDiscount} onValue={setInvoiceDiscount} suffix={baseCurrencyCode} />
      </AppCard>

      {/* الدفع */}
      <SectionTitle title={p.payTypeLabel} />
      <AppCard style={s.payCard}>
        <View style={s.segment}>
          <SegBtn active={payType === 'cash'} label={p.cashPay} onPress={() => setPayType('cash')} />
          <SegBtn active={payType === 'credit'} label={p.creditPay} onPress={() => setPayType('credit')} />
          <SegBtn active={payType === 'mixed'} label={p.mixedPay} onPress={() => setPayType('mixed')} />
        </View>
        {payType !== 'credit' ? (
          <SelectField label={p.cashboxLabel} value={cashboxId} options={cashboxOptions} onSelect={setCashboxId} required />
        ) : null}
        {payType === 'mixed' ? (
          <AmountPadField
            label={p.cashPartLabel}
            value={cashPart}
            onValue={setCashPart}
            suffix={baseCurrencyCode}
            hint={p.cashPartHint}
            required
          />
        ) : null}
      </AppCard>

      {/* ملاحظة داخلية */}
      <AppCard>
        <TextField label={p.internalNote} value={note} onChangeText={setNote} multiline />
      </AppCard>

      {saveError !== null ? <Text style={s.saveError}>{saveError}</Text> : null}

      {/* شيت اختيار المورد */}
      <BottomSheet visible={supplierSheet} onClose={() => setSupplierSheet(false)} title={p.supplierLabel}>
        <View style={s.sheetBody}>
          <SearchBar placeholder={p.supplierSearchPlaceholder} value={supplierQuery} onChangeText={setSupplierQuery} />
          <View style={s.optionsList}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={p.cashSupplier}
              onPress={pickCashSupplier}
              style={({ pressed }) => [s.optionRow, pressed && s.pressed]}
            >
              <ShoppingCart size={20} color={colors.muted} />
              <Text style={s.optionLabel}>{p.cashSupplier}</Text>
            </Pressable>
            {supplierResults.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={row.name}
                onPress={() => pickSupplier(row)}
                style={({ pressed }) => [s.optionRow, pressed && s.pressed, supplierId === row.id && s.optionActive]}
              >
                <View style={s.optionTextWrap}>
                  <Text style={s.optionLabel}>{row.name}</Text>
                  {row.phone !== null ? <Text style={s.optionSub}>{row.phone}</Text> : null}
                </View>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={p.quickAddSupplier}
              onPress={() => setQuickAddOpen(true)}
              style={({ pressed }) => [s.optionRow, s.optionAdd, pressed && s.pressed]}
            >
              <UserPlus size={20} color={colors.success} />
              <Text style={s.optionAddLabel}>{p.quickAddSupplier}</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      {/* إنشاء مورد سريع */}
      <BottomSheet visible={quickAddOpen} onClose={() => setQuickAddOpen(false)} title={p.quickAddSupplierTitle} dismissible={!quickBusy}>
        <View style={s.sheetBody}>
          <TextField label={p.supplierLabel} value={quickName} onChangeText={setQuickName} error={quickError} required placeholder="مثال: مؤسسة النور للتوزيع" />
          <TextField label="الهاتف" value={quickPhone} onChangeText={setQuickPhone} keyboardType="phone-pad" placeholder="اختياري" />
          <View style={s.quickBtns}>
            <PrimaryButton label={common.save} onPress={() => void quickAddSupplier()} loading={quickBusy} disabled={quickBusy} />
            <SecondaryButton label={common.cancel} onPress={() => setQuickAddOpen(false)} disabled={quickBusy} />
          </View>
        </View>
      </BottomSheet>

      {/* شيت اختيار الصنف */}
      <BottomSheet visible={productSheet} onClose={() => setProductSheet(false)} title={p.addItem}>
        <View style={s.sheetBody}>
          <SearchBar placeholder={p.productSearchPlaceholder} value={productQuery} onChangeText={setProductQuery} />
          <View style={s.optionsList}>
            {productResults.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={row.name}
                onPress={() => addProduct(row)}
                style={({ pressed }) => [s.optionRow, pressed && s.pressed]}
              >
                <View style={s.optionTextWrap}>
                  <Text style={s.optionLabel} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={s.optionSub} numberOfLines={1}>
                    {row.barcode ?? '—'} · {p.currentCost}: {row.costPrice} {baseCurrencyCode} · {common.quantity}: {row.totalQty}
                  </Text>
                </View>
                <Plus size={20} color={colors.accent} />
              </Pressable>
            ))}
            {productResults.length === 0 ? <Text style={s.noResults}>{common.noResults}</Text> : null}
          </View>
        </View>
      </BottomSheet>
    </Screen>
  );
}

function SegBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
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
  footerWrap: { gap: spacing.sm },
  pressed: { opacity: 0.85 },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
  },
  supplierTextWrap: { flex: 1, gap: 2 },
  supplierName: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  supplierSub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  changeBtn: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  itemsCard: { gap: spacing.md },
  noItems: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  lineRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineName: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  lineNameSvc: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.muted,
  },
  removeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lineControls: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  qtyWrap: { flex: 1, gap: 4 },
  priceWrap: { flex: 1 },
  lineTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  miniLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  payCard: { gap: spacing.md },
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
  saveError: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.error,
    lineHeight: 19,
  },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  optionsList: { gap: spacing.xs },
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
  optionSub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  optionAdd: { borderStyle: 'dashed' as const },
  optionAddLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.success,
  },
  noResults: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  quickBtns: { gap: spacing.sm },
});
