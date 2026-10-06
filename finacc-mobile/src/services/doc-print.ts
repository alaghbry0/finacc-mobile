import { isNativePlatform } from '@/utils/platform';
import { getDb } from '@/db/client';
import { getSetting } from '@/domain/settings';
import { getSaleInvoice } from '@/domain/invoicing';
import { getPurchaseInvoice } from '@/domain/purchasing';
import type { CashTxRow, ShiftRow } from '@/domain/cash';
import { shiftWindowSummary } from '@/domain/cash';
import type { StatementResult } from '@/domain/statements';
import { common, invoices as invT, statement as stT } from '@/i18n/ar';
import {
  invoiceHtml,
  voucherHtml,
  statementHtml,
  shiftHtml,
  reportHtml,
  type InvoiceTemplateData,
  type PaperSize,
  type StatementTemplateData,
  type StatementTemplateLine,
  type TemplateCompany,
  type VoucherTemplateData,
} from './templates';
import { printHtml, sendWhatsApp } from './print';
import { formatMoney } from '@/utils/money';

/**
 * تجميع بيانات المستندات للطباعة + الإجراءات عالية المستوى (الوحدة 10):
 * الشاشات تستدعي هذه الطبقة — لا templates/print مباشرة — فتتكون كل فاتورة من
 * رأس المنشأة + بيانات الدومين الجاهزة (getSaleInvoice/getPurchaseInvoice…).
 */

const isWeb = !isNativePlatform();

// ============ رأس المنشأة وإعدادات الطباعة ============

export async function getCompanyHeader(): Promise<TemplateCompany> {
  const db = await getDb();
  const rows = await db.all<{
    name: string; phone: string | null; whatsapp: string | null;
    address: string | null; footer_text: string | null; tax_number: string | null;
  }>('SELECT name, phone, whatsapp, address, footer_text, tax_number FROM company LIMIT 1');
  const r = rows[0];
  if (r === undefined) {
    return { name: common.appName };
  }
  return {
    name: String(r.name),
    phone: r.phone === null ? null : String(r.phone),
    whatsapp: r.whatsapp === null ? null : String(r.whatsapp),
    address: r.address === null ? null : String(r.address),
    footerText: r.footer_text === null ? null : String(r.footer_text),
    taxNumber: r.tax_number === null ? null : String(r.tax_number),
  };
}

export interface PrintOptions {
  paper: PaperSize;
  detailed: boolean;
  copies: number;
}

/** خيارات الطباعة الحالية من سجل الإعدادات (printing.* — FR-13-03). */
export async function getPrintOptions(): Promise<PrintOptions> {
  const [paper, detailed, copies] = await Promise.all([
    getSetting('printing.paper'),
    getSetting('printing.detailed'),
    getSetting('printing.copies'),
  ]);
  return {
    paper: paper === 'receipt58' || paper === 'a4' ? paper : 'receipt80',
    detailed: detailed === 'on',
    copies: Math.min(3, Math.max(1, Number(copies) || 1)),
  };
}

// ============ فواتير البيع (ومرتجعاته) ============

const SALE_DOC_TITLES: Record<string, string> = {
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع بيع',
};

const PURCHASE_DOC_TITLES: Record<string, string> = {
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
};

/** بيانات فاتورة البيع/المرتجع لقالب الطباعة. */
export async function saleInvoiceDoc(id: number): Promise<InvoiceTemplateData | null> {
  const full = await getSaleInvoice(id);
  if (full === null) return null;
  const db = await getDb();
  let phone: string | null = null;
  if (full.invoice.customerId !== null) {
    const rows = await db.all<{ phone: string | null }>('SELECT phone FROM customer WHERE id = ?', [
      full.invoice.customerId,
    ]);
    phone = rows[0]?.phone ?? null;
  }
  const inv = full.invoice;
  return {
    company: await getCompanyHeader(),
    docTitle: SALE_DOC_TITLES[inv.docType] ?? 'فاتورة بيع',
    docNo: inv.invoiceNo ?? `#${inv.id}`,
    docDate: inv.issuedAt,
    partyLabel: invT.customerLabel,
    partyName: full.customerName ?? invT.cashCustomer,
    partyPhone: phone,
    warehouseName: full.warehouseName,
    cashboxName: full.cashboxName,
    currencyCode: full.currencyCode,
    currencyDecimals: full.currencyDecimals,
    items: full.items.map((it) => ({
      name: it.productName ?? it.lineDesc ?? 'بند',
      qty: it.qty,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent,
      lineTotal: it.lineTotal,
    })),
    subtotal: inv.subtotal,
    discountAmount: inv.discountAmount,
    taxRate: inv.taxRate,
    taxAmount: inv.taxAmount,
    total: inv.total,
    paidAmount: inv.paidAmount,
    dueAmount: inv.dueAmount,
    notesPrinted: inv.notesPrinted,
    statusLabel:
      inv.status === 'draft'
        ? 'مسودة — لم تُستهلك رقماً بعد'
        : inv.status === 'void'
          ? 'ملغاة'
          : null,
  };
}

/** بيانات فاتورة الشراء/المرتجع لقالب الطباعة. */
export async function purchaseInvoiceDoc(id: number): Promise<InvoiceTemplateData | null> {
  const full = await getPurchaseInvoice(id);
  if (full === null) return null;
  return {
    company: await getCompanyHeader(),
    docTitle: PURCHASE_DOC_TITLES[full.docType] ?? 'فاتورة شراء',
    docNo: full.invoiceNo ?? `#${full.id}`,
    docDate: full.issuedAt,
    partyLabel: 'المورّد',
    partyName: full.supplierName ?? 'مورّد نقدي',
    partyPhone: full.supplierPhone,
    warehouseName: full.warehouseName,
    cashboxName: full.cashboxName,
    currencyCode: full.currencyCode,
    currencyDecimals: full.currencyDecimals,
    items: full.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent,
      lineTotal: it.lineTotal,
    })),
    subtotal: full.subtotal,
    discountAmount: full.discountAmount,
    taxRate: full.taxRate,
    taxAmount: full.taxAmount,
    total: full.total,
    paidAmount: full.paidAmount,
    dueAmount: full.dueAmount,
    notesPrinted: full.notesPrinted,
    statusLabel: full.status === 'draft' ? 'مسودة' : full.status === 'void' ? 'ملغاة' : null,
  };
}

// ============ الإجراءات عالية المستوى ============

/** طباعة فاتورة بيع أو شراء بالإعدادات الحالية (أو الممررة مؤقتاً من شيت الخيارات). */
export async function printInvoice(
  kind: 'sale' | 'purchase',
  id: number,
  overrides?: Partial<PrintOptions>,
): Promise<void> {
  const doc = kind === 'sale' ? await saleInvoiceDoc(id) : await purchaseInvoiceDoc(id);
  if (doc === null) throw new Error('تعذر تحميل الفاتورة للطباعة — أعد المحاولة');
  const opts = { ...(await getPrintOptions()), ...overrides };
  const html = invoiceHtml(doc, { paper: opts.paper, detailed: opts.detailed });
  // النسخ المتعددة (printing.copies): حوار المتصفح يتحكم بها على الويب — الجهاز يكرر الطباعة
  const times = isWeb ? 1 : opts.copies;
  for (let i = 0; i < times; i += 1) {
    await printHtml(html, doc.docNo);
  }
}

/** رسالة واتساب النصية للفاتورة (FR-10-02). */
export function invoiceWhatsAppMessage(docNo: string, total: string, currencyCode: string): string {
  return `فاتورتكم ${docNo} بقيمة ${formatMoney(total, 2)} ${currencyCode} — شكراً لتعاملكم معنا.`;
}

/** مشاركة الفاتورة واتساب: نص للعميل + PDF مرفق على الجهاز (قائمة المشاركة). */
export async function shareInvoiceViaWhatsApp(
  kind: 'sale' | 'purchase',
  id: number,
  phone: string | null,
): Promise<void> {
  const doc = kind === 'sale' ? await saleInvoiceDoc(id) : await purchaseInvoiceDoc(id);
  if (doc === null) throw new Error('تعذر تحميل الفاتورة للمشاركة — أعد المحاولة');
  const opts = await getPrintOptions();
  const html = invoiceHtml(doc, { paper: opts.paper, detailed: opts.detailed });
  const message = invoiceWhatsAppMessage(doc.docNo, doc.total, doc.currencyCode);
  await sendWhatsApp(phone, message, { html, fileName: `${doc.docNo}.pdf` });
}

// ============ السند المرقّم (FR-04-10) ============

export async function printVoucher(tx: CashTxRow, voucherNo: string): Promise<void> {
  const isReceipt = tx.txType === 'receipt';
  const data: VoucherTemplateData = {
    company: await getCompanyHeader(),
    kindLabel: isReceipt ? 'سند قبض' : 'سند صرف',
    voucherNo,
    date: tx.txDate,
    partyLabel: 'الطرف',
    partyName:
      tx.customerName ?? tx.supplierName ?? tx.expenseCategoryName ?? tx.toCashboxName ?? '—',
    cashboxName: tx.cashboxName,
    description: tx.description,
    amount: tx.amount,
    currencyCode: tx.currencyCode,
    currencyDecimals: tx.currencyDecimals,
  };
  await printHtml(voucherHtml(data), voucherNo);
}

// ============ كشف الحساب ============

const DOC_TYPE_LABELS: Record<string, string> = {
  sale: stT.docSale,
  sale_return: stT.docSaleReturn,
  receipt: stT.docReceipt,
  purchase: stT.docPurchase,
  purchase_return: stT.docPurchaseReturn,
  payment: stT.docPayment,
  cheque: stT.docCheque,
};

/** طباعة كشف حساب (A4) — من StatementResult الجاهز. */
export async function printStatement(
  result: StatementResult,
  partyKind: 'customer' | 'supplier',
  period?: { from?: string; to?: string },
): Promise<void> {
  const lines: StatementTemplateLine[] = result.lines.map((l) => ({
    date: l.date,
    docNo: l.docNo,
    typeLabel: DOC_TYPE_LABELS[l.docType] ?? l.docType,
    debit: l.debit,
    credit: l.credit,
    balance: l.balance,
  }));
  const periodLabel =
    period !== undefined && (period.from !== undefined || period.to !== undefined)
      ? `الفترة: ${period.from ?? 'البداية'} — ${period.to ?? 'اليوم'}`
      : null;
  const data: StatementTemplateData = {
    company: await getCompanyHeader(),
    partyKindLabel: partyKind === 'customer' ? stT.titleCustomer : stT.titleSupplier,
    partyName: result.partyName,
    currencyCode: result.currencyCode,
    periodLabel,
    opening: result.opening,
    closing: result.closing,
    lines,
    generatedAt: new Date().toISOString(),
  };
  await printHtml(statementHtml(data), `كشف-${result.partyName}`);
}

// ============ تقرير الوردية ============

export async function printShiftReport(shift: ShiftRow, cashboxName: string): Promise<void> {
  // وارد/صادر نافذة الوردية الأصلية (من فتحها حتى تاريخ إقفالها) — نفس معادلة القرار 9
  const windowEnd = (shift.closedAt ?? shift.openedAt).slice(0, 10);
  const win = await shiftWindowSummary(shift.cashboxId, shift.openedAt.slice(0, 10), windowEnd);
  const data = {
    company: await getCompanyHeader(),
    cashboxName,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    openingCount: shift.openingCount ?? '0',
    expectedIn: win.expectedIn,
    expectedOut: win.expectedOut,
    expected: shift.expected ?? win.expected,
    counted: shift.counted ?? '0',
    difference: shift.difference ?? '0',
    currencyCode: win.currencyCode,
    currencyDecimals: win.currencyDecimals,
    notes: shift.notes,
  };
  await printHtml(shiftHtml(data), `وردية-${cashboxName}`);
}

// ============ التقارير العامة (FR-10-09 — طباعة/مشاركة أي تقرير) ============

export interface PrintReportPayload {
  title: string;
  columns: string[];
  rows: string[][];
  periodFrom?: string | null;
  periodTo?: string | null;
  totalRow?: string[] | null;
  note?: string | null;
}

/** طباعة أي تقرير جدولي بقالب A4 موحّد (رأس المنشأة + الفترة + الجدول). */
export async function printReport(payload: PrintReportPayload): Promise<void> {
  const company = await getCompanyHeader();
  const html = reportHtml({
    company,
    title: payload.title,
    periodFrom: payload.periodFrom ?? null,
    periodTo: payload.periodTo ?? null,
    columns: payload.columns,
    rows: payload.rows,
    totalRow: payload.totalRow ?? null,
    note: payload.note ?? null,
  });
  await printHtml(html, payload.title);
}
