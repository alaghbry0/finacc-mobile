import { useEffect } from 'react';
import { router } from 'expo-router';

/** تحويل قديم — إعدادات الطباعة الحقيقية في /settings/printing (منذ الموجة 6). */
export default function PrintingRedirect() {
  useEffect(() => {
    router.replace('/settings/printing');
  }, []);
  return null;
}
