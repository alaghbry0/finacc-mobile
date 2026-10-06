import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, PrimaryButton, SecondaryButton, SelectField, type SelectOption } from '@/components';
import { common, printing as t } from '@/i18n/ar';
import { getPrintOptions, printInvoice, shareInvoiceViaWhatsApp } from '@/services/doc-print';
import { setSetting } from '@/domain/settings';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface InvoicePrintSheetProps {
  visible: boolean;
  onClose: () => void;
  kind: 'sale' | 'purchase';
  invoiceId: number;
  /** هاتف الطرف لواتساب (null → محادثة بلا رقم). */
  partyPhone: string | null;
}

/**
 * شيت الطباعة والمشاركة للفاتورة (الوحدة 10 — FR-10-01/02/05):
 * اختيار الورق (58/80/A4) والقالب (مختصر/مفصّل) من سجل الإعدادات printing.*
 * + معاينة وطباعة (نافذة الطباعة على الويب / نظام الطباعة على الجهاز)
 * + مشاركة واتساب برسالة نصية وPDF على الجهاز.
 */
export function InvoicePrintSheet({ visible, onClose, kind, invoiceId, partyPhone }: InvoicePrintSheetProps) {
  const showToast = useToastStore((s) => s.show);
  const [paper, setPaper] = useState('receipt80');
  const [detailed, setDetailed] = useState('off');
  const [busy, setBusy] = useState(false);

  // تحميل الإعدادات الحالية عند كل فتح
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void (async () => {
      try {
        const opts = await getPrintOptions();
        if (!alive) return;
        setPaper(opts.paper);
        setDetailed(opts.detailed ? 'on' : 'off');
      } catch {
        /* تبقى الافتراضيات */
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  const paperOptions: SelectOption[] = [
    { value: 'receipt58', label: t.paperReceipt58 },
    { value: 'receipt80', label: t.paperReceipt80 },
    { value: 'a4', label: t.paperA4 },
  ];
  const detailedOptions: SelectOption[] = [
    { value: 'off', label: t.detailedShort },
    { value: 'on', label: t.detailedFull },
  ];

  const changePaper = (value: string): void => {
    setPaper(value);
    void setSetting('printing.paper', value).catch(() => undefined);
  };
  const changeDetailed = (value: string): void => {
    setDetailed(value);
    void setSetting('printing.detailed', value).catch(() => undefined);
  };

  const doPrint = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await printInvoice(kind, invoiceId, { paper: paper as 'receipt58' | 'receipt80' | 'a4', detailed: detailed === 'on' });
      showToast(t.printDone);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.printFailed, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const doWhatsApp = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await shareInvoiceViaWhatsApp(kind, invoiceId, partyPhone);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.printFailed, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.sheetTitle} dismissible={!busy}>
      <View style={s.wrap}>
        <SelectField
          label={t.paperLabel}
          value={paper}
          options={paperOptions}
          onSelect={changePaper}
          hint={t.paperHint}
          disabled={busy}
        />
        <SelectField
          label={t.detailedLabel}
          value={detailed}
          options={detailedOptions}
          onSelect={changeDetailed}
          hint={t.detailedHint}
          disabled={busy}
        />
        <PrimaryButton label={busy ? t.printBusy : t.printNowAction} onPress={() => void doPrint()} disabled={busy} />
        <SecondaryButton label={t.whatsappAction} onPress={() => void doWhatsApp()} disabled={busy} />
        {partyPhone === null || partyPhone.length === 0 ? (
          <Text style={s.note}>{t.whatsappNoPhone}</Text>
        ) : null}
        <Text style={s.note}>{t.printSavedNote}</Text>
        <Text style={s.note}>{t.thermalNote}</Text>
        <SecondaryButton label={common.close} onPress={onClose} disabled={busy} height={44} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
});
