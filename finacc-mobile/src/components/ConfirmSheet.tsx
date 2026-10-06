import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { DangerButton, SecondaryButton } from './buttons';
import { common, fill } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  /** ينفَّذ عند تأكيد المستخدم (الشيت لا يغلق تلقائيًا — أغلقه أنت عند اكتمال العمل) */
  onConfirm: () => void;
  title: string;
  message: string;
  /** كلمة التأكيد المحرَّضة للأخطار الكبرى (مثال: «إلغاء» / «استعادة») — DS-27 */
  requireText?: string;
  confirmLabel?: string;
  busy?: boolean;
}

/**
 * ConfirmSheet (DS-27): BottomSheet تأكيد خطر — وصف + كلمة تأكيد محددة
 * يكتبها المستخدم لتفعيل زر التنفيذ (requireText) للأخطار الكبرى.
 */
export function ConfirmSheet({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  requireText,
  confirmLabel,
  busy = false,
}: ConfirmSheetProps) {
  const [typed, setTyped] = useState('');
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    if (!visible) {
      setTyped('');
      setMismatch(false);
    }
  }, [visible]);

  const matches = requireText === undefined || typed.trim() === requireText;
  const canConfirm = !busy && matches;

  const handleConfirm = () => {
    if (!matches) {
      setMismatch(true);
      return;
    }
    onConfirm();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissible={!busy}>
      <View style={s.wrap}>
        <View style={s.iconWrap}>
          <AlertTriangle size={30} color={colors.error} />
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.message}>{message}</Text>

        {requireText !== undefined ? (
          <View style={s.requireBox}>
            <Text style={s.requireLabel}>{fill(common.typeWordToConfirm, { word: requireText })}</Text>
            <TextInput
              value={typed}
              onChangeText={(t) => {
                setTyped(t);
                setMismatch(false);
              }}
              placeholder={requireText}
              placeholderTextColor={colors.muted}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
              textAlign="center"
              style={[s.requireInput, mismatch && s.requireInputError]}
              accessibilityLabel={fill(common.typeWordToConfirm, { word: requireText })}
            />
            {mismatch ? <Text style={s.mismatch}>{common.typedWordMismatch}</Text> : null}
          </View>
        ) : null}

        <View style={s.buttons}>
          <DangerButton label={confirmLabel ?? common.confirm} onPress={handleConfirm} disabled={!canConfirm} loading={busy} />
          <SecondaryButton label={common.cancel} onPress={onClose} disabled={busy} />
        </View>
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
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  requireBox: {
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
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
  requireInputError: {
    borderColor: colors.error,
  },
  mismatch: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.error,
    textAlign: 'center',
  },
  buttons: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
