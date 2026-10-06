/**
 * فهرس النصوص العربية (NFR-10) — سجل وحدات:
 * كل وكيل يضيف ملف وحدته داخل src/i18n/ar/ ثم يسجّله هنا فقط — بلا تعارض دمج.
 * الاستيراد الموحّد: `import { ar } from '@/i18n/ar'` (أو { common } مباشرة).
 */
import { common, fill } from './ar/common';
import { auth } from './ar/auth';
import { tabs } from './ar/tabs';

export { fill };
export { common, auth, tabs };

export const ar = { common, auth, tabs };
