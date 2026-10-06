import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingSkeleton, Screen } from '@/components';
import { inventory as t } from '@/i18n/ar';
import { getProductFull, type ProductRowFull } from '@/domain/inventory';
import { ProductForm, type ProductFormValues } from '@/screens/inventory/ProductForm';

/** تعديل صنف — نفس النموذج المشترك بقيم الصنف الحالية (FR-01-14). */
export default function EditProductScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const productId = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const [full, setFull] = useState<ProductRowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const row = await getProductFull(productId);
      if (row === null) throw new Error(t.cardNotFound);
      setFull(row);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  let initial: ProductFormValues | null = null;
  if (full !== null) {
    const prices: Record<string, string> = {};
    for (const p of full.prices) prices[String(p.currencyId)] = p.price;
    initial = {
      name: full.name,
      barcode: full.barcode ?? '',
      categoryId: full.categoryId !== null ? String(full.categoryId) : null,
      unitId: full.unitId !== null ? String(full.unitId) : null,
      warehouseId: null,
      costPrice: full.costPrice === '0' ? '' : full.costPrice,
      minStock: full.minStock === '0' ? '' : full.minStock,
      isService: full.isService,
      notes: full.notes ?? '',
      openingQty: '',
      prices,
    };
  }

  return (
    <Screen title={t.editTitle} onBack={() => router.back()}>
      {loading ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : failed || initial === null ? (
        <ErrorState message={t.cardNotFoundHint} onRetry={load} />
      ) : (
        <ProductForm mode="edit" productId={productId} initial={initial} onSaved={() => router.back()} />
      )}
    </Screen>
  );
}
