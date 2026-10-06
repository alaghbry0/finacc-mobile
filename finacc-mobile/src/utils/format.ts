import Decimal from 'decimal.js';

/**
 * تنسيق مبلغ بفواصل آلاف عبر Decimal (لا Float أبداً — قاعدة 5.2-3).
 * مثال: formatMoney(12500, 2) → "12,500.00"
 */
export function formatMoney(value: Decimal | number | string, decimals = 2): string {
  const d = new Decimal(value);
  const fixed = d.toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** تاريخ اليوم بصيغة ISO YYYY-MM-DD (محلي). */
export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
