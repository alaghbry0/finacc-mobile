import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components';
import { PartyForm, toSupplierInput, type PartyFormValues } from '@/components/party/PartyForm';
import { createSupplier } from '@/domain/parties';
import { common, parties as partiesAr } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, spacing } from '@/theme';

/** مورّد جديد (FR-03-03): نفس النموذج بلا حد ائتمان — الرصيد دائن مستحق. */
export default function NewSupplierScreen() {
  const showToast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: PartyFormValues) => {
    setBusy(true);
    setError(null);
    try {
      await createSupplier(toSupplierInput(values));
      showToast(partiesAr.savedToast);
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={partiesAr.newSupplier} onBack={() => router.back()}>
      <PartyForm kind="supplier" submitLabel={common.save} busy={busy} onSubmit={(v) => void submit(v)} />
      {error !== null ? <Text style={s.error}>{error}</Text> : null}
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
