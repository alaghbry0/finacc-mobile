import { useLocalSearchParams } from 'expo-router';
import { ReturnFlow } from '@/screens/returns/ReturnFlow';

/** مرتجع شراء مرتبط (FR-02-08) — يُفتح من تفاصيل فاتورة الشراء. */
export default function PurchaseReturnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number(Array.isArray(id) ? id[0] : id);
  return <ReturnFlow kind="purchase" originalInvoiceId={invoiceId} />;
}
