import { formatMoney } from '@/utils/money';

/**
 * قوالب الطباعة HTML (الوحدة 10 — FR-10-01/05/07) — نقي TS بلا أي اعتماد React/DB:
 * يولّد مستند HTML عربي RTL كامل بخط Cairo (Google Fonts بـ <link> وقت الطباعة فقط،
 * مع fallback sans-serif — لا CDN في الحزمة)، بأسلوب إيصال ESC/POS-Receipt احترافي:
 * نص داكن على خلفية بيضاء، فواصل متقطعة، أرقام tabular.
 *
 * قيود موثقة (§3.5): وضع Raster للطابعة الحرارية يعمل على الجهاز فقط —
 * القوالب هنا هي نفس مصدر الرستر (expo-print printAsync يحوّل HTML لصورة عند الطباعة).
 * QR (FR-10-01 جزئية): TODO عند EAS — هنا «رقم المستند» بخط كبير بديلاً مضموناً بلا إنترنت.
 */

export type PaperSize = 'receipt58' | 'receipt80' | 'a4';

// ============ الأنواع (العقود) ============

/** رأس المنشأة المشترك — يُبنى من جدول company. */
export interface TemplateCompany {
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  footerText?: string | null;
  taxNumber?: string | null;
}

export interface InvoiceTemplateItem {
  name: string;
  qty: string;
  unitPrice: string;
  discountPercent: string;
  lineTotal: string;
}

/** بيانات فاتورة (بيع/شراء/مرتجع) — تُبنى من getSaleInvoice/getPurchaseInvoice. */
export interface InvoiceTemplateData {
  company: TemplateCompany;
  /** عنوان المستند: «فاتورة بيع» / «فاتورة شراء» / «مرتجع بيع»… */
  docTitle: string;
  docNo: string;
  docDate: string; // ISO
  partyLabel: string;
  partyName: string;
  partyPhone?: string | null;
  warehouseName?: string | null;
  cashboxName?: string | null;
  currencyCode: string;
  currencyDecimals: number;
  items: InvoiceTemplateItem[];
  subtotal: string;
  discountAmount: string;
  taxRate?: string | null;
  taxAmount: string;
  total: string;
  paidAmount: string;
  dueAmount: string;
  notesPrinted?: string | null;
  /** شارة «ملغاة/مسودة» عند الطباعة من التفاصيل. */
  statusLabel?: string | null;
}

/** سند قبض/صرف مرقّم (FR-04-10) — من cash_tx + voucher_no + الطرف. */
export interface VoucherTemplateData {
  company: TemplateCompany;
  kindLabel: string; // «سند قبض» / «سند صرف»
  voucherNo: string;
  date: string; // ISO
  partyLabel: string;
  partyName: string;
  cashboxName?: string | null;
  description?: string | null;
  amount: string;
  currencyCode: string;
  currencyDecimals: number;
  note?: string;
}

/** كشف حساب (statements.ts) — A4. */
export interface StatementTemplateLine {
  date: string;
  docNo: string;
  typeLabel: string;
  debit: string; // '0' حين لا قيمة
  credit: string;
  balance: string;
}

export interface StatementTemplateData {
  company: TemplateCompany;
  partyKindLabel: string; // «كشف حساب عميل» / «كشف حساب مورّد»
  partyName: string;
  currencyCode: string;
  periodLabel?: string | null;
  opening: string;
  closing: string;
  lines: StatementTemplateLine[];
  generatedAt: string; // ISO
}

/** تقرير الوردية — A4. */
export interface ShiftTemplateData {
  company: TemplateCompany;
  cashboxName: string;
  openedAt: string; // ISO
  closedAt: string | null;
  openingCount: string;
  expectedIn: string;
  expectedOut: string;
  expected: string;
  counted: string;
  difference: string;
  currencyCode: string;
  currencyDecimals: number;
  notes?: string | null;
}

// ============ أدوات نقية داخلية ============

/** تهريب HTML لكل مدخلات المستخدم (أسماء/ملاحظات/هواتف). */
function esc(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** تاريخ ISO (كله أو YYYY-MM-DD) → YYYY/MM/DD. */
function fmtDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replaceAll('-', '/') : esc(iso);
}

/** تاريخ+وقت ISO → YYYY/MM/DD HH:MM. */
function fmtDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const t = iso.slice(11, 16);
  return t.length === 5 ? `${fmtDate(iso)} ${t}` : fmtDate(iso);
}

function money(v: string, decimals: number): string {
  return formatMoney(v, Math.max(0, Math.min(decimals, 6)));
}

/** أساس الورق: العرض وحجم @page. */
function paperCss(paper: PaperSize): { sheetWidth: string; pageRule: string; baseFont: number; titleFont: number } {
  if (paper === 'receipt58') {
    return {
      sheetWidth: '58mm',
      pageRule: '@page { size: 58mm auto; margin: 2mm; }',
      baseFont: 9.5,
      titleFont: 15,
    };
  }
  if (paper === 'receipt80') {
    return {
      sheetWidth: '80mm',
      pageRule: '@page { size: 80mm auto; margin: 3mm; }',
      baseFont: 11,
      titleFont: 18,
    };
  }
  return {
    sheetWidth: 'auto',
    pageRule: '@page { size: A4; margin: 14mm 12mm; }',
    baseFont: 12.5,
    titleFont: 24,
  };
}

/**
 * الهيكل الخارجي المشترك: <html dir=rtl> + خط Cairo (وقت الطباعة فقط + fallback)
 * + CSS قاعي (tabular nums / حدود خفيفة / تلاشي الظل عند الطباعة).
 */
function document(title: string, paper: PaperSize, bodyHtml: string, extraCss = ''): string {
  const p = paperCss(paper);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
${p.pageRule}
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #e2e8f0; color: #0f172a; }
.sheet { background: #ffffff; width: ${p.sheetWidth}; max-width: 100%; margin: 8px auto; padding: 14px 12px; font-size: ${p.baseFont}px; line-height: 1.55; box-shadow: 0 4px 18px rgba(15,23,42,0.18); border-radius: 4px; }
@media print {
  body { background: #ffffff; }
  .sheet { box-shadow: none; border-radius: 0; margin: 0 auto; padding: 0; }
}
.num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
.c { text-align: center; }
.b { font-weight: 700; }
.muted { color: #64748b; }
.dash { border: 0; border-top: 1.5px dashed #94a3b8; margin: 8px 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.row .k { color: #475569; }
.row .v { font-weight: 600; text-align: left; }
.docno { font-weight: 800; letter-spacing: 0.5px; }
${extraCss}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** رأس المنشأة (اسم كبير + هاتف/واتساب/عنوان). */
function companyHeaderHtml(c: TemplateCompany): string {
  const contact: string[] = [];
  if (c.phone !== null && c.phone !== undefined && c.phone.length > 0) contact.push(`هاتف: ${esc(c.phone)}`);
  if (c.whatsapp !== null && c.whatsapp !== undefined && c.whatsapp.length > 0) contact.push(`واتساب: ${esc(c.whatsapp)}`);
  return `<div class="c">
  <div class="cname">${esc(c.name)}</div>
  ${c.address !== null && c.address !== undefined && c.address.length > 0 ? `<div class="cmeta">${esc(c.address)}</div>` : ''}
  ${contact.length > 0 ? `<div class="cmeta">${contact.join(' · ')}</div>` : ''}
</div>`;
}

/** تذييل مشترك: نص المنشأة + رقم المستند الكبير (بديل QR الموثق). */
function footerHtml(c: TemplateCompany, docNo: string): string {
  const footer =
    c.footerText !== null && c.footerText !== undefined && c.footerText.length > 0
      ? `<div class="foot">${esc(c.footerText)}</div>`
      : `<div class="foot">شكراً لتعاملكم معنا</div>`;
  return `<hr class="dash">
<div class="docno-big c">${esc(docNo)}</div>
<div class="c muted" style="font-size:0.82em">رقم المستند — TODO: QR عند EAS</div>
${footer}`;
}

// ============ فاتورة (بيع/شراء/مرتجع) ============

export function invoiceHtml(data: InvoiceTemplateData, opts: { paper: PaperSize; detailed: boolean }): string {
  const { paper, detailed } = opts;
  const d = data.currencyDecimals;
  const code = esc(data.currencyCode);
  const isReceipt = paper !== 'a4';

  // ---- بنود الإيصال: سطر اسم + سطر كميات ----
  const receiptItems = data.items
    .map((it) => {
      const qtyX = `<span class="num">${money(it.qty, 3)}</span> × <span class="num">${money(it.unitPrice, d)}</span>`;
      const disc =
        detailed && Number(it.discountPercent) > 0
          ? ` <span class="muted">(خصم <span class="num">${money(it.discountPercent, 2)}</span>%)</span>`
          : '';
      return `<div class="item">
  <div class="row"><span class="b">${esc(it.name)}</span></div>
  <div class="row"><span class="k">${qtyX}${disc}</span><span class="v num">${money(it.lineTotal, d)}</span></div>
</div>`;
    })
    .join('');

  // ---- جدول A4 ----
  const a4Rows = data.items
    .map(
      (it) => `<tr>
  <td class="r">${esc(it.name)}</td>
  <td class="num c">${money(it.qty, 3)}</td>
  <td class="num c">${money(it.unitPrice, d)}</td>
  <td class="num c">${detailed && Number(it.discountPercent) > 0 ? `${money(it.discountPercent, 2)}%` : '—'}</td>
  <td class="num c b">${money(it.lineTotal, d)}</td>
</tr>`,
    )
    .join('');

  const totalRow = (label: string, value: string, cls = ''): string =>
    `<div class="row ${cls}"><span class="k">${esc(label)}</span><span class="v num">${money(value, d)} ${code}</span></div>`;

  const statusBadge =
    data.statusLabel !== null && data.statusLabel !== undefined && data.statusLabel.length > 0
      ? `<div class="badge">${esc(data.statusLabel)}</div>`
      : '';

  const totalsHtml = `
  ${detailed ? totalRow('المجموع قبل الخصم', data.subtotal) : ''}
  ${Number(data.discountAmount) !== 0 ? totalRow('خصم الفاتورة', data.discountAmount) : ''}
  ${Number(data.taxAmount) !== 0 ? totalRow(`الضريبة${data.taxRate !== null && data.taxRate !== undefined && Number(data.taxRate) > 0 ? ` (${money(data.taxRate, 2)}%)` : ''}`, data.taxAmount) : ''}
  ${totalRow('الإجمالي', data.total, 'grand')}
  ${Number(data.paidAmount) !== 0 ? totalRow('المدفوع', data.paidAmount) : ''}
  ${Number(data.dueAmount) !== 0 ? totalRow('المتبقي', data.dueAmount, 'due') : ''}`;

  const notesHtml =
    data.notesPrinted !== null && data.notesPrinted !== undefined && data.notesPrinted.length > 0
      ? `<hr class="dash"><div class="notes"><span class="k">ملاحظة: </span>${esc(data.notesPrinted)}</div>`
      : '';

  const metaRows: string[] = [
    `<div class="row"><span class="k">${esc(data.partyLabel)}</span><span class="v">${esc(data.partyName)}</span></div>`,
  ];
  if (data.partyPhone !== null && data.partyPhone !== undefined && data.partyPhone.length > 0) {
    metaRows.push(`<div class="row"><span class="k">الهاتف</span><span class="v num">${esc(data.partyPhone)}</span></div>`);
  }
  if (detailed) {
    if (data.warehouseName !== null && data.warehouseName !== undefined) {
      metaRows.push(`<div class="row"><span class="k">المستودع</span><span class="v">${esc(data.warehouseName)}</span></div>`);
    }
    if (data.cashboxName !== null && data.cashboxName !== undefined) {
      metaRows.push(`<div class="row"><span class="k">الصندوق</span><span class="v">${esc(data.cashboxName)}</span></div>`);
    }
  }

  const extraCss = isReceipt
    ? `.cname { font-size: 1.45em; font-weight: 800; }
.doc-title { font-size: 1.25em; font-weight: 800; color: #0e7490; margin: 2px 0; }
.docno-big { font-size: 1.6em; font-weight: 800; margin-top: 2px; }
.item { margin: 3px 0; }
.grand { border-top: 1.5px solid #0f172a; border-bottom: 3px double #0f172a; padding: 4px 0; margin-top: 3px; font-size: 1.15em; }
.grand .k, .grand .v { font-weight: 800; }
.due .v { color: #b45309; }
.badge { display: inline-block; border: 1.5px solid #b91c1c; color: #b91c1c; border-radius: 4px; padding: 0 8px; font-weight: 700; margin-top: 4px; font-size: 0.9em; }
.foot { text-align: center; color: #475569; margin-top: 6px; font-size: 0.88em; }
.notes { font-size: 0.92em; }`
    : `.cname { font-size: 1.9em; font-weight: 800; color: #0f172a; }
.a4-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.doc-box { border: 2px solid #0f172a; border-radius: 8px; padding: 10px 16px; min-width: 62mm; text-align: center; }
.doc-title { font-size: 1.35em; font-weight: 800; color: #0e7490; }
.docno-big { font-size: 1.45em; font-weight: 800; }
.meta { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; margin: 10px 0 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; background: #f8fafc; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #0f172a; color: #ffffff; padding: 7px 8px; font-weight: 700; border: 1px solid #0f172a; font-size: 0.95em; }
table.items td { border: 1px solid #cbd5e1; padding: 6px 8px; }
table.items tr:nth-child(even) td { background: #f1f5f9; }
td.r, th.r { text-align: right; }
td.c, th.c { text-align: center; }
.totals { margin-top: 14px; margin-inline-start: auto; width: 78mm; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; }
.grand { border-top: 2px solid #0f172a; border-bottom: 3px double #0f172a; padding: 5px 0; margin-top: 3px; font-size: 1.2em; }
.grand .k, .grand .v { font-weight: 800; }
.due .v { color: #b45309; }
.badge { display: inline-block; border: 1.5px solid #b91c1c; color: #b91c1c; border-radius: 4px; padding: 0 10px; font-weight: 700; margin-top: 6px; }
.foot { text-align: center; color: #475569; margin-top: 10px; }
.notes { margin-top: 8px; font-size: 0.95em; }`;

  const body = isReceipt
    ? `<div class="sheet">
${companyHeaderHtml(data.company)}
<hr class="dash">
<div class="c doc-title">${esc(data.docTitle)}</div>
<div class="c docno num">${esc(data.docNo)}</div>
${statusBadge}
<div class="row" style="margin-top:6px"><span class="k">التاريخ</span><span class="v num">${fmtDate(data.docDate)}</span></div>
${metaRows.join('\n')}
<hr class="dash">
${receiptItems}
<hr class="dash">
${totalsHtml}
${notesHtml}
${footerHtml(data.company, data.docNo)}
</div>`
    : `<div class="sheet">
<div class="a4-head">
  <div>${companyHeaderHtml(data.company)}
    <div class="cmeta" style="text-align:right;margin-top:4px">${data.company.taxNumber !== null && data.company.taxNumber !== undefined && data.company.taxNumber.length > 0 ? `الرقم الضريبي: ${esc(data.company.taxNumber)}` : ''}</div>
  </div>
  <div class="doc-box">
    <div class="doc-title">${esc(data.docTitle)}</div>
    <div class="docno num">${esc(data.docNo)}</div>
    <div class="muted num" style="font-size:0.9em">${fmtDate(data.docDate)}</div>
    ${statusBadge}
  </div>
</div>
<div class="meta">${metaRows.join('\n')}</div>
<table class="items">
<thead><tr><th class="r">الصنف</th><th class="c">الكمية</th><th class="c">السعر</th><th class="c">الخصم</th><th class="c">الإجمالي</th></tr></thead>
<tbody>${a4Rows}</tbody>
</table>
<div class="totals">${totalsHtml}</div>
${notesHtml}
${footerHtml(data.company, data.docNo)}
</div>`;

  return document(`${data.docTitle} ${data.docNo}`, paper, body, extraCss);
}

// ============ السند المرقّم ============

export function voucherHtml(data: VoucherTemplateData): string {
  const d = data.currencyDecimals;
  const isReceiptVoucher = data.kindLabel.includes('قبض');
  const accent = isReceiptVoucher ? '#047857' : '#b45309';
  const extraCss = `.cname { font-size: 1.45em; font-weight: 800; }
.doc-title { font-size: 1.35em; font-weight: 800; color: ${accent}; margin: 2px 0; }
.docno-big { font-size: 1.7em; font-weight: 800; }
.voucher-no { font-size: 1.5em; font-weight: 800; letter-spacing: 1px; }
.amount-box { border: 2px solid ${accent}; border-radius: 8px; padding: 10px; text-align: center; margin: 10px 0; }
.amount { font-size: 2.1em; font-weight: 800; }
.sign { margin-top: 26px; display: flex; justify-content: flex-start; }
.sign-line { border-top: 1.5px dashed #475569; padding-top: 4px; width: 48%; text-align: center; color: #475569; font-size: 0.9em; }
.foot { text-align: center; color: #475569; margin-top: 8px; font-size: 0.85em; }`;

  const body = `<div class="sheet">
${companyHeaderHtml(data.company)}
<hr class="dash">
<div class="c doc-title">${esc(data.kindLabel)}</div>
<div class="c voucher-no num">${esc(data.voucherNo)}</div>
<div class="row" style="margin-top:6px"><span class="k">التاريخ</span><span class="v num">${fmtDate(data.date)}</span></div>
<div class="row"><span class="k">${esc(data.partyLabel)}</span><span class="v">${esc(data.partyName)}</span></div>
${data.cashboxName !== null && data.cashboxName !== undefined && data.cashboxName.length > 0 ? `<div class="row"><span class="k">الصندوق</span><span class="v">${esc(data.cashboxName)}</span></div>` : ''}
${
  data.description !== null && data.description !== undefined && data.description.length > 0
    ? `<div class="row"><span class="k">البيان</span><span class="v">${esc(data.description)}</span></div>`
    : ''
}
<div class="amount-box">
  <div class="k">المبلغ</div>
  <div class="amount num">${money(data.amount, d)} <span style="font-size:0.5em">${esc(data.currencyCode)}</span></div>
</div>
<div class="sign"><div class="sign-line">توقيع المستلم</div></div>
${
  data.note !== undefined && data.note.length > 0
    ? `<div class="foot">${esc(data.note)}</div>`
    : `<div class="foot">هذا السند مرقّم تسلسلياً ولا يُعاد استخدامه</div>`
}
<div class="docno-big c num" style="margin-top:8px">${esc(data.voucherNo)}</div>
</div>`;

  return document(`${data.kindLabel} ${data.voucherNo}`, 'receipt80', body, extraCss);
}

// ============ كشف حساب ============

export function statementHtml(data: StatementTemplateData): string {
  const rows = data.lines
    .map((l) => {
      const debit = Number(l.debit) !== 0;
      const credit = Number(l.credit) !== 0;
      return `<tr>
  <td class="num c">${fmtDate(l.date)}</td>
  <td class="num c b">${esc(l.docNo)}</td>
  <td class="r">${esc(l.typeLabel)}</td>
  <td class="num c">${debit ? money(l.debit, 2) : '—'}</td>
  <td class="num c">${credit ? money(l.credit, 2) : '—'}</td>
  <td class="num c b">${money(l.balance, 2)}</td>
</tr>`;
    })
    .join('');

  const extraCss = `.cname { font-size: 1.8em; font-weight: 800; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.doc-box { border: 2px solid #0f172a; border-radius: 8px; padding: 8px 18px; text-align: center; }
.doc-title { font-size: 1.3em; font-weight: 800; color: #0e7490; }
.meta { color: #475569; margin: 8px 0; }
table.st { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.st th { background: #0f172a; color: #fff; padding: 7px 6px; border: 1px solid #0f172a; font-size: 0.95em; }
table.st td { border: 1px solid #cbd5e1; padding: 6px; }
table.st tr:nth-child(even) td { background: #f1f5f9; }
td.c, th.c { text-align: center; }
td.r, th.r { text-align: right; }
.bal-row { display: flex; gap: 10px; margin: 12px 0; }
.bal { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; text-align: center; background: #f8fafc; }
.bal .k { color: #475569; font-size: 0.9em; }
.bal .v { font-weight: 800; font-size: 1.15em; }
.gen { text-align: center; color: #64748b; margin-top: 12px; font-size: 0.85em; }`;

  const body = `<div class="sheet">
<div class="head">
  <div>${companyHeaderHtml(data.company)}</div>
  <div class="doc-box">
    <div class="doc-title">${esc(data.partyKindLabel)}</div>
    <div class="b">${esc(data.partyName)}</div>
    <div class="muted num" style="font-size:0.9em">${esc(data.currencyCode)}</div>
  </div>
</div>
<div class="meta">${data.periodLabel !== null && data.periodLabel !== undefined ? esc(data.periodLabel) : 'كل الفترات'} · صُدِر في <span class="num">${fmtDateTime(data.generatedAt)}</span></div>
<div class="bal-row">
  <div class="bal"><div class="k">الرصيد الافتتاحي</div><div class="v num">${money(data.opening, 2)} ${esc(data.currencyCode)}</div></div>
  <div class="bal"><div class="k">الرصيد الختامي</div><div class="v num">${money(data.closing, 2)} ${esc(data.currencyCode)}</div></div>
</div>
<table class="st">
<thead><tr><th class="c">التاريخ</th><th class="c">المستند</th><th class="r">النوع</th><th class="c">مدين</th><th class="c">دائن</th><th class="c">الرصيد</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="gen">كشف حساب ${esc(data.partyName)} · ${esc(data.currencyCode)} — المُحاسِب الشخصي</div>
</div>`;

  return document(`كشف حساب ${data.partyName}`, 'a4', body, extraCss);
}

// ============ تقرير الوردية ============

export function shiftHtml(data: ShiftTemplateData): string {
  const d = data.currencyDecimals;
  const diffNum = Number(data.difference);
  const diffLabel = diffNum === 0 ? 'مطابقة تامة' : diffNum > 0 ? 'زيادة في الدرج' : 'عجز في الدرج';
  const diffColor = diffNum === 0 ? '#047857' : diffNum > 0 ? '#0e7490' : '#b91c1c';
  const m = (v: string): string => `${money(v, d)} ${esc(data.currencyCode)}`;

  const extraCss = `.cname { font-size: 1.8em; font-weight: 800; }
.doc-title { font-size: 1.35em; font-weight: 800; color: #0e7490; text-align: center; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.tile { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
.tile .k { color: #475569; font-size: 0.9em; }
.tile .v { font-weight: 800; font-size: 1.15em; }
.diff { border: 2px solid ${diffColor}; border-radius: 8px; padding: 10px; text-align: center; margin-top: 12px; color: ${diffColor}; font-weight: 800; font-size: 1.25em; }
.notes { margin-top: 10px; font-size: 0.95em; }
.gen { text-align: center; color: #64748b; margin-top: 14px; font-size: 0.85em; }`;

  const body = `<div class="sheet">
${companyHeaderHtml(data.company)}
<hr class="dash">
<div class="doc-title">تقرير إقفال وردية</div>
<div class="c b">${esc(data.cashboxName)}</div>
<div class="row" style="margin-top:6px"><span class="k">بدأت</span><span class="v num">${fmtDateTime(data.openedAt)}</span></div>
<div class="row"><span class="k">أُقفلت</span><span class="v num">${fmtDateTime(data.closedAt)}</span></div>
<div class="grid">
  <div class="tile"><div class="k">عدّ الدرج الافتتاحي</div><div class="v num">${m(data.openingCount)}</div></div>
  <div class="tile"><div class="k">الوارد خلال الوردية</div><div class="v num">${m(data.expectedIn)}</div></div>
  <div class="tile"><div class="k">الصادر خلال الوردية</div><div class="v num">${m(data.expectedOut)}</div></div>
  <div class="tile"><div class="k">المتوقع في الدرج</div><div class="v num">${m(data.expected)}</div></div>
  <div class="tile"><div class="k">العدّ الفعلي</div><div class="v num">${m(data.counted)}</div></div>
  <div class="tile"><div class="k">الفرق</div><div class="v num">${m(data.difference)}</div></div>
</div>
<div class="diff">${diffLabel}: <span class="num">${m(data.difference)}</span></div>
${data.notes !== null && data.notes !== undefined && data.notes.length > 0 ? `<div class="notes"><span class="k">ملاحظات: </span>${esc(data.notes)}</div>` : ''}
<div class="gen">تقرير وردية · ${esc(data.cashboxName)} — المُحاسِب الشخصي</div>
</div>`;

  return document(`تقرير وردية ${data.cashboxName}`, 'a4', body, extraCss);
}

// ============ قالب التقارير العامة (FR-10-09 — مشاركة/طباعة أي تقرير) ============

export interface ReportTemplateData {
  company: TemplateCompany;
  title: string;
  /** بداية الفترة ISO أو null */
  periodFrom?: string | null;
  /** نهاية الفترة ISO أو null */
  periodTo?: string | null;
  columns: string[];
  /** صفوف نصية جاهزة (منسقة) — الأعمدة غير الأولى تُعرض كأرقام LTR */
  rows: string[][];
  /** صف إجمالي أسفل الجدول (اختياري) */
  totalRow?: string[] | null;
  /** ملاحظة أسفل الجدول (اختياري) */
  note?: string | null;
}

export function reportHtml(data: ReportTemplateData): string {
  const extraCss = `
.tbl { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.95em; }
.tbl th, .tbl td { border: 1px solid #cbd5e1; padding: 5px 8px; }
.tbl th { background: #f1f5f9; font-weight: 700; }
.tbl td:not(:first-child), .tbl th:not(:first-child) { text-align: center; font-variant-numeric: tabular-nums; direction: ltr; }
.tbl tr.total td { background: #f8fafc; font-weight: 800; }
.period { text-align: center; color: #475569; margin-top: 4px; }
.rnote { margin-top: 12px; color: #475569; font-size: 0.9em; }`;

  const period =
    data.periodFrom !== null && data.periodFrom !== undefined && data.periodTo !== null && data.periodTo !== undefined
      ? `<div class="period">${fmtDate(data.periodFrom)} — ${fmtDate(data.periodTo)}</div>`
      : '';
  const head = `<tr>${data.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body =
    data.rows
      .map((r) => `<tr>${r.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
      .join('\n') || `<tr><td colspan="${data.columns.length}" style="text-align:center;color:#94a3b8">—</td></tr>`;
  const total =
    data.totalRow !== null && data.totalRow !== undefined
      ? `<tr class="total">${data.totalRow.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`
      : '';

  const html = `<div class="sheet">
${companyHeaderHtml(data.company)}
<hr class="dash">
<div class="doc-title">${esc(data.title)}</div>
${period}
<table class="tbl">
${head}
${body}
${total}
</table>
${data.note !== null && data.note !== undefined && data.note.length > 0 ? `<div class="rnote">${esc(data.note)}</div>` : ''}
<div class="gen">${esc(data.title)} — المُحاسِب الشخصي</div>
</div>`;

  return document(data.title, 'a4', html, extraCss);
}
