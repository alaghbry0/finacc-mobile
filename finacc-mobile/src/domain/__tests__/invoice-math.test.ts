import { computeInvoiceTotals, distributeProRata, assertTotalsValid, InvoiceMathError } from '../invoice-math';

describe('invoice-math: الحسابات الأساسية', () => {
  test('فاتورة بسيطة بلا خصم ولا ضريبة', () => {
    const t = computeInvoiceTotals(
      [
        { productId: 1, qty: '2', unitPrice: '100' },
        { productId: 2, qty: '1', unitPrice: '50' },
      ],
      { taxMode: 'on_total', taxRate: '0' },
    );
    expect(t.subtotal).toBe('250.0000');
    expect(t.total).toBe('250.0000');
    expect(t.taxAmount).toBe('0.0000');
  });

  test('خصم بند نسبة + خصم فاتورة + ضريبة on_total', () => {
    const t = computeInvoiceTotals(
      [
        { productId: 1, qty: '10', unitPrice: '100', discountPercent: '10' }, // 1000 - 100 = 900
        { productId: 2, qty: '5', unitPrice: '40' }, // 200
      ],
      { taxMode: 'on_total', taxRate: '5', invoiceDiscount: '100' },
    );
    // subtotal = 1100، netBeforeTax = 1000، tax = 50، total = 1050
    expect(t.subtotal).toBe('1100.0000');
    expect(t.netBeforeTax).toBe('1000.0000');
    expect(t.taxAmount).toBe('50.0000');
    expect(t.total).toBe('1050.0000');
  });

  test('نمط per_item: ضريبة لكل بند على صافيه وخصم الفاتورة لا يمسها', () => {
    const t = computeInvoiceTotals(
      [
        { productId: 1, qty: '1', unitPrice: '200', taxPercent: '5' },
        { productId: 2, qty: '2', unitPrice: '100', taxPercent: '10', discountPercent: '50' },
      ],
      { taxMode: 'per_item', taxRate: '0', invoiceDiscount: '50' },
    );
    // بند1: 200 + 10 = 210؛ بند2: 100 + 10 = 110؛ subtotal = 300؛ total = 300 - 50 + 20 = 270
    expect(t.lines[0].lineTax).toBe('10.0000');
    expect(t.lines[1].lineNet).toBe('100.0000');
    expect(t.lines[1].lineTax).toBe('10.0000');
    expect(t.subtotal).toBe('300.0000');
    expect(t.total).toBe('270.0000');
  });

  test('منع الصافي ≤ 0 (FR-02-05)', () => {
    const t = computeInvoiceTotals([{ productId: 1, qty: '1', unitPrice: '100' }], {
      taxMode: 'on_total',
      taxRate: '0',
      invoiceDiscount: '100',
    });
    expect(() => assertTotalsValid(t)).toThrow(InvoiceMathError);
  });

  test('خصم فاتورة أكبر من المجموع → خطأ عربي', () => {
    expect(() =>
      computeInvoiceTotals([{ productId: 1, qty: '1', unitPrice: '100' }], {
        taxMode: 'on_total',
        taxRate: '0',
        invoiceDiscount: '150',
      }),
    ).toThrow(InvoiceMathError);
  });

  test('كمية صفر أو سعر سالب → خطأ عربي', () => {
    expect(() =>
      computeInvoiceTotals([{ productId: 1, qty: '0', unitPrice: '10' }], { taxMode: 'on_total', taxRate: '0' }),
    ).toThrow(InvoiceMathError);
    expect(() =>
      computeInvoiceTotals([{ productId: 1, qty: '1', unitPrice: '-5' }], { taxMode: 'on_total', taxRate: '0' }),
    ).toThrow(InvoiceMathError);
  });
});

describe('invoice-math: توزيع خصم رأس فاتورة الشراء pro-rata (قاعدة 5.4-3)', () => {
  test('شراء 10 @100 بخصم 10% → التكلفة 90 لا 100 (AC-03)', () => {
    const shares = distributeProRata('100', ['1000']);
    expect(shares[0]).toBe('100.0000'); // الخصم كله على البند الوحيد
    // التكلفة الصافية للبند = 1000 - 100 = 900 لـ 10 وحدات = 90/وحدة
  });

  test('توزيع على بندين بقيمتين + الفرق على الأخير (مجموع محفوظ)', () => {
    const shares = distributeProRata('150', ['900', '600']);
    expect(shares.length).toBe(2);
    const sum = Number(shares[0]) + Number(shares[1]);
    expect(sum).toBe(150);
    expect(shares[0]).toBe('90.0000'); // 150 × 900/1500
    expect(shares[1]).toBe('60.0000');
  });

  test('أوزان صفرية كلها → أصفار', () => {
    const shares = distributeProRata('150', ['0', '0']);
    expect(shares).toEqual(['0', '0']);
  });
});
