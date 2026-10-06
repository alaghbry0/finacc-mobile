import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import {
  AmountText,
  BottomSheet,
  DateField,
  PrimaryButton,
  QtyStepper,
  SelectField,
  type SelectOption,
} from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { common, installments as t, fill } from '@/i18n/ar';
import { createInstallmentPlan } from '@/domain/installments';
import { listCashboxOptions, type CashboxOptionRow } from '@/domain/cash';
import { getDb } from '@/db/client';
import { useToastStore } from '@/store/toast';
import { dec, money, roundTo } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface PlanFormSheetProps {
  visible: boolean;
  onClose: () => void;
  invoiceId: number;
  /** عملة الفاتورة — الخطة بعملتها حصراً. */
  currencyId: number;
  currencyCode: string;
  currencyDecimals: number;
  invoiceNo?: string | null;
  /** يُستدعى بعد إنشاء ناجح (الشيت يُغلق). */
  onCreated?: (planId: number) => void;
}

/** سطر معاينة الجدول. */
interface PreviewRow {
  seq: number;
  dueDate: string;
  amount: string;
}

/** زيادة شهر/أسبوع على ISO (نفس منطق توليد الدومين). */
function addMonths(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * PlanFormSheet (§6.5 InstallmentPlanForm): عدد الأقساط + دفعة أولى (≤ القابل
 * للتقسيط) + أول استحقاق + دورية + **معاينة الجدول بمحاكاة محلية** بنفس قاعدة
 * الدومين (أقساط متساوية مقربة والفرق على الأخير) — بلا أي كتابة قبل «إنشاء الخطة».
 */
export function PlanFormSheet({
  visible,
  onClose,
  invoiceId,
  currencyId,
  currencyCode,
  currencyDecimals,
  invoiceNo,
  onCreated,
}: PlanFormSheetProps) {
  const showToast = useToastStore((st) => st.show);

  const [openAmount, setOpenAmount] = useState('0');
  const [months, setMonths] = useState('4');
  const [downPayment, setDownPayment] = useState('');
  const [firstDue, setFirstDue] = useState<string>(todayISO());
  const [cycle, setCycle] = useState<'monthly' | 'weekly'>('monthly');

  const [boxes, setBoxes] = useState<CashboxOptionRow[]>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [busy, setBusy] = useState(false);

  // المتاح الفعلي = due_amount − التخصيصات غير الملغاة (قراءة عرض فقط)
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void (async () => {
      try {
        const db = await getDb();
        const dueRows = await db.all<{ due_amount: string | number }>('SELECT due_amount FROM invoice WHERE id = ?', [
          invoiceId,
        ]);
        const allocRows = await db.all<{ a: string | number | null }>(
          'SELECT COALESCE(SUM(pa.allocated_amount), 0) AS a FROM payment_allocation pa ' +
            'JOIN cash_tx t ON t.id = pa.cash_tx_id AND t.is_voided = 0 WHERE pa.invoice_id = ?',
          [invoiceId],
        );
        const open = dec(dueRows[0]?.due_amount ?? 0).minus(dec(allocRows[0]?.a ?? 0));
        const boxList = await listCashboxOptions();
        if (!alive) return;
        setOpenAmount(money(open));
        setBoxes(boxList);
        const match = boxList.find((b) => b.currencyId === currencyId);
        if (match !== undefined) setCashboxId((prev) => (prev === '' ? String(match.id) : prev));
      } catch {
        /* يظهر خطأ عند الحفظ */
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, invoiceId, currencyId]);

  const down = downPayment === '' ? dec(0) : dec(downPayment);
  const overDown = down.greaterThan(dec(openAmount));
  const principal = dec(openAmount).minus(down);

  // المعاينة — نفس قاعدة الدومين حرفياً بلا أي استدعاء كتابة
  const preview: PreviewRow[] = useMemo(() => {
    const n = Number(months);
    if (!Number.isFinite(n) || n < 1 || principal.lessThanOrEqualTo(0)) return [];
    const each = roundTo(principal.div(n), currencyDecimals);
    if (each.lessThanOrEqualTo(0)) return [];
    const rows: PreviewRow[] = [];
    for (let k = 0; k < n; k++) {
      const amount = k === n - 1 ? principal.minus(each.times(n - 1)) : each;
      rows.push({
        seq: k + 1,
        dueDate: cycle === 'weekly' ? addDays(firstDue, 7 * k) : addMonths(firstDue, k),
        amount: money(amount),
      });
    }
    return rows;
  }, [months, principal, firstDue, cycle, currencyDecimals]);

  const hasDown = down.greaterThan(0);
  const canCreate =
    !busy &&
    principal.greaterThan(0) &&
    !overDown &&
    months !== '' &&
    Number(months) >= 1 &&
    Number(months) <= 120 &&
    firstDue.length > 0 &&
    (!hasDown || cashboxId !== '');

  const create = useCallback(async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const res = await createInstallmentPlan({
        invoiceId,
        months: Number(months),
        downPayment: hasDown ? downPayment : undefined,
        firstDue,
        cycle,
        cashboxId: hasDown ? Number(cashboxId) : undefined,
      });
      showToast(t.planCreatedToast);
      onClose();
      onCreated?.(res.planId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  }, [canCreate, invoiceId, months, hasDown, downPayment, firstDue, cycle, cashboxId, showToast, onClose, onCreated]);

  const boxOptions: SelectOption[] = boxes
    .filter((b) => b.currencyId === currencyId)
    .map((b) => ({ value: String(b.id), label: `${b.name} (${b.currencyCode})` }));

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.newPlanTitle} dismissible={!busy} maxHeightRatio={0.94}>
      <View style={s.body}>
        <Text style={s.invoiceTag}>
          {fill(t.planOfInvoice, { no: invoiceNo ?? '' })} · {currencyCode}
        </Text>

        {/* القابل للتقسيط */}
        <View style={s.openRow}>
          <Text style={s.openLabel}>{t.formAmountToPlan}</Text>
          <AmountText value={openAmount} decimals={2} tone="neutral" mark="none" size={fontSizes.title} suffix={currencyCode} />
        </View>

        {/* عدد الأقساط */}
        <View style={s.fieldRow}>
          <Text style={s.fieldLabel}>{t.formMonthsLabel}</Text>
          <QtyStepper value={months} onChange={setMonths} min="1" max="120" />
        </View>

        {/* الدفعة الأولى */}
        <AmountPadField
          label={t.formDownPaymentLabel}
          value={downPayment}
          onValue={setDownPayment}
          suffix={currencyCode}
          hint={overDown ? fill(t.formDownOver, { max: openAmount }) : t.formDownPaymentHint}
        />
        {hasDown ? (
          <SelectField
            label={t.formCashboxLabel}
            value={cashboxId}
            options={boxOptions}
            onSelect={setCashboxId}
            required
            hint={boxOptions.length === 0 ? t.noMatchingBox : undefined}
          />
        ) : null}

        {/* أول استحقاق + الدورية */}
        <DateField label={t.formFirstDueLabel} value={firstDue} onChange={setFirstDue} required />
        <View style={s.fieldRow}>
          <Text style={s.fieldLabel}>{t.formCycleLabel}</Text>
          <View style={s.segment}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: cycle === 'monthly' }}
              onPress={() => setCycle('monthly')}
              style={[s.segBtn, cycle === 'monthly' && s.segBtnActive]}
            >
              <Text style={[s.segText, cycle === 'monthly' && s.segTextActive]}>{t.monthlyCycle}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: cycle === 'weekly' }}
              onPress={() => setCycle('weekly')}
              style={[s.segBtn, cycle === 'weekly' && s.segBtnActive]}
            >
              <Text style={[s.segText, cycle === 'weekly' && s.segTextActive]}>{t.weeklyCycle}</Text>
            </Pressable>
          </View>
        </View>

        {/* معاينة الجدول */}
        <View style={s.previewHead}>
          <Text style={s.previewTitle}>{t.formPreviewTitle}</Text>
          <Text style={s.previewNote}>{t.formPreviewNote}</Text>
        </View>
        {preview.length === 0 ? (
          <Text style={s.previewEmpty}>{t.formPreviewEmpty}</Text>
        ) : (
          <View style={s.previewTable}>
            <View style={s.previewTrHead}>
              <Text style={[s.previewTh, { width: 34 }]}>{t.colSeq}</Text>
              <Text style={[s.previewTh, { flex: 1 }]}>{t.colDue}</Text>
              <Text style={[s.previewTh, { flex: 1 }]}>{t.colAmount}</Text>
            </View>
            {preview.map((r, i) => (
              <View key={r.seq} style={[s.previewTr, i < preview.length - 1 && s.previewDivider]}>
                <Text style={[s.previewTd, s.previewTdMono, { width: 34 }]}>{r.seq}</Text>
                <Text style={[s.previewTd, s.previewTdDate]}>{r.dueDate}</Text>
                <Text style={[s.previewTd, s.previewTdMono, s.previewTdAmount]}>{r.amount}</Text>
              </View>
            ))}
          </View>
        )}

        <PrimaryButton label={t.formSave} onPress={() => void create()} loading={busy} disabled={!canCreate} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  invoiceTag: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
    textAlign: 'center',
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.extra.accentSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  openLabel: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  fieldLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
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
  },
  segTextActive: { fontFamily: fonts.bodyBold, color: colors.accent },
  previewHead: { gap: 2, marginTop: spacing.xs },
  previewTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  previewNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
  },
  previewEmpty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    lineHeight: 19,
  },
  previewTable: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  previewTrHead: {
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  previewTh: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  previewTr: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 7,
  },
  previewDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(51, 65, 85, 0.5)' },
  previewTd: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  previewTdMono: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  previewTdDate: { direction: 'ltr', flex: 1 },
  previewTdAmount: { flex: 1 },
});
