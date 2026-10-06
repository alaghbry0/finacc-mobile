import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface ScanCameraProps {
  /** يُستدعى مرة واحدة لكل كود مقروء (مُحصَّن ضد التكرار المتواصل). */
  onScanned: (barcode: string) => void;
}

/**
 * كاميرا مسح الباركود (FR-01-03) — native فقط: CameraView من expo-camera
 * مع onBarcodeScanned، وطلب الإذن ورسالة واضحة عند الرفض.
 * على الويب يستبدلها ScanCamera.web.tsx (إدخال يدوي — قرار بيئة معلَّق في worklog).
 */
export function ScanCamera({ onScanned }: ScanCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const lockRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (permission === null || !permission.granted) {
    return (
      <View style={s.permission}>
        <Text style={s.permissionText}>{t.scanCameraFailed}</Text>
      </View>
    );
  }

  return (
    <View style={s.cameraWrap}>
      <CameraView
        style={s.camera}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'code128', 'code39', 'qr', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => {
          if (lockRef.current || !data) return;
          lockRef.current = true;
          onScanned(data);
          // إعادة التفعيل بعد مهلة قصيرة (يسمح بمسح كود آخر بعد عودة الشيت)
          setTimeout(() => {
            lockRef.current = false;
          }, 1500);
        }}
      />
      <View style={s.frame} pointerEvents="none" />
      <Text style={s.hint}>{t.scanCameraHint}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  cameraWrap: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  camera: {
    width: '100%',
    height: 260,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  frame: {
    position: 'absolute',
    top: spacing.lg,
    alignSelf: 'center',
    width: 220,
    height: 110,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  permission: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  permissionText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.warning,
    textAlign: 'center',
    lineHeight: 20,
  },
});
