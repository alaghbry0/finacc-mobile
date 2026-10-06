import { useLocalSearchParams } from 'expo-router';
import { ReturnFlow } from '@/screens/returns/ReturnFlow';

/** مرتجع بيع مرتبط (FR-02-07 + ReturnFlow §6.5) — يُفتح من تفاصيل فاتورة البيع. */
export default function SaleReturnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number(Array.isArray(id) ? id[0] : id);
  return <ReturnFlow kind="sale" originalInvoiceId={invoiceId} />;
}
