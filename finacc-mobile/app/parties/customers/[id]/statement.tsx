import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components';
import { common } from '@/i18n/ar';
import { StatementView } from '@/screens/parties/StatementView';

/** كشف حساب العميل (FR-03-04) — غلاف رفيع فوق المكوّن المشترك. */
export default function CustomerStatementScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <Screen title={common.errorTitle} onBack={() => router.back()} scroll={false}>
        <EmptyState title={common.errorTitle} message={common.errorGeneral} />
      </Screen>
    );
  }

  return <StatementView kind="customer" partyId={id} />;
}
