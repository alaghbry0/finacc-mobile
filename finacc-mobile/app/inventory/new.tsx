import { router } from 'expo-router';
import { Screen } from '@/components';
import { inventory as t } from '@/i18n/ar';
import { ProductForm } from '@/screens/inventory/ProductForm';

/** إضافة صنف جديد (FR-01-01) — النموذج المشترك. */
export default function NewProductScreen() {
  return (
    <Screen title={t.newTitle} onBack={() => router.back()}>
      <ProductForm mode="create" onSaved={() => router.back()} />
    </Screen>
  );
}
