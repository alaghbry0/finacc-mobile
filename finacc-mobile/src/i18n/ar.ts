/**
 * فهرس النصوص العربية (NFR-10) — سجل وحدات:
 * كل وكيل يضيف ملف وحدته داخل src/i18n/ar/ ثم يسجّله هنا فقط — بلا تعارض دمج.
 * الاستيراد الموحّد: `import { ar } from '@/i18n/ar'` (أو { common } مباشرة).
 */
import { common, fill } from './ar/common';
import { auth } from './ar/auth';
import { tabs } from './ar/tabs';
import { inventory } from './ar/inventory';
import { parties } from './ar/parties';
import { currency } from './ar/currency';
import { sales } from './ar/sales';
import { purchases } from './ar/purchases';
import { cash } from './ar/cash';
import { cheques } from './ar/cheques';
import { installments } from './ar/installments';
import { reports } from './ar/reports';
import { settings } from './ar/settings';
import { printing } from './ar/printing';
import { backup } from './ar/backup';

export { fill };
export { common, auth, tabs, inventory, parties, currency, sales, purchases, cash, cheques, installments, reports, settings, printing, backup };

export const ar = { common, auth, tabs, inventory, parties, currency, sales, purchases, cash, cheques, installments, reports, settings, printing, backup };
