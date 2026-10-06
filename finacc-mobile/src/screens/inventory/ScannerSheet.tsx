import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, PrimaryButton } from '@/components';
import { inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { ScanCamera } from './ScanCamera';

interface ScannerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** عند العثور على صنف بباركوده (أو إبلاغ عن عدم وجوده). */
  onFound: (barcode: string) => void;
}

/**
 * شيت مسح الباركود (FR-01-03):
 * - native: كاميرا CameraView مع onBarcodeScanned (تفتح الصنف فوراً).
 * - web: حقل إدخال يدوي + زر (الكاميرا غير متاحة في المعاينة الثابتة).
 */
export function ScannerSheet({ visible, onClose, onFound }: ScannerSheetProps) {
  const [manual, setManual] = useState('');
  const isWeb = Platform.OS === 'web';

  const submitManual = () => {
    const code = manual.trim();
    if (code === '') return;
    setManual('');
    onFound(code);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.scanTitle}>
      <View style={s.body}>
        {isWeb ? null : <ScanCamera onScanned={onFound} />}
        <View style={s.manualWrap}>
          <Text style={s.manualLabel}>{t.scanManualPlaceholder}</Text>
          <View style={s.manualRow}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder={t.scanManualPlaceholder}
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel={t.scanManualPlaceholder}
              style={s.manualInput}
              onSubmitEditing={submitManual}
            />
            <PrimaryButton label={t.scanManualOpen} onPress={submitManual} style={s.manualBtn} />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  manualWrap: {
    gap: spacing.sm,
  },
  manualLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  manualRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  manualInput: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontFamily: fonts.numeric,
    fontSize: fontSizes.body,
    textAlign: 'right',
  },
  manualBtn: {
    minWidth: 120,
  },
});
