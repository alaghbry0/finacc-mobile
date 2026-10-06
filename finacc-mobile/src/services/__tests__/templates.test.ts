import { invoiceHtml, voucherHtml, statementHtml, shiftHtml, type InvoiceTemplateData } from '@/services/templates';

/**
 * اختبارات قوالب الطباعة (الوحدة 10) — نقي TS: بنية HTML عربية RTL صحيحة،
 * تهريب مدخلات المستخدم، أحجام الورق، ولا CDN (الخط عبر <link> وقت الطباعة فقط).
 */

const company = { name: 'متجر النور <للتجارة>', phone: '777123456', footerText: 'شكراً <b>لزيارتكم</b>' };

function invoiceData(overrides: Partial<InvoiceTemplateData> = {}): InvoiceTemplateData {
  return {
    company,
    docTitle: 'فاتورة بيع',
    docNo: 'INV-2026-00001',
    docDate: '2026-02-14',
    partyLabel: 'العميل',
    partyName: 'أحمد سعيد',
    partyPhone: '733000111',
    currencyCode: 'YER',
    currencyDecimals: 0,
    items: [
      { name: 'أرز بسمتي 5كغ', qty: '3', unitPrice: '4500', discountPercent: '0', lineTotal: '13500' },
      { name: 'زيت عافية', qty: '2', unitPrice: '3000', discountPercent: '5', lineTotal: '5700' },
    ],
    subtotal: '19200',
    discountAmount: '0',
    taxRate: '0',
    taxAmount: '0',
    total: '19200',
    paidAmount: '19200',
    dueAmount: '0',
    ...overrides,
  };
}

describe('templates: فاتورة', () => {
  test('إيصال 80mm — البنية الأساسية RTL + الرقم + الإجمالي', () => {
    const html = invoiceHtml(invoiceData(), { paper: 'receipt80', detailed: false });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('INV-2026-00001');
    expect(html).toContain('فاتورة بيع');
    expect(html).toContain('أحمد سعيد');
    expect(html).toContain('19,200');
    expect(html).toContain('80mm'); // عرض الورق مضبوط في CSS
    expect(html).toContain('tabular-nums');
  });

  test('تهريب مدخلات المستخدم (الأسماء/التذييل) — لا حقن HTML', () => {
    const html = invoiceHtml(invoiceData(), { paper: 'receipt58', detailed: false });
    expect(html).not.toContain('<للتجارة>');
    expect(html).toContain('متجر النور &lt;للتجارة&gt;');
    expect(html).not.toContain('<b>لزيارتكم</b>');
    expect(html).toContain('شكراً &lt;b&gt;لزيارتكم&lt;/b&gt;');
  });

  test('مختصر: لا سطر «المجموع قبل الخصم» — مفصّل: يظهر مع خصم البند والمستودع', () => {
    const short = invoiceHtml(invoiceData(), { paper: 'receipt80', detailed: false });
    expect(short).not.toContain('المجموع قبل الخصم');
    expect(short).not.toContain('خصم 5');
    expect(short).not.toContain('المستودع');
    const detailed = invoiceHtml(invoiceData(), { paper: 'receipt80', detailed: true });
    expect(detailed).toContain('المجموع قبل الخصم');
    expect(detailed).toContain('خصم');
  });

  test('A4: جدول بنود بحدود + رأس المنشأة', () => {
    const html = invoiceHtml(invoiceData(), { paper: 'a4', detailed: true });
    expect(html).toContain('size: A4');
    expect(html).toContain('table class="items"');
    expect(html).toContain('أرز بسمتي 5كغ');
  });

  test('فاتورة ملغاة: شارة الحالة', () => {
    const html = invoiceHtml(invoiceData({ statusLabel: 'ملغاة' }), { paper: 'receipt80', detailed: false });
    expect(html).toContain('ملغاة');
    expect(html).toContain('badge');
  });

  test('لا CDN إطلاقاً — الخط فقط عبر Google Fonts <link> (مسموح وقت الطباعة)', () => {
    const html = invoiceHtml(invoiceData(), { paper: 'receipt80', detailed: false });
    const urls = [...html.matchAll(/https?:\/\/[^"'\s>]+/g)].map((m) => m[0]);
    for (const u of urls) {
      expect(u.startsWith('https://fonts.googleapis.com') || u.startsWith('https://fonts.gstatic.com')).toBe(true);
    }
  });
});

describe('templates: السند المرقّم', () => {
  test('رقم السند كبيراً + الطرف + المبلغ + سطر التوقيع', () => {
    const html = voucherHtml({
      company,
      kindLabel: 'سند قبض',
      voucherNo: 'RVT-2026-00003',
      date: '2026-02-14',
      partyLabel: 'الطرف',
      partyName: 'أحمد سعيد',
      cashboxName: 'الصندوق الرئيسي',
      description: 'دفعة من فاتورة',
      amount: '12500',
      currencyCode: 'YER',
      currencyDecimals: 0,
    });
    expect(html).toContain('RVT-2026-00003');
    expect(html).toContain('سند قبض');
    expect(html).toContain('12,500');
    expect(html).toContain('توقيع المستلم');
    expect(html).toContain('مرقّم تسلسلياً');
  });
});

describe('templates: كشف الحساب', () => {
  test('الأسطر + الرصيدان الافتتاحي/الختامي + عملة الكشف', () => {
    const html = statementHtml({
      company,
      partyKindLabel: 'كشف حساب عميل',
      partyName: 'أحمد سعيد',
      currencyCode: 'YER',
      periodLabel: 'الفترة: 2026-01-01 — 2026-02-01',
      opening: '0',
      closing: '450',
      lines: [
        { date: '2026-01-05', docNo: 'INV-2026-00001', typeLabel: 'فاتورة بيع', debit: '1000', credit: '0', balance: '1000' },
        { date: '2026-01-10', docNo: 'RVT-2026-00001', typeLabel: 'سند قبض', debit: '0', credit: '550', balance: '450' },
      ],
      generatedAt: '2026-02-14T10:30:00.000Z',
    });
    expect(html).toContain('size: A4');
    expect(html).toContain('كشف حساب عميل');
    expect(html).toContain('الرصيد الافتتاحي');
    expect(html).toContain('450');
    expect((html.match(/<tr>/g) ?? []).length).toBe(2 + 1); // صفوف البيانات + رأس الجدول
  });
});

describe('templates: تقرير الوردية', () => {
  test('مطابقة تامة عند فرق 0', () => {
    const html = shiftHtml({
      company,
      cashboxName: 'الصندوق الرئيسي',
      openedAt: '2026-02-14T08:00:00.000Z',
      closedAt: '2026-02-14T20:00:00.000Z',
      openingCount: '500',
      expectedIn: '1000',
      expectedOut: '500',
      expected: '500',
      counted: '1000',
      difference: '0',
      currencyCode: 'YER',
      currencyDecimals: 0,
    });
    expect(html).toContain('مطابقة تامة');
    expect(html).toContain('تقرير إقفال وردية');
    expect(html).toContain('العدّ الفعلي');
  });

  test('عجز في الدرج عند فرق سالب', () => {
    const html = shiftHtml({
      company,
      cashboxName: 'الصندوق الرئيسي',
      openedAt: '2026-02-14T08:00:00.000Z',
      closedAt: null,
      openingCount: '500',
      expectedIn: '1000',
      expectedOut: '500',
      expected: '500',
      counted: '990',
      difference: '-10',
      currencyCode: 'YER',
      currencyDecimals: 0,
    });
    expect(html).toContain('عجز في الدرج');
  });
});
