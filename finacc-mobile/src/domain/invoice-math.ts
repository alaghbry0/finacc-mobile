/**
 * حسابات الفاتورة المشتركة (بيع/شراء/مرتجعات) — دوال نقية بلا قاعدة.
 * المصدر: SRS §5.4 (الخصومات، الضريبة، WAC) + إعدادات invoicing.tax_mode.
 * كل المبالغ نصوص Decimal — التقريب 4 منازل عند التخزين (NUMERIC(14,4)).
 */
import Decimal from 'decimal.js';
import { dec, roundTo } from '@/utils/money';

export interface InvoiceLineInput {
  /** null = سطر خدمة حرة (قرار 5) */
  productId: number | null;
  lineDesc?: string;
  qty: string;
  unitPrice: string;
  discountPercent?: string;
  /** لكل البند — يُستخدم فقط في نمط per_item */
  taxPercent?: string;
  /** تكلفة السطر لحظة الحفظ (Snapshot) — البيع: WAC الجاري، الشراء: التكلفة المحسوبة */
  lineCost?: string;
}

export interface ComputedLine {
  input: InvoiceLineInput;
  gross: string;
  lineDiscount: string;
  lineNet: string;
  lineTax: string;
  lineTotal: string;
  lineCost: string;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  subtotal: string;
  invoiceDiscount: string;
  netBeforeTax: string;
  taxAmount: string;
  total: string;
  costTotal: string;
}

export interface TotalsOptions {
  taxMode: 'per_item' | 'on_total';
  taxRate: string;
  invoiceDiscount?: string;
}

/** خطأ منطقي برسالة عربية (نمط 6.3: ماذا حدث + ما الحل) */
export class InvoiceMathError extends Error {}

const Q = 4;

/**
 * حساب إجماليات الفاتورة:
 * - الخصم على البند: نسبة من (الكمية × السعر).
 * - subtotal = Σ صافي البنود (بعد خصومات البنود، قبل خصم الفاتورة وقبل الضريبة).
 * - on_total (الافتراضي): الضريبة على (subtotal − خصم الفاتورة) بنسبة taxRate.
 * - per_item: الضريبة تُحسب لكل بند على صافيه (خصم الفاتورة لا يمسها — موثق).
 * - total = subtotal − خصم الفاتورة + الضريبة.
 */
export function computeInvoiceTotals(items: InvoiceLineInput[], opts: TotalsOptions): InvoiceTotals {
  const invoiceDiscount = dec(opts.invoiceDiscount ?? '0');
  if (invoiceDiscount.isNegative()) {
    throw new InvoiceMathError('خصم الفاتورة لا يمكن أن يكون سالباً. صحّح الخصم ثم أعد الحفظ.');
  }

  const lines: ComputedLine[] = items.map((input) => {
    const qty = dec(input.qty);
    const price = dec(input.unitPrice);
    if (qty.lte(0)) {
      throw new InvoiceMathError('كمية البند يجب أن تكون أكبر من صفر. راجع بنود الفاتورة.');
    }
    if (price.isNegative()) {
      throw new InvoiceMathError('سعر البند لا يمكن أن يكون سالباً. راجع بنود الفاتورة.');
    }
    const gross = roundTo(qty.times(price), Q);
    const percent = dec(input.discountPercent ?? '0');
    if (percent.isNegative() || percent.gt(100)) {
      throw new InvoiceMathError('نسبة خصم البند يجب أن تكون بين 0 و 100. صحّح الخصم.');
    }
    const lineDiscount = roundTo(gross.times(percent).div(100), Q);
    const lineNet = roundTo(gross.minus(lineDiscount), Q);
    const itemTaxPercent = dec(input.taxPercent ?? '0');
    const lineTax = opts.taxMode === 'per_item' ? roundTo(lineNet.times(itemTaxPercent).div(100), Q) : dec(0);
    const lineCost = dec(input.lineCost ?? '0');
    return {
      input,
      gross: money4(gross),
      lineDiscount: money4(lineDiscount),
      lineNet: money4(lineNet),
      lineTax: money4(lineTax),
      lineTotal: money4(roundTo(lineNet.plus(lineTax), Q)),
      lineCost: money4(lineCost),
    };
  });

  const subtotal = roundTo(lines.reduce((acc, l) => acc.plus(dec(l.lineNet)), dec(0)), Q);
  if (invoiceDiscount.gt(subtotal)) {
    throw new InvoiceMathError(
      `خصم الفاتورة (${invoiceDiscount.toFixed(2)}) أكبر من مجموع البنود (${subtotal.toFixed(2)}). خفّض الخصم أو أضف بنوداً.`,
    );
  }
  const netBeforeTax = roundTo(subtotal.minus(invoiceDiscount), Q);
  const taxRate = dec(opts.taxRate ?? '0');
  // per_item: الضريبة محسوبة داخل البنود — تُجمَّع للإجمالي والتقرير
  const perLineTaxSum = roundTo(lines.reduce((acc, l) => acc.plus(dec(l.lineTax)), dec(0)), Q);
  const taxAmount = opts.taxMode === 'on_total' ? roundTo(netBeforeTax.times(taxRate).div(100), Q) : perLineTaxSum;
  const total = roundTo(netBeforeTax.plus(taxAmount), Q);
  const costTotal = roundTo(lines.reduce((acc, l) => acc.plus(dec(l.lineCost)), dec(0)), Q);

  return {
    lines,
    subtotal: money4(subtotal),
    invoiceDiscount: money4(invoiceDiscount),
    netBeforeTax: money4(netBeforeTax),
    taxAmount: money4(taxAmount),
    total: money4(total),
    costTotal: money4(costTotal),
  };
}

/**
 * توزيع مبلغ (خصم رأس فاتورة الشراء) على بنود نسبةً لقيمتها الصافية قبل تحديث WAC (قاعدة 5.4-3).
 * يعيد مصفوفة نصوص بطول الأوزان، مجموعها = المبلغ (الفرق على الأخير لضمان التساوي).
 */
export function distributeProRata(amount: string, weights: string[]): string[] {
  const total = dec(amount);
  const w = weights.map((x) => dec(x));
  const sum = w.reduce((acc, x) => acc.plus(x), dec(0));
  if (sum.lte(0)) return w.map(() => '0');
  const out: string[] = [];
  let allocated = dec(0);
  for (let i = 0; i < w.length; i++) {
    if (i === w.length - 1) {
      out.push(money4(roundTo(total.minus(allocated), Q)));
    } else {
      const share = roundTo(total.times(w[i]).div(sum), Q);
      out.push(money4(share));
      allocated = allocated.plus(share);
    }
  }
  return out;
}

/** التحقق النهائي قبل الحفظ: منع الصافي ≤ 0 (FR-02-05) */
export function assertTotalsValid(totals: InvoiceTotals): void {
  if (dec(totals.total).lte(0)) {
    throw new InvoiceMathError('صافي الفاتورة صفر أو سالب — لا يمكن الحفظ. خفّض الخصم أو راجع البنود.');
  }
}

function money4(d: Decimal): string {
  return d.toFixed(Q);
}
