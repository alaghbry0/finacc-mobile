import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { BottomSheet, DangerButton, TextField } from '@/components';
import { common, fill, invoices as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface VoidInvoiceSheetProps {
  visible: boolean;
  onClose: () => void;
  /** «INV-2026-001» أو نحوه — يظهر في نص التحذير. */
  docNo: string;
  busy?: boolean;
  /** ينفَّذ بكلمة التأكيد والسبب — الأصل يغلق الشيت عند اكتمال العمل. */
  onVoid: (reason: string) => void;
}

/**
 * إلغاء فاتورة (FR-02-15): تحذير + سبب إلزامي + كتابة كلمة «إلغاء» لتفعيل
 * الزر (نمط DS-27). مشترك بين تفاصيل البيع وتفاصيل الشراء.
 */
export function VoidInvoiceSheet({ visible, onClose, docNo, busy = false, onVoid }: VoidInvoiceSheetProps) {
  const [reason, setReason] = useState('');
  const [word, setWord] = useState('');
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    if (!visible) {
      setReason('');
      setWord('');
      setMismatch(false);
    }
  }, [visible]);

  const matches = word.trim() === t.voidWord;
  const canConfirm = !busy && matches && reason.trim().length > 0;

  const handleConfirm = () => {
    if (!matches) {
      setMismatch(true);
      return;
    }
    if (reason.trim().length === 0) return;
    onVoid(reason.trim());
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.voidTitle} dismissible={!busy}>
      <View style={s.wrap}>
        <View style={s.iconWrap}>
          <AlertTriangle size={30} color={colors.error} />
        </View>
        <Text style={s.message}>{t.voidMessage(docNo)}</Text>

        <TextField
          label={t.voidReasonLabel}
          value={reason}
          onChangeText={(v) => setReason(v)}
          placeholder={t.voidReasonPlaceholder}
          maxLength={200}
          disabled={busy}
          required
        />

        <View style={s.requireBox}>
          <Text style={s.requireLabel}>{fill(common.typeWordToConfirm, { word: t.voidWord })}</Text>
          <TextInput
            value={word}
            onChangeText={(v) => {
              setWord(v);
              setMismatch(false);
            }}
            placeholder={t.voidWord}
            placeholderTextColor={colors.muted}
            editable={!busy}
            autoCorrect={false}
            autoCapitalize="none"
            textAlign="center"
            style={[s.requireInput, mismatch && s.requireInputError]}
            accessibilityLabel={common.typeWordToConfirm}
          />
          {mismatch ? <Text style={s.mismatch}>{common.typedWordMismatch}</Text> : null}
          {reason.trim().length === 0 ? (
            <Text style={s.mismatch}>{common.requiredField}</Text>
          ) : null}
        </View>

        <DangerButton
          label={t.voidWord}
          onPress={handleConfirm}
          disabled={!canConfirm}
          loading={busy}
        />
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
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radii.lg,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  requireBox: { gap: spacing.sm },
  requireLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.warning,
    textAlign: 'center',
  },
  requireInput: {
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    color: colors.textPrimary,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    paddingHorizontal: spacing.md,
  },
  requireInputError: { borderColor: colors.error },
  mismatch: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.error,
    textAlign: 'center',
  },
});
