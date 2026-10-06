import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import {
  AmountText,
  BottomSheet,
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
import { common, cheques as t, currency as cur } from '@/i18n/ar';
import { createCheque } from '@/domain/cheques';
import { listInvoices, type InvoiceListRow } from '@/domain/invoicing';
import { getBaseCurrency, listActiveCurrencies, MissingRateError, type CurrencyRow } from '@/domain/currency';
import { useToastStore } from '@/store/toast';
import { dec } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** شيك جديد (FR-14-01): وارد/صادر + طرف + مبلغ وعملة + استحقاق + فاتورة مرجعية اختيارية. */
export default function ChequeNewScreen() {
  const showToast = useToastStore((st) => st.show);

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partyName, setPartyName] = useState<string | null>(null);
  const [partySheet, setPartySheet] = useState(false);

  const [chequeNo, setChequeNo] = useState('');
  const [bankName, setBankName] = useState('');
  const [amount, setAmount] = useState('');

  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [currencyId, setCurrencyId] = useState('');

  const [issueDate, setIssueDate] = useState<string>(todayISO());
  const [dueDate, setDueDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState('');

  // فاتورة مرجعية اختيارية
  const [openInvoices, setOpenInvoices] = useState<InvoiceListRow[]>([]);
  const [refInvoiceId, setRefInvoiceId] = useState('');

  const [saving, setSaving] = useState(false);
  const [rateSheet, setRateSheet] = useState<{ currencyId: number; date: string } | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

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
        showToast(e instanceof Error ? e.message : common.errorGeneral);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showToast]);

  // فواتير الطرف الآجلة المفتوحة (مرجعية اختيارية)
  const loadOpenInvoices = useCallback(async () => {
    if (partyId === null) {
      setOpenInvoices([]);
      return;
    }
    try {
      const rows = await listInvoices({
        docType: direction === 'in' ? 'sale' : 'purchase',
        status: 'completed',
        customerId: direction === 'in' ? partyId : undefined,
        supplierId: direction === 'out' ? partyId : undefined,
        limit: 200,
      });
      setOpenInvoices(rows.filter((r) => r.payStatus !== 'cash' && dec(r.dueAmount).greaterThan(0)));
    } catch {
      setOpenInvoices([]);
    }
  }, [partyId, direction]);

  useEffect(() => {
    void loadOpenInvoices();
  }, [loadOpenInvoices]);

  const currency = currencies.find((c) => String(c.id) === currencyId);

  const currencyOptions: SelectOption[] = useMemo(
    () =>
      currencies.map((c) => ({
        value: String(c.id),
        label: `${c.code} — ${c.name}`,
        description: c.is_base === 1 ? cur.baseTag : undefined,
      })),
    [currencies],
  );

  const invoiceOptions: SelectOption[] = openInvoices.map((inv) => ({
    value: String(inv.id),
    label: inv.invoiceNo ?? `#${inv.id}`,
    description: `${chequesDue(inv.dueAmount)} ${inv.currencyCode} · ${inv.issuedAt}`,
  }));

  const canSave =
    !saving &&
    partyId !== null &&
    chequeNo.trim().length > 0 &&
    amount !== '' &&
    dec(amount).greaterThan(0) &&
    currencyId !== '' &&
    dueDate.length > 0;

  // ---- الحفظ ----
  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = await createCheque({
        direction,
        partyType: direction === 'in' ? 'customer' : 'supplier',
        partyId: partyId as number,
        chequeNo: chequeNo.trim(),
        bankName: bankName.trim().length > 0 ? bankName.trim() : undefined,
        amount,
        currencyId: Number(currencyId),
        issueDate,
        dueDate,
        refInvoiceId: refInvoiceId !== '' ? Number(refInvoiceId) : null,
        notes: notes.trim().length > 0 ? notes.trim() : undefined,
      });
      showToast(t.createdToast);
      router.replace(`/cash/cheques/${id}`);
    } catch (e) {
      if (e instanceof MissingRateError) {
        setRateSheet({ currencyId: e.currencyId, date: e.date });
        retryRef.current = () => save();
        return;
      }
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setSaving(false);
    }
  }, [canSave, direction, partyId, chequeNo, bankName, amount, currencyId, issueDate, dueDate, refInvoiceId, notes, showToast]);

  return (
    <Screen
      title={t.newTitle}
      onBack={() => router.back()}
      footer={<PrimaryButton label={common.save} onPress={() => void save()} loading={saving} disabled={!canSave} />}
    >
      {/* الاتجاه */}
      <SectionTitle title={t.directionLabel} />
      <View style={s.segment}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: direction === 'in' }}
          onPress={() => setDirection('in')}
          style={[s.dirCard, direction === 'in' && s.dirCardActive]}
        >
          <ArrowDownLeft size={26} color={colors.success} strokeWidth={2.3} />
          <View style={s.dirText}>
            <Text style={[s.dirTitle, direction === 'in' && s.dirTitleActive]}>{t.directionIn}</Text>
            <Text style={s.dirDesc}>{t.directionInDesc}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: direction === 'out' }}
          onPress={() => setDirection('out')}
          style={[s.dirCard, direction === 'out' && s.dirCardActive]}
        >
          <ArrowUpRight size={26} color={colors.error} strokeWidth={2.3} />
          <View style={s.dirText}>
            <Text style={[s.dirTitle, direction === 'out' && s.dirTitleActive]}>{t.directionOut}</Text>
            <Text style={s.dirDesc}>{t.directionOutDesc}</Text>
          </View>
        </Pressable>
      </View>

      {/* الطرف */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.partyLabel}
        onPress={() => setPartySheet(true)}
        style={({ pressed }) => [s.partyRow, pressed && s.dirPressed]}
      >
        <Text style={s.partyRowLabel}>{direction === 'in' ? t.fromCustomer : t.toSupplier}</Text>
        <Text style={[s.partyRowValue, partyId === null && s.partyRowEmpty]} numberOfLines={1}>
          {partyName ?? t.partyLabel}
        </Text>
      </Pressable>

      {/* الحقول */}
      <TextField label={t.chequeNoLabel} value={chequeNo} onChangeText={setChequeNo} maxLength={40} required placeholder="123456" />
      <TextField label={t.bankNameLabel} value={bankName} onChangeText={setBankName} maxLength={80} placeholder={t.bankPlaceholder} />
      <AmountPadField label={t.amountLabel} value={amount} onValue={setAmount} suffix={currency?.code} required />
      <SelectField label={t.currencyLabel} value={currencyId} options={currencyOptions} onSelect={setCurrencyId} required hint={cur.pickHint} />
      <DateField label={t.issueDateLabel} value={issueDate} onChange={setIssueDate} />
      <DateField label={t.dueDateLabel} value={dueDate} onChange={setDueDate} required hint={t.dueDateHint} />

      {/* فاتورة مرجعية اختيارية */}
      {openInvoices.length > 0 ? (
        <SelectField
          label={t.refInvoiceLabel}
          value={refInvoiceId}
          options={invoiceOptions}
          onSelect={setRefInvoiceId}
          hint={t.refInvoiceHint}
        />
      ) : null}

      <TextField label={t.notesLabel} value={notes} onChangeText={setNotes} maxLength={200} multiline />

      <View style={s.bottomSpace} />

      {/* شيتات */}
      <PartyPickerSheet
        visible={partySheet}
        onClose={() => setPartySheet(false)}
        kind={direction === 'in' ? 'customer' : 'supplier'}
        selectedName={partyName}
        onPick={(p) => {
          setPartyId(p.id);
          setPartyName(p.name);
          setRefInvoiceId('');
        }}
      />

      <DailyRateSheet
        visible={rateSheet !== null}
        onClose={() => setRateSheet(null)}
        currencyId={rateSheet?.currencyId ?? 0}
        date={rateSheet?.date ?? todayISO()}
        currencyCode={currency?.code}
        onSaved={() => {
          setRateSheet(null);
          const retry = retryRef.current;
          retryRef.current = null;
          if (retry !== null) void retry();
        }}
      />
    </Screen>
  );
}

function chequesDue(due: string): string {
  return due;
}

const s = StyleSheet.create({
  segment: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  dirCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 76,
  },
  dirCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.extra.accentSoft,
  },
  dirPressed: { opacity: 0.85 },
  dirText: { flex: 1, gap: 2 },
  dirTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  dirTitleActive: { color: colors.accent },
  dirDesc: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  partyRowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  partyRowValue: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  partyRowEmpty: { color: colors.muted, fontFamily: fonts.bodyMedium },
  bottomSpace: { height: spacing.lg },
});
