import { useCallback, useRef, useState } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { EmptyState, Screen } from '@/components';
import { PartyProfile } from '@/components/party/PartyProfile';
import { common, parties as partiesAr } from '@/i18n/ar';

/** ملف المورّد — نفس بنية العميل (FR-03-03) بلا حد ائتمان. */
export default function SupplierProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const [reloadKey, setReloadKey] = useState(0);
  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setReloadKey((k) => k + 1);
    }, []),
  );

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <Screen title={partiesAr.supplierFile} onBack={() => router.back()} scroll={false}>
        <EmptyState title={common.errorTitle} message={common.errorGeneral} />
      </Screen>
    );
  }

  return (
    <Screen title={partiesAr.supplierFile} onBack={() => router.back()}>
      <PartyProfile
        key={reloadKey}
        kind="supplier"
        id={id}
        onEdit={() => router.push(`/parties/suppliers/${id}/edit`)}
        onArchived={() => router.back()}
      />
    </Screen>
  );
}
