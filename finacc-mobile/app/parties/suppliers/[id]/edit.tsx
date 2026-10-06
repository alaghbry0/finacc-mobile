import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, LoadingSkeleton, Screen } from '@/components';
import { PartyForm, toSupplierInput, valuesFromSupplier, type PartyFormValues } from '@/components/party/PartyForm';
import { getSupplier, updateSupplier } from '@/domain/parties';
import { common, parties as partiesAr } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';

/** تعديل مورّد — النموذج الموحّد معبأ بالقيم الحالية. */
export default function EditSupplierScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const showToast = useToastStore((s) => s.show);
  const [initial, setInitial] = useState<PartyFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const row = await getSupplier(id);
        if (!alive) return;
        if (row === null) {
          setError(partiesAr.noBalancesTitle);
          return;
        }
        setInitial(valuesFromSupplier(row));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const submit = async (values: PartyFormValues) => {
    setBusy(true);
    try {
      await updateSupplier(id, toSupplierInput(values));
      showToast(partiesAr.savedToast);
      router.back();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={partiesAr.editSupplier} onBack={() => router.back()}>
      {initial !== null ? (
        <PartyForm kind="supplier" initial={initial} submitLabel={common.save} busy={busy} onSubmit={(v) => void submit(v)} />
      ) : error !== null ? (
        <EmptyState title={common.errorTitle} message={error} actionLabel={common.retry} onAction={() => router.back()} />
      ) : (
        <LoadingSkeleton variant="card" />
      )}
    </Screen>
  );
}
