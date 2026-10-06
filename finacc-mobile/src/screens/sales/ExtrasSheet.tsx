import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, DateField, PrimaryButton, TextField } from '@/components';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';
import { sales as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ExtrasSheetProps {
  visible: boolean;
  onClose: () => void;
  currencyCode: string;
  issuedAt: string;
  onSetIssuedAt: (iso: string) => void;
  invoiceDiscount: string;
  onSetInvoiceDiscount: (v: string) => void;
  notesInternal: string;
  notesPrinted: string;
  onSetNotes: (internal: string, printed: string) => void;
  onSaveDraft: () => void;
  busy?: boolean;
}

/** «إضافات (…)» (LDR-1): تاريخ الفاتورة (ضمن حد التأريخ الرجعي) + خصم إجمالي + ملاحظتان + حفظ كمسودة. */
export function ExtrasSheet({
  visible,
  onClose,
  currencyCode,
  issuedAt,
  onSetIssuedAt,
  invoiceDiscount,
  onSetInvoiceDiscount,
  notesInternal,
  notesPrinted,
  onSetNotes,
  onSaveDraft,
  busy = false,
}: ExtrasSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.extrasTitle}>
      <View style={s.body}>
        <DateField label={t.invoiceDate} value={issuedAt} onChange={onSetIssuedAt} />
        <AmountPadField
          label={t.invoiceDiscount}
          value={invoiceDiscount === '0' ? '' : invoiceDiscount}
          onValue={(v) => onSetInvoiceDiscount(v === '' ? '0' : v)}
          suffix={currencyCode}
        />
        <TextField
          label={t.notesInternal}
          value={notesInternal}
          onChangeText={(v) => onSetNotes(v, notesPrinted)}
          multiline
          maxLength={500}
        />
        <TextField
          label={t.notesPrinted}
          value={notesPrinted}
          onChangeText={(v) => onSetNotes(notesInternal, v)}
          multiline
          maxLength={500}
        />
        <View style={s.draftHint}>
          <Text style={s.draftHintText}>المسودة بلا رقم ولا أثر مالي أو مخزوني حتى تحويلها لمكتملة.</Text>
        </View>
        <PrimaryButton label={t.saveDraft} onPress={onSaveDraft} loading={busy} disabled={busy} />
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
  draftHint: {
    padding: spacing.md,
    backgroundColor: colors.extra.mutedSoft,
    borderRadius: radii.md,
  },
  draftHintText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
