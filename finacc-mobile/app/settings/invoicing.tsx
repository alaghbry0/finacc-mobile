import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import {
  AppCard,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SectionTitle,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import { common, settings as t } from '@/i18n/ar';
import { getDb } from '@/db/client';
import { getSettings, setSetting } from '@/domain/settings';
import { logAudit } from '@/domain/audit';
import { useToastStore } from '@/store/toast';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

const DOC_TYPES = ['INV', 'PUR', 'SRN', 'PRN', 'RVT', 'PMT'] as const;

/** حالة نوع مستند واحد في قسم الترقيم. */
interface DocNumberingRow {
  docType: (typeof DOC_TYPES)[number];
  start: string;
  locked: boolean;
}

/**
 * إعدادات الفوترة (FR-13-02):
 * - الترقيم (قرار 6): بادئة INV من company.invoice_prefix — تُقرأ فقط قبل أول
 *   فاتورة، ورقم البداية لكل نوع مستند قبل أول استهلاك (doc_sequence يُزرع بقيمة
 *   البداية−1 فأول مستند يبدأ منها). التحديث بعد الإصدار معطل دائماً.
 * - السلوكيات: مفاتيح سجل الملحق هـ حرفياً عبر getSettings/setSetting.
 */
export default function InvoicingSettingsScreen() {
  const showToast = useToastStore((s) => s.show);
  const [loading, setLoading] = useState(true);
  const [savingNum, setSavingNum] = useState(false);

  const [prefix, setPrefix] = useState('INV');
  const [prefixLocked, setPrefixLocked] = useState(false);
  const [numbering, setNumbering] = useState<DocNumberingRow[]>([]);

  const [taxMode, setTaxMode] = useState('on_total');
  const [discountMargin, setDiscountMargin] = useState('off');
  const [printOnSave, setPrintOnSave] = useState('ask');
  const [paymentSheet, setPaymentSheet] = useState('on');
  const [overAvail, setOverAvail] = useState('warn');
  const [creditLimit, setCreditLimit] = useState('warn');
  const [backdateDays, setBackdateDays] = useState('30');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const company = await db.all<{ invoice_prefix: string | null }>(
        'SELECT invoice_prefix FROM company LIMIT 1',
      );
      setPrefix((company[0]?.invoice_prefix ?? 'INV') || 'INV');
      // القفل: أي استهلاك لأرقام INV (صف في doc_sequence) يعني أن البادئة مُثبتة
      const seqRows = await db.all<{ doc_type: string }>('SELECT DISTINCT doc_type FROM doc_sequence');
      const consumed = new Set(seqRows.map((r) => String(r.doc_type)));
      setPrefixLocked(consumed.has('INV') || consumed.has('SRN'));
      setNumbering(
        DOC_TYPES.map((dt) => ({
          docType: dt,
          start: '1',
          locked: consumed.has(dt),
        })),
      );
      const settings = await getSettings();
      setTaxMode(settings['invoicing.tax_mode']);
      setDiscountMargin(settings['invoicing.discount_below_margin']);
      setPrintOnSave(settings['invoicing.print_on_save']);
      setPaymentSheet(settings['invoicing.payment_sheet']);
      setOverAvail(settings['sale.over_avail_policy']);
      setCreditLimit(settings['parties.credit_limit_action']);
      setBackdateDays(settings['dating.max_backdate_days']);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** حفظ إعداد سلوكي فور اختياره (سجل الملحق هـ). */
  const persist = useCallback(
    async (label: string, key: Parameters<typeof setSetting>[0], value: string, setter: (v: string) => void) => {
      setter(value);
      try {
        await setSetting(key, value);
        showToast(t.settingsSaved);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.settingsSaveFailed, { duration: 7000 });
      }
    },
    [showToast],
  );

  /** تطبيق البادئة وأرقام البداية (يُقبل فقط قبل أول مستند من نوعه). */
  const applyNumbering = useCallback(async () => {
    if (savingNum) return;
    const cleanPrefix = prefix.trim().toUpperCase().slice(0, 8);
    if (cleanPrefix.length === 0) {
      showToast('بادئة الترقيم مطلوبة (مثال: INV)');
      return;
    }
    for (const row of numbering) {
      if (row.locked) continue;
      if (!/^\d+$/.test(row.start) || Number(row.start) < 1) {
        showToast(t.startNumberInvalid);
        return;
      }
    }
    setSavingNum(true);
    try {
      const db = await getDb();
      const year = Number(todayISO().slice(0, 4));
      await db.transaction(async () => {
        if (!prefixLocked) {
          await db.run('UPDATE company SET invoice_prefix = ?, updated_at = ?', [
            cleanPrefix,
            new Date().toISOString(),
          ]);
        }
        for (const row of numbering) {
          if (row.locked) continue;
          // يُزرع فقط إن لم يُستهلك رقم من النوع — وإلا تُرفض القيمة صامتة (INSERT OR IGNORE)
          await db.run('INSERT OR IGNORE INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, ?)', [
            row.docType,
            year,
            Number(row.start) - 1,
          ]);
        }
        await logAudit('settings_update', {
          entity: 'doc_sequence',
          details: { prefix: prefixLocked ? undefined : cleanPrefix, startNumbers: true },
        });
      });
      showToast(t.startNumberApplied);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.settingsSaveFailed, { duration: 7000 });
    } finally {
      setSavingNum(false);
    }
  }, [prefix, prefixLocked, numbering, savingNum, load, showToast]);

  if (loading) {
    return (
      <Screen title={t.invoicingTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton rows={5} />
      </Screen>
    );
  }

  const taxModeOptions: SelectOption[] = [
    { value: 'on_total', label: t.taxModeOnTotal },
    { value: 'per_item', label: t.taxModePerItem },
  ];
  const marginOptions: SelectOption[] = [
    { value: 'off', label: t.discountMarginOff },
    { value: 'warn', label: t.discountMarginWarn },
    { value: 'block', label: t.discountMarginBlock },
  ];
  const printOnSaveOptions: SelectOption[] = [
    { value: 'ask', label: t.printOnSaveAsk },
    { value: 'print', label: t.printOnSavePrint },
    { value: 'no', label: t.printOnSaveNo },
  ];
  const overAvailOptions: SelectOption[] = [
    { value: 'warn', label: t.overAvailWarn },
    { value: 'add_available', label: t.overAvailAddAvailable },
  ];
  const creditLimitOptions: SelectOption[] = [
    { value: 'warn', label: t.creditLimitWarn },
    { value: 'block', label: t.creditLimitBlock },
  ];

  return (
    <Screen title={t.invoicingTitle} onBack={() => router.back()}>
      <SectionTitle title={t.sectionNumbering} />
      <AppCard>
        <View style={prefixLocked ? s.lockedWrap : undefined}>
          <TextField
            label={t.prefixLabel}
            value={prefix}
            onChangeText={setPrefix}
            hint={t.prefixHint}
            maxLength={8}
          />
        </View>
        {prefixLocked ? (
          <View style={s.lockedBanner}>
            <Lock size={16} color={colors.warning} />
            <Text style={s.lockedText}>{t.prefixLocked}</Text>
          </View>
        ) : null}

        {numbering.map((row) => (
          <View key={row.docType} style={s.numberRow}>
            <Text style={s.numberLabel}>{t.docTypeLabels[row.docType] ?? row.docType}</Text>
            {row.locked ? (
              <View style={s.lockedStart}>
                <Lock size={14} color={colors.muted} />
                <Text style={s.lockedStartText}>{t.startNumberLocked}</Text>
              </View>
            ) : (
              <TextField
                label={t.startNumberLabel}
                value={row.start}
                onChangeText={(v) =>
                  setNumbering((prev) =>
                    prev.map((r) => (r.docType === row.docType ? { ...r, start: v.replace(/[^\d]/g, '') } : r)),
                  )
                }
                keyboardType="numeric"
                maxLength={6}
                style={s.startInput}
                hint={t.startNumberHint}
              />
            )}
          </View>
        ))}
        <PrimaryButton label={t.startNumberApply} onPress={() => void applyNumbering()} disabled={savingNum} />
      </AppCard>

      <SectionTitle title={t.sectionBehavior} />
      <AppCard>
        <SelectField
          label={t.taxModeLabel}
          value={taxMode}
          options={taxModeOptions}
          onSelect={(v) => void persist(t.taxModeLabel, 'invoicing.tax_mode', v, setTaxMode)}
        />
        <SelectField
          label={t.discountMarginLabel}
          value={discountMargin}
          options={marginOptions}
          onSelect={(v) => void persist(t.discountMarginLabel, 'invoicing.discount_below_margin', v, setDiscountMargin)}
        />
        <SelectField
          label={t.printOnSaveLabel}
          value={printOnSave}
          options={printOnSaveOptions}
          onSelect={(v) => void persist(t.printOnSaveLabel, 'invoicing.print_on_save', v, setPrintOnSave)}
        />
        <View style={s.switchRow}>
          <View style={s.switchText}>
            <Text style={s.switchLabel}>{t.paymentSheetLabel}</Text>
          </View>
          <Switch
            value={paymentSheet === 'on'}
            onValueChange={(v) => void persist(t.paymentSheetLabel, 'invoicing.payment_sheet', v ? 'on' : 'off', setPaymentSheet)}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
        <SelectField
          label={t.overAvailLabel}
          value={overAvail}
          options={overAvailOptions}
          onSelect={(v) => void persist(t.overAvailLabel, 'sale.over_avail_policy', v, setOverAvail)}
        />
        <SelectField
          label={t.creditLimitLabel}
          value={creditLimit}
          options={creditLimitOptions}
          onSelect={(v) => void persist(t.creditLimitLabel, 'parties.credit_limit_action', v, setCreditLimit)}
        />
        <TextField
          label={t.backdateLabel}
          value={backdateDays}
          onChangeText={setBackdateDays}
          keyboardType="numeric"
          maxLength={3}
        />
      </AppCard>
    </Screen>
  );
}

const s = StyleSheet.create({
  lockedWrap: { borderRadius: 12 },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.extra.warningSoft,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  lockedText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    lineHeight: 18,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  numberLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  startInput: {
    width: 140,
  },
  lockedStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: 150,
  },
  lockedStartText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 14,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  switchText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  switchLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
});
