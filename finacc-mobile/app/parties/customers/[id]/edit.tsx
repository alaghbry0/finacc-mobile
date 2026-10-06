import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, LoadingSkeleton, Screen } from '@/components';
import { PartyForm, toCustomerInput, valuesFromCustomer, type PartyFormValues } from '@/components/party/PartyForm';
import { getCustomer, updateCustomer } from '@/domain/parties';
import { common, parties as partiesAr } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, spacing } from '@/theme';

/** تعديل عميل — النموذج الموحّد معبأ بالقيم الحالية. */
export default function EditCustomerScreen() {
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
        const row = await getCustomer(id);
        if (!alive) return;
        if (row === null) {
          setError(partiesAr.noBalancesTitle);
          return;
        }
        setInitial(valuesFromCustomer(row));
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
      await updateCustomer(id, toCustomerInput(values));
      showToast(partiesAr.savedToast);
      router.back();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={partiesAr.editCustomer} onBack={() => router.back()}>
      {initial !== null ? (
        <>
          <PartyForm kind="customer" initial={initial} submitLabel={common.save} busy={busy} onSubmit={(v) => void submit(v)} />
          {error !== null ? <Text style={s.error}>{error}</Text> : null}
        </>
      ) : error !== null ? (
        <EmptyState title={common.errorTitle} message={error} actionLabel={common.retry} onAction={() => router.back()} />
      ) : (
        <LoadingSkeleton variant="card" />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  error: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: 'center',
    paddingBottom: spacing.lg,
    lineHeight: 19,
  },
});
