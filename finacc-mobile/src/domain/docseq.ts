import { getDb } from '@/db/client';
import { todayISO } from '@/utils/format';

/**
 * الترقيم الذري للمستندات (قرار 6 + الملحق د):
 *   INV-YYYY-NNNNN (فاتورة بيع) • PUR (شراء) • SRN (مرتجع بيع) • PRN (مرتجع شراء)
 *   RVT (سند قبض) • PMT (سند صرف)
 * — لا إعادة استخدام للأرقام أبداً، والفراغ مسموح، والمسودة لا تستهلك رقماً.
 *
 * الاستهلاك جملة SQL واحدة ذرية (UPSERT … RETURNING) — يُمنع MAX+1 إطلاقاً.
 * إن استُدعيت داخل transaction الحفظ (المسار الطبيعي) تنضم الجملة إليها،
 * فيُستهلك الرقم ويرجَع معها عند فشل أي خطوة أخرى في الحفظ (قاعدة الذرّة 5.4-4).
 *
 * انتباه توازٍ (مهم): لما كانت الجملة الواحدة ذرية بذاتها فلا نلفّها بـ db.transaction هنا —
 * محرك sql.js ينفّذ المعاملات المتوازية عبر Promise.all كـ SAVEPOINTs متداخلة تحت أول
 * BEGIN، وأول COMMIT ينهي الكل فيفشل RELEASE اللاحق؛ بينما الجملة المفردة آمنة تماماً
 * تحت 100 استدعاء متوازٍ (موثق باختبار docseq).
 */

export type DocType = 'INV' | 'PUR' | 'SRN' | 'PRN' | 'RVT' | 'PMT';

/** بادئة غير INV ثابتة حرفياً من الملحق د؛ بادئة INV إعدادية (company.invoice_prefix). */
const DEFAULT_INV_PREFIX = 'INV';

const SQL_UPSERT_RETURNING =
  'INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, 1) ' +
  'ON CONFLICT(doc_type, year) DO UPDATE SET last_no = last_no + 1 ' +
  'RETURNING last_no';

const SQL_UPSERT =
  'INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, 1) ' +
  'ON CONFLICT(doc_type, year) DO UPDATE SET last_no = last_no + 1';

function pad5(seq: number): string {
  return String(seq).padStart(5, '0');
}

/** التحقق من صيغة التاريخ YYYY-MM-DD واستخراج السنة. */
function yearOf(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`تاريخ غير صالح للترقيم: «${date}» — استخدم صيغة YYYY-MM-DD مثل 2026-05-15`);
  }
  return Number(date.slice(0, 4));
}

/** بادئة INV من إعدادات الشركة (fallback 'INV' قبل الإعداد الأولي أو إن كانت فارغة). */
async function getInvoicePrefix(): Promise<string> {
  const db = await getDb();
  const rows = await db.all<{ invoice_prefix: string | null }>('SELECT invoice_prefix FROM company LIMIT 1');
  const prefix = rows.length > 0 ? (rows[0].invoice_prefix ?? '').trim() : '';
  return prefix.length > 0 ? prefix : DEFAULT_INV_PREFIX;
}

// ---------- المسار الأساسي: UPSERT … RETURNING (جملة واحدة ذرية) ----------

let returningBroken = false; // يُضبط بعد أول فشل صيغة (محرك بلا دعم RETURNING)

function looksLikeReturningUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('returning') || msg.includes('syntax');
}

// ---------- المسار البديل: UPSERT ثم SELECT داخل نفس المعاملة، مع تسلسل صارم ----------
// الأمان هنا من ثلاث طبقات: JS أحادي الخيط + سلسلة تسلسل (mutex) تمنع تشابك
// الاستدعاءات المتوازية حول نفس العداد + db.transaction التي تضم الجملتين معاً.
// (sql.js 1.14 يدعم RETURNING فعلاً — هذا المسار احتياطي لمحركات أقدم فقط.)

let fallbackChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = fallbackChain.then(fn, fn);
  fallbackChain = next.catch(() => undefined);
  return next;
}

async function consumeViaFallback(docType: DocType, year: number): Promise<number> {
  const db = await getDb();
  return runSerialized(() =>
    db.transaction(async () => {
      await db.run(SQL_UPSERT, [docType, year]);
      const rows = await db.all<{ last_no: number }>(
        'SELECT last_no FROM doc_sequence WHERE doc_type = ? AND year = ?',
        [docType, year],
      );
      if (rows.length === 0) {
        throw new Error('فشل استهلاك رقم المستند — تعذر قراءة العداد بعد التحديث. أعد المحاولة');
      }
      return Number(rows[0].last_no);
    }),
  );
}

/** فرض المسار البديل — لاختبارات الوحدة فقط. */
export function _forceFallbackForTests(flag: boolean): void {
  returningBroken = flag;
}

/**
 * استهلاك الرقم التالي لنوع مستند في سنة تاريخه.
 * يعيد { docNo: 'INV-2026-00001', seq: 1 } — التسلسل مستقل لكل (نوع، سنة).
 */
export async function nextDocNumber(
  docType: DocType,
  opts?: { date?: string },
): Promise<{ docNo: string; seq: number }> {
  const date = opts?.date ?? todayISO();
  const year = yearOf(date);
  const prefix = docType === 'INV' ? await getInvoicePrefix() : docType;

  let seq: number | null = null;
  if (!returningBroken) {
    try {
      const db = await getDb();
      const rows = await db.all<{ last_no: number }>(SQL_UPSERT_RETURNING, [docType, year]);
      if (rows.length > 0) seq = Number(rows[0].last_no);
    } catch (err) {
      if (looksLikeReturningUnsupported(err)) {
        returningBroken = true; // جملة لم تُنفَّذ — التحويل للمسار البديل آمن
      } else {
        throw err;
      }
    }
  }
  if (seq === null || !Number.isFinite(seq) || seq < 1) {
    seq = await consumeViaFallback(docType, year);
  }
  return { docNo: `${prefix}-${year}-${pad5(seq)}`, seq };
}
