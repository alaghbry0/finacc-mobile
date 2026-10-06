import { getDb } from '@/db/client';
import { todayISO } from '@/utils/format';
import { getSetting } from './settings';
import { logAudit } from './audit';

/**
 * قفل الفترات والتأريخ الرجعي (قاعدة 5.4-11 / قرار 6):
 * - assertPeriodOpen: يرفض أي تاريخ داخل سنة «closed» في fiscal_year.
 * - assertBackdateAllowed: التأريخ الرجعي أكثر من dating.max_backdate_days (افتراضي 30)
 *   يتطلب تأكيد المدير (managerConfirmed) ويقيد في سجل التدقيق.
 * واجهة الإقفال السنوي نفسها → V1.1، لكن الحجاب التطبيقي ملزم الآن لكل مسار كتابة بتاريخ.
 */

export class FiscalPeriodClosedError extends Error {
  readonly year: number;
  readonly date: string;
  constructor(year: number, date: string) {
    super(
      `التاريخ ${date} يقع داخل سنة مالية مقفلة (${year}) — لا يمكن التسجيل فيها. ` +
        `استخدم تاريخاً داخل سنة مفتوحة، أو اطلب من المدير فتح السنة (شاشة الإقفال السنوي)`,
    );
    this.name = 'FiscalPeriodClosedError';
    this.year = year;
    this.date = date;
  }
}

export class BackdateConfirmationRequiredError extends Error {
  readonly date: string;
  readonly daysBack: number;
  readonly limit: number;
  constructor(date: string, daysBack: number, limit: number) {
    super(
      `التاريخ ${date} يرجع ${daysBack} يوماً ويتجاوز الحد المسموح (${limit} يوماً) — ` +
        `الاستمرار يتطلب تأكيد المدير (سيقيد في سجل التدقيق)`,
    );
    this.name = 'BackdateConfirmationRequiredError';
    this.date = date;
    this.daysBack = daysBack;
    this.limit = limit;
  }
}

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`تاريخ غير صالح: «${date}» — استخدم صيغة YYYY-MM-DD مثل 2026-05-15`);
  }
}

/** فرق الأيام (today − date) بالأيام الصحيحة — موجب يعني تاريخاً راجعاً. */
function daysBackFromToday(date: string): number {
  const [y1, m1, d1] = todayISO().split('-').map(Number);
  const [y2, m2, d2] = date.split('-').map(Number);
  const now = Date.UTC(y1, m1 - 1, d1);
  const then = Date.UTC(y2, m2 - 1, d2);
  return Math.round((then - now) / 86_400_000) * -1;
}

/** رفض أي تاريخ داخل سنة مالية مقفلة (fiscal_year.status='closed'). */
export async function assertPeriodOpen(date: string): Promise<void> {
  assertIsoDate(date);
  const db = await getDb();
  const rows = await db.all<{ year: number; status: string }>(
    'SELECT year, status FROM fiscal_year WHERE start_date <= ? AND end_date >= ?',
    [date, date],
  );
  const closed = rows.find((r) => r.status === 'closed');
  if (closed) throw new FiscalPeriodClosedError(Number(closed.year), date);
}

/**
 * هل يُسمح بالتأريخ الرجعي لهذا التاريخ؟
 * - ضمن الحد (dating.max_backdate_days) → يمر مباشرة.
 * - تجاوز الحد بلا تأكيد مدير → BackdateConfirmationRequiredError.
 * - تجاوز الحد مع managerConfirmed=true → يمر + قيد تدقيق backdate_confirmed (FR-12-04).
 */
export async function assertBackdateAllowed(
  date: string,
  opts?: { managerConfirmed?: boolean },
): Promise<void> {
  assertIsoDate(date);
  const limitStr = await getSetting('dating.max_backdate_days');
  const limit = Number(limitStr);
  const daysBack = daysBackFromToday(date);
  if (daysBack <= limit) return;
  if (opts?.managerConfirmed === true) {
    // قيد تدقيق مركزي لكل تأريخ رجعي مؤكد — حتى لو نسي مسارُ كتابةٍ إضافته (FR-12-04)
    await logAudit('backdate_confirmed', {
      details: { date, daysBack, limit, managerConfirmed: true },
    });
    return;
  }
  throw new BackdateConfirmationRequiredError(date, daysBack, limit);
}
