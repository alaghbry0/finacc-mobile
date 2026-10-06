import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Landmark,
  Plus,
  ShoppingBag,
  UserMinus,
  UserPlus,
} from 'lucide-react-native';
import {
  AmountText,
  BottomSheet,
  ConfirmSheet,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  SelectField,
  TextField,
  DateField,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { PartyPickerSheet } from '@/screens/cash/PartyPickerSheet';
import { DailyRateSheet } from '@/screens/invoices/DailyRateSheet';
import { common, cash as t, fill } from '@/i18n/ar';
import {
  cashboxBalances,
  createCashTx,
  listExpenseCategories,
  upsertExpenseCategory,
  type CashTxType,
  type CashboxBalanceRow,
  type ExpenseCategoryRow,
} from '@/domain/cash';
import { listInvoices, type InvoiceListRow } from '@/domain/invoicing';
import { MissingRateError, getRateSnapshot } from '@/domain/currency';
import { BackdateConfirmationRequiredError } from '@/domain/fiscal';
import { useToastStore } from '@/store/toast';
import { dec, roundTo } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** بطاقات أنواع الحركات الثمانية (FR-04-02) — أيقونة + شكل غير لوني للدلالة. */
const TYPE_CARDS: { key: CashTxType; icon: React.ReactNode; tone: 'in' | 'out' | 'neutral' }[] = [
  { key: 'receipt', icon: <ArrowDownLeft size={24} color={colors.success} strokeWidth={2.2} />, tone: 'in' },
  { key: 'payment', icon: <ArrowUpRight size={24} color={colors.error} strokeWidth={2.2} />, tone: 'out' },
  { key: 'expense', icon: <ShoppingBag size={24} color={colors.error} strokeWidth={2.2} />, tone: 'out' },
  { key: 'owner_draw', icon: <UserMinus size={24} color={colors.error} strokeWidth={2.2} />, tone: 'out' },
  { key: 'capital_in', icon: <UserPlus size={24} color={colors.success} strokeWidth={2.2} />, tone: 'in' },
  { key: 'box_transfer', icon: <ArrowLeftRight size={24} color={colors.accent} strokeWidth={2.2} />, tone: 'neutral' },
  { key: 'bank_deposit', icon: <Landmark size={24} color={colors.success} strokeWidth={2.2} />, tone: 'in' },
  { key: 'bank_withdraw', icon: <Banknote size={24} color={colors.error} strokeWidth={2.2} />, tone: 'out' },
];

/** حركة نقدية جديدة (§6.4): نوع → حقول تتكيف → حفظ بعملة الصندوق. */
export default function CashTxNewScreen() {
  const showToast = useToastStore((st) => st.show);

  const [txType, setTxType] = useState<CashTxType>('receipt');
  const [boxes, setBoxes] = useState<CashboxBalanceRow[]>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [toCashboxId, setToCashboxId] = useState('');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [txDate, setTxDate] = useState<string>(todayISO());
  const [description, setDescription] = useState('');

  // الطرف (قبض/صرف)
  const [partySheet, setPartySheet] = useState(false);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState<string | null>(null);

  // طريقة القبض/الصرف + الفواتير المفتوحة
  const [allocMode, setAllocMode] = useState<'on_account' | 'invoice'>('on_account');
  const [openInvoices, setOpenInvoices] = useState<InvoiceListRow[]>([]);
  const [invoiceId, setInvoiceId] = useState('');

  // فئات المصروف
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatBusy, setNewCatBusy] = useState(false);

  // حواجز الحفظ
  const [saving, setSaving] = useState(false);
  const [backdateConfirm, setBackdateConfirm] = useState(false);
  const [rateSheet, setRateSheet] = useState<{ currencyId: number; date: string; code?: string } | null>(null);
  const [convertedPreview, setConvertedPreview] = useState<string | null>(null);

  // تحميل الصناديق (والفئات عند الحاجة)
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await cashboxBalances();
        if (!alive) return;
        setBoxes(list);
        const def = list.find((b) => b.isDefault);
        if (def !== undefined) setCashboxId(String(def.id));
      } catch (e) {
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showToast]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await listExpenseCategories());
    } catch {
      /* تُعرض قائمة فارغة والإنشاء متاح */
    }
  }, []);

  useEffect(() => {
    if (txType === 'expense' && categories.length === 0) void loadCategories();
  }, [txType, categories.length, loadCategories]);

  // فواتير العميل/المورّد الآجلة المفتوحة عند اختيار الطرف
  const loadOpenInvoices = useCallback(async () => {
    const id = txType === 'receipt' ? customerId : supplierId;
    if (id === null) {
      setOpenInvoices([]);
      return;
    }
    try {
      const rows = await listInvoices({
        docType: txType === 'receipt' ? 'sale' : 'purchase',
        status: 'completed',
        customerId: txType === 'receipt' ? id : undefined,
        supplierId: txType === 'payment' ? id : undefined,
        limit: 200,
      });
      setOpenInvoices(rows.filter((r) => r.payStatus !== 'cash' && dec(r.dueAmount).greaterThan(0)));
    } catch {
      setOpenInvoices([]);
    }
  }, [txType, customerId, supplierId]);

  useEffect(() => {
    if (txType === 'receipt' || txType === 'payment') void loadOpenInvoices();
  }, [txType, loadOpenInvoices]);

  const selectedBox = boxes.find((b) => String(b.id) === cashboxId);
  const destBox = boxes.find((b) => String(b.id) === toCashboxId);
  const selectedInvoice = openInvoices.find((inv) => String(inv.id) === invoiceId);

  // خيارات الصناديق — عند التحصيل على فاتورة: بعملة الفاتورة حصراً (قرار 8)
  const boxOptions: SelectOption[] = useMemo(() => {
    let list = boxes;
    if ((txType === 'receipt' || txType === 'payment') && allocMode === 'invoice' && selectedInvoice !== undefined) {
      list = list.filter((b) => b.currencyId === selectedInvoice.currencyId);
    }
    return list.map((b) => ({
      value: String(b.id),
      label: `${b.name} (${b.currencyCode})`,
      description: `${t.currentBalance}: ${b.balance}`,
    }));
  }, [boxes, txType, allocMode, selectedInvoice]);

  // صندوق الوجهة: رفض نفس الصندوق (FR-01-09 style)
  const destBoxOptions: SelectOption[] = useMemo(
    () =>
      boxes
        .filter((b) => String(b.id) !== cashboxId)
        .map((b) => ({ value: String(b.id), label: `${b.name} (${b.currencyCode})` })),
    [boxes, cashboxId],
  );
  const sameBoxError =
    txType === 'box_transfer' && toCashboxId !== '' && toCashboxId === cashboxId ? t.sameBoxError : null;

  // معاينة التحويل بين عملتين (سعر اليوم)
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setConvertedPreview(null);
      if (
        txType !== 'box_transfer' ||
        selectedBox === undefined ||
        destBox === undefined ||
        selectedBox.currencyId === destBox.currencyId ||
        amount === '' ||
        dec(amount).lessThanOrEqualTo(0)
      ) {
        return;
      }
      try {
        const src = await getRateSnapshot(selectedBox.currencyId, txDate);
        const dst = await getRateSnapshot(destBox.currencyId, txDate);
        const base = dec(amount).times(dec(src.rate));
        const converted = roundTo(base.div(dec(dst.rate)), destBox.currencyDecimals);
        if (alive) setConvertedPreview(`${converted} ${destBox.currencyCode}`);
      } catch {
        /* لا سعر اليوم — تُطلب عند الحفظ (DailyRateSheet) */
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [txType, selectedBox, destBox, amount, txDate]);

  const needsParty = txType === 'receipt' || txType === 'payment';
  const partyPicked = txType === 'receipt' ? customerId !== null : supplierId !== null;
  const partyLabel =
    txType === 'receipt'
      ? customerId !== null
        ? (customerName ?? '')
        : t.pickCustomer
      : supplierId !== null
        ? (supplierName ?? '')
        : t.pickSupplier;

  const canSave =
    !saving &&
    cashboxId !== '' &&
    amount !== '' &&
    dec(amount).greaterThan(0) &&
    (!needsParty || partyPicked) &&
    (txType !== 'expense' || categoryId !== '') &&
    (txType !== 'box_transfer' || (toCashboxId !== '' && toCashboxId !== cashboxId)) &&
    (txType !== 'receipt' || allocMode === 'on_account' || (needsParty && partyPicked && invoiceId !== '')) &&
    sameBoxError === null;

  // ---- الحفظ ----
  const save = useCallback(
    async (flags?: { backdateConfirmed?: boolean }) => {
      if (!canSave && flags === undefined) return;
      setSaving(true);
      try {
        const res = await createCashTx({
          txType,
          cashboxId: Number(cashboxId),
          toCashboxId: txType === 'box_transfer' ? Number(toCashboxId) : null,
          currencyId: Number(selectedBox?.currencyId ?? 0),
          amount,
          toAmount: txType === 'box_transfer' && toAmount !== '' ? toAmount : undefined,
          txDate,
          refType:
            txType === 'receipt' || txType === 'payment'
              ? partyPicked
                ? allocMode
                : null
              : null,
          refId:
            (txType === 'receipt' || txType === 'payment') && partyPicked && allocMode === 'invoice'
              ? Number(invoiceId)
              : null,
          expenseCategoryId: txType === 'expense' ? Number(categoryId) : null,
          customerId: txType === 'receipt' ? customerId : null,
          supplierId: txType === 'payment' ? supplierId : null,
          description: description.trim().length > 0 ? description.trim() : undefined,
          managerConfirmedBackdate: flags?.backdateConfirmed === true,
        });
        // قرار 9: الحفظ ينجح والسالب يُسجَّل عجزاً — تحذير كهرماني بعد الحفظ
        if (dec(res.newBalance).isNegative()) {
          showToast(t.negativeRecordedToast, { tone: 'warning', duration: 7000 });
        } else {
          showToast(
            fill(t.savedToast, { balance: `${res.newBalance} ${selectedBox?.currencyCode ?? ''}`.trim() }),
          );
        }
        router.back();
      } catch (e) {
        if (e instanceof BackdateConfirmationRequiredError) {
          setBackdateConfirm(true);
          return;
        }
        if (e instanceof MissingRateError) {
          setRateSheet({
            currencyId: e.currencyId,
            date: e.date,
            code: boxes.find((b) => b.currencyId === e.currencyId)?.currencyCode,
          });
          return;
        }
        showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
      } finally {
        setSaving(false);
      }
    },
    [
      canSave,
      txType,
      cashboxId,
      toCashboxId,
      selectedBox,
      amount,
      toAmount,
      txDate,
      partyPicked,
      allocMode,
      invoiceId,
      categoryId,
      customerId,
      supplierId,
      description,
      showToast,
    ],
  );

  // ---- فئة جديدة ----
  const addCategory = async () => {
    const name = newCatName.trim();
    if (name.length === 0) return;
    setNewCatBusy(true);
    try {
      const id = await upsertExpenseCategory(null, name);
      await loadCategories();
      setCategoryId(String(id));
      setNewCatOpen(false);
      setNewCatName('');
      showToast(t.categoryAdded);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setNewCatBusy(false);
    }
  };

  return (
    <Screen title={t.newTxTitle} onBack={() => router.back()} footer={<PrimaryButton label={t.save} onPress={() => void save()} loading={saving} disabled={!canSave} />}>
      {/* اختيار النوع */}
      <SectionTitle title={t.newTxTitle} hint={t.typeSectionHint} />
      <View style={s.typeGrid}>
        {TYPE_CARDS.map((card) => {
          const active = txType === card.key;
          return (
            <Pressable
              key={card.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.types[card.key]}
              onPress={() => setTxType(card.key)}
              style={({ pressed }) => [s.typeCard, active && s.typeCardActive, pressed && s.pressed]}
            >
              {card.icon}
              <Text style={[s.typeCardText, active && s.typeCardTextActive]} numberOfLines={2}>
                {t.types[card.key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* الطرف — لقبض/صرف فقط */}
      {needsParty ? (
        <Field label={txType === 'receipt' ? t.customerLabel : t.supplierLabel} hint={t.partyHint} required>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={partyLabel}
            onPress={() => setPartySheet(true)}
            style={({ pressed }) => [s.partyRow, pressed && s.pressed]}
          >
            <Text style={[s.partyValue, !partyPicked && s.partyPlaceholder]} numberOfLines={1}>
              {partyLabel}
            </Text>
            <Plus size={18} color={colors.accent} />
          </Pressable>
        </Field>
      ) : null}

      {/* طريقة القبض/الصرف — حصراً عند وجود طرف */}
      {needsParty && partyPicked ? (
        <View style={s.allocWrap}>
          <Text style={s.allocLabel}>{t.receiptModeLabel}</Text>
          <View style={s.segment}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: allocMode === 'on_account' }}
              onPress={() => setAllocMode('on_account')}
              style={[s.segBtn, allocMode === 'on_account' && s.segBtnActive]}
            >
              <Text style={[s.segText, allocMode === 'on_account' && s.segTextActive]}>{t.onAccount}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: allocMode === 'invoice' }}
              onPress={() => setAllocMode('invoice')}
              style={[s.segBtn, allocMode === 'invoice' && s.segBtnActive]}
            >
              <Text style={[s.segText, allocMode === 'invoice' && s.segTextActive]}>{t.onInvoice}</Text>
            </Pressable>
          </View>

          {allocMode === 'invoice' ? (
            openInvoices.length === 0 ? (
              <Text style={s.noInvoices}>{t.noOpenInvoices}</Text>
            ) : (
              <SelectField
                label={t.invoiceLabel}
                value={invoiceId}
                options={openInvoices.map((inv) => ({
                  value: String(inv.id),
                  label: `${inv.invoiceNo ?? `#${inv.id}`}`,
                  description: `${t.dueLabelShort}: ${inv.dueAmount} ${inv.currencyCode} · ${inv.issuedAt}`,
                }))}
                onSelect={setInvoiceId}
                required
              />
            )
          ) : null}
        </View>
      ) : null}

      {/* فئة المصروف */}
      {txType === 'expense' ? (
        <View style={s.catWrap}>
          <SelectField
            label={t.categoryLabel}
            value={categoryId}
            options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            onSelect={setCategoryId}
            required
          />
          <SecondaryButton label={t.addCategory} onPress={() => setNewCatOpen(true)} />
        </View>
      ) : null}

      {/* صندوق الوجهة — تحويل */}
      {txType === 'box_transfer' ? (
        <>
          <SelectField
            label={t.destCashboxLabel}
            value={toCashboxId}
            options={destBoxOptions}
            onSelect={setToCashboxId}
            error={sameBoxError}
            hint={sameBoxError === null ? t.toCashboxHint : undefined}
            required
          />
          {destBox !== undefined && selectedBox !== undefined && destBox.currencyId !== selectedBox.currencyId ? (
            <AmountPadField
              label={t.toAmountLabel}
              value={toAmount}
              onValue={setToAmount}
              suffix={destBox.currencyCode}
              hint={
                convertedPreview !== null
                  ? fill(t.convertedHint, { amount: convertedPreview.split(' ')[0], code: destBox.currencyCode })
                  : t.toCashboxHint
              }
            />
          ) : null}
        </>
      ) : null}

      {/* الأساسيات */}
      <SelectField
        label={t.cashboxLabel}
        value={cashboxId}
        options={boxOptions}
        onSelect={(v) => {
          setCashboxId(v);
          if (toCashboxId === v) setToCashboxId('');
        }}
        required
      />
      <AmountPadField
        label={t.amountLabel}
        value={amount}
        onValue={setAmount}
        suffix={selectedBox?.currencyCode}
        required
      />
      <DateField label={t.fieldDate} value={txDate} onChange={setTxDate} />
      <TextField
        label={t.descLabel}
        value={description}
        onChangeText={setDescription}
        maxLength={200}
        multiline
      />

      <View style={s.bottomSpace} />

      {/* ============ الشيتات ============ */}
      <PartyPickerSheet
        visible={partySheet}
        onClose={() => setPartySheet(false)}
        kind={txType === 'receipt' ? 'customer' : 'supplier'}
        selectedName={txType === 'receipt' ? customerName : supplierName}
        onPick={(p) => {
          if (txType === 'receipt') {
            setCustomerId(p.id);
            setCustomerName(p.name);
          } else {
            setSupplierId(p.id);
            setSupplierName(p.name);
          }
          setAllocMode('on_account');
          setInvoiceId('');
        }}
      />

      {/* فئة مصروف جديدة */}
      <BottomSheet visible={newCatOpen} onClose={() => setNewCatOpen(false)} title={t.newCategoryLabel}>
        <View style={s.sheetBody}>
          <TextField
            label={t.newCategoryLabel}
            value={newCatName}
            onChangeText={setNewCatName}
            placeholder={t.newCategoryPlaceholder}
            maxLength={60}
            disabled={newCatBusy}
          />
          <PrimaryButton label={common.add} onPress={() => void addCategory()} loading={newCatBusy} disabled={newCatBusy || newCatName.trim().length === 0} />
        </View>
      </BottomSheet>

      {/* تأريخ رجعي — تأكيد المدير (قاعدة 5.4-11) */}
      <ConfirmSheet
        visible={backdateConfirm}
        onClose={() => setBackdateConfirm(false)}
        onConfirm={() => {
          setBackdateConfirm(false);
          void save({ backdateConfirmed: true });
        }}
        title={t.backdateTitle}
        message={t.backdateMessage}
        confirmLabel={t.backdateContinue2}
      />

      {/* سعر اليوم المفقود أثناء التحويل بين عملتين */}
      <DailyRateSheet
        visible={rateSheet !== null}
        onClose={() => setRateSheet(null)}
        currencyId={rateSheet?.currencyId ?? 0}
        date={rateSheet?.date ?? todayISO()}
        currencyCode={rateSheet?.code}
        onSaved={() => {
          setRateSheet(null);
          void save();
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeCard: {
    width: '48%',
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 84,
    justifyContent: 'center',
  },
  typeCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  typeCardText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  typeCardTextActive: {
    fontFamily: fonts.bodyBold,
    color: colors.accent,
  },
  pressed: { opacity: 0.85 },

  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  partyValue: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  partyPlaceholder: { color: colors.muted },

  allocWrap: { gap: spacing.sm },
  allocLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  segBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  segText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  segTextActive: { fontFamily: fonts.bodyBold, color: colors.accent },
  noInvoices: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    lineHeight: 19,
  },

  catWrap: { gap: spacing.sm },
  bottomSpace: { height: spacing.lg },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
});
