import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { EmptyState, Screen } from '@/components';
import { PartyProfile } from '@/components/party/PartyProfile';
import { common, parties as partiesAr } from '@/i18n/ar';
import { colors, fontSizes, fonts } from '@/theme';

/** ملف العميل — بطاقات الرصيد لكل عملة + بيانات + تعديل/أرشفة (FR-03-01/02/09). */
export default function CustomerProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const [reloadKey, setReloadKey] = useState(0);
  const firstFocus = useRef(true);

  // إعادة التحميل عند العودة من شاشة التعديل (المعطيات محلية وسريعة)
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
      <Screen title={partiesAr.customerFile} onBack={() => router.back()} scroll={false}>
        <EmptyState title={common.errorTitle} message={common.errorGeneral} />
      </Screen>
    );
  }

  return (
    <Screen title={partiesAr.customerFile} onBack={() => router.back()}>
      <PartyProfile
        key={reloadKey}
        kind="customer"
        id={id}
        onEdit={() => router.push(`/parties/customers/${id}/edit`)}
        onArchived={() => router.back()}
      />
      <Text style={s.footNote}>{partiesAr.listCustomersHint}</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  footNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    paddingBottom: 8,
  },
});
