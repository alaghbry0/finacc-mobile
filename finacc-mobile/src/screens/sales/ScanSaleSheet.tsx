import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from 'react-native';
import { ScanBarcode } from 'lucide-react-native';
import { BottomSheet } from '@/components';
import { ScanCamera } from '@/screens/inventory/ScanCamera';
import { common, sales as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ScanSaleSheetProps {
  visible: boolean;
  onClose: () => void;
  /** عند قراءة باركود (يبقى الشيت مفتوحاً للمسح المتتابع — الكمية 1 لكل مسحة). */
  onFound: (barcode: string) => void;
}

/**
 * شيت مسح الباركود في شاشة البيع (FR-02-02):
 * native → كاميرا مدمجة (بلا مغادرة الشاشة) • web → إدخال يدوي autoFocus
 * يُعاد التركيز إليه بعد كل إضافة (سلوك الأداء §6.5).
 */
export function ScanSaleSheet({ visible, onClose, onFound }: ScanSaleSheetProps) {
  const [manual, setManual] = useState('');
  const inputRef = useRef<TextInput>(null);
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (visible) {
      setManual('');
      // إعادة التركيز بعد فتح الشيت (لوحة النظام لا تُستخدم إلا هنا للحلقة اليدوية)
      setTimeout(() => inputRef.current?.focus(), 250);
    }
  }, [visible]);

  const submitManual = () => {
    const code = manual.trim();
    if (code === '') return;
    setManual('');
    onFound(code);
    inputRef.current?.focus();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={common.scanBarcode}>
      <View style={s.body}>
        {isWeb ? null : <ScanCamera onScanned={onFound} />}
        <View style={s.manualWrap}>
          <Text style={s.manualLabel}>{t.itemPickerSearch}</Text>
          <View style={s.manualRow}>
            <TextInput
              ref={inputRef}
              value={manual}
              onChangeText={setManual}
              placeholder="0000000000000"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
              accessibilityLabel={common.scanBarcode}
              style={s.manualInput}
              onSubmitEditing={submitManual}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={common.add}
              onPress={submitManual}
              style={({ pressed }) => [s.addBtn, pressed && s.pressed]}
            >
              <ScanBarcode size={22} color={colors.bg} strokeWidth={2.4} />
              <Text style={s.addBtnText}>{common.add}</Text>
            </Pressable>
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
  manualWrap: { gap: spacing.sm },
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  addBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.bg,
  },
  pressed: { opacity: 0.85 },
});
