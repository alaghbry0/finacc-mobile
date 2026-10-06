# سجل العمل الموحد — مشروع FinAcc «المُحاسِب الشخصي»

> **هذا الملف هو سجل العمل المشترك لكل الوكلاء.** كل وكيل MUST يقرأه قبل البدء وMUST يضيف قسمه في النهاية (append فقط، لا تُمسح الأقسام السابقة).
> مصدر الحقيقة: `/home/z/my-project/وثيقة-مواصفات-التطبيق-المحاسبي-SRS.md` (v1.2 Frozen — 1496 سطراً).

## قوانين عليا للبيئة (من مهارة sandbox-multi-stack + قواعد المشروع)

1. **مشروع RN في** `/home/z/my-project/finacc-mobile/` — لا `create-expo-app` أبداً، هيكلة يدوية بالإصدارات المثبتة أدناه.
2. **لا Metro حي / لا HMR / لا محاكي / لا EAS داخل البيئة.** حلقة العمل: تعديل → `bash scripts/build-rn-web.sh` داخل finacc-mobile (~90 ثانية، مع flock) → معاينة على `http://127.0.0.1:3000/rn/index.html`.
3. البوابة قبل إنهاء كل مهمة: `cd finacc-mobile && npx tsc --noEmit` (صفر أخطاء) + `bash scripts/build-rn-web.sh` ينجح + `bun test` أخضر لمن يمس الدومين.
4. **الرام 4GB**: قبل أي أمر ثقيل `free -m` — إذا كان المتاح < 800MB انتظر أو نظف. تصدير واحد في كل مرة (flock موجود في السكربت).
5. **git**: كل شيء يجب أن يُعمل commit عند نهاية الموجة (node_modules مهملة تلقائياً؛ مجلد db/ وprisma للمشروع الرئيسي فقط لا علاقة له بنا).
6. خادم dev الرئيسي على 3000 يعمل دائماً (Next.js — قشرة المعاينة فقط). لا تلمس src/app إلا في مهمة صفحة الهبوط (Task 7).
7. z-ai-web-dev-sdk في الخلفية فقط (غير مطلوب في التطبيق نفسه — التطبيق أوفلاين 100%).

## البنية التقنية المعتمدة (حرفياً من SRS القسم 0.3 + قرارات البيئة)

- Expo SDK 54 / expo-router ~6.0.24 / react-native 0.81.5 / react 19.1.0 / react-dom 19.1.0 / react-native-web ^0.21.0 / @expo/metro-runtime ~6.1.2 / typescript ~5.3.3 (strict).
- **قاعدة البيانات**: drizzle-orm + موصل مخصص `sqlite-proxy` فوق طبقة `src/db/client.ts` التي تتفرع: **native → expo-sqlite (WAL)** / **web → sql.js (WASM من /rn/assets/sql-wasm.wasm) مع استمرارية IndexedDB (تصدير كامل debounced بعد كل commit + استرجاع عند الإقلاع)**. — قرار بيئة موثق: expo-sqlite على الويب يحتاج COOP/COEP (مستحيل عبر البوابة) لذا sql.js يحمل الاستمرارية في المعاينة، والجهاز الحقيقي يستخدم expo-sqlite كما في الـ SRS. المخطط والهجرات واحدة للمنصتين.
- **الهجرات**: ملفات TS تصدّر نص SQL — `src/db/migrations/0001_init.ts` يحمل DDL حرفياً من SRS §5.3 (بما فيه triggers حماية audit_log والفهارس). جدول `_migrations` للتتبع. الاستعادة من نسخة أحدث → رفض.
- **الحزم**: zod (كل كتابة) + zustand (الحالة) + decimal.js (كل مبلغ NUMERIC يُقرأ Decimal ويُخزن نصاً) + lucide-react-native + react-native-svg + react-native-qrcode-svg (QR) + expo-camera (باركود — على الويب إدخال يدوي fallback) + expo-print/expo-sharing/expo-linking + expo-file-system/expo-document-picker + @expo-google-fonts/tajawal + ibm-plex-sans-arabic + cairo + expo-secure-store + expo-local-authentication + expo-keep-awake + expo-splash-screen + expo-status-bar + expo-constants.
- **قرارات انحراف موثقة عن SRS (بيئة فقط، لا تغيير وظيفي)**:
  - react-native-paper غير مستخدم — كل مكونات §6.3 مخصصة أصلاً (AppCard, StatTile, BottomSheet, NumberPad...) وRNPIcon fonts تكسر التصدير الثابت. المكونات المخصصة تغطي DS-17→40 بالكامل.
  - Argon2id وحدة native — في المعاينة: PBKDF2 عبر WebCrypto كطبقة تجريبية بنفس الواجهة `src/services/crypto.ts` (عند EAS تُستبدل). SQLCipher كذلك لنسخ EAS فقط.
  - الطباعة الحرارية BLE والكاميرا والمستشعرات: تعمل على الجهاز فقط؛ على الويب fallback واضح. منطق Raster نقي TS مختبر.
  - Jest → `bun test` (توافق describe/test/expect) لأن bun يشغّل TS مباشرة بلا إعداد.
- **i18n**: `src/i18n/ar.ts` فهرس يجمع ملفات لكل وحدة (`ar/common.ts`, `ar/sales.ts`, ...) — كل وكيل يضيف ملف وحدته فقط لتفادي تعارض الدمج.
- **RTL**: I18nManager.forceRTL(true) + سكربت البناء يحقن dir="rtl". الأيقونات الموجهة تُقلب يدوياً.

## الخريطة الزمنية (موجات، حسب القسم 9 مضغوطاً)

| الموجة | المهام (موازية داخل الموجة) | المحتوى |
|---|---|---|
| 0 | منجزة | قراءة SRS كاملاً، الأصول (icon/splash/hero)، هذا السجل |
| 1 | Task 1 | الهيكلة + DB client + schema + هجرة 0001 + سكربت بناء + شاشة دخول مؤقتة للتحقق |
| 2 | Task 2-a ∥ Task 2-b | الدومين+الاختبارات ∥ نظام التصميم+i18n+الهيكل+Onboarding+PIN |
| 3 | Task 3-a ∥ Task 3-b | الأصناف/المخزون ∥ الأطراف/العملات/الصرف |
| 4 | Task 4-a ∥ Task 4-b | شاشة البيع الكاشير ∥ الشراء+المرتجعات+القوائم |
| 5 | Task 5-a ∥ Task 5-b | الصناديق+الوردية+السندات ∥ الشيكات+الأقساط+الكشوف |
| 6 | Task 6-a ∥ Task 6-b | الداشبورد+التقارير+الجرد ∥ الطباعة+النسخ+الإعدادات |
| 7 | Task 7 | صفحة الهبوط + QA نهائي + commit + توثيق APK |

**الهدف الأول الملزم (يُغلق في الموجة 4): فاتورة مبيعات تُحفظ ثم تُطبع.**

---
Task ID: 0
Agent: المنسق الرئيسي (Super Z)
Task: قراءة SRS كاملاً وتجهيز البيئة والخطة والأصول

Work Log:
- قراءة وثيقة SRS v1.2 كاملة (1496 سطراً) وتنزيلها إلى `/home/z/my-project/وثيقة-مواصفات-التطبيق-المحاسبي-SRS.md` من رابط Drive.
- تنزيل وتفكيك مهارة sandbox-multi-stack (من الرابط الثاني) والاطلاع على وصفة RN/Expo المضمونة (SDK 54 + حلقة التصدير الثابت).
- فحص البيئة: خادم dev على 3000 يعمل، ذاكرة متاحة ~3GB، git سليم، Caddyfile موجود.
- توليد الأصول: `finacc-mobile/assets/icon.png` + `splash-icon.png` (1024×1024) + `hero.png` (1344×768) عبر مهارة توليد الصور.
- كتابة هذا السجل وقائمة المهام.

Stage Summary:
- مصدر الحقيقة محلي الآن (SRS) + المهارة مقروءة. الإصدارات المثبتة: Expo 54.0.37/RN 0.81.5/React 19.1/RNW 0.21.
- القرارات البيئية الموثقة أعلاه (sql.js للمعاينة، بدون RNP، bun test بدل Jest) ملزمة لكل الوكلاء اللاحقين.
- كل وكيل يبدأ بقراءة هذا الملف + الأقسام المطلوبة من SRS، وينهي بإضافة قسمه + بوابات الجودة (tsc + build + test حسب الحالة).

---
Task ID: 1
Agent: general-purpose (sonnet) + تدقيق المنسق
Task: هيكلة finacc-mobile يدوياً + طبقة قاعدة البيانات (sql.js/expo-sqlite + drizzle) + الهجرة 0001 + سكربت البناء + شاشة تحقق

Work Log:
- إنشاء بنية المشروع يدوياً (بدون create-expo-app): package.json بالتوليفة المضمونة (Expo 54.0.37 + expo-router 6.0.24 + RN 0.81.5 + React 19.1 + RNW 0.21)، app.json (RTL dark portrait + أذونات), tsconfig strict + alias @/*، babel، eas.json، .gitignore.
- تثبيت الاعتماديات: expo install (expo-sqlite, expo-camera, expo-print, expo-sharing, expo-file-system, expo-document-picker, expo-secure-store, expo-local-authentication, expo-keep-awake, expo-splash-screen) + bun add (zod, zustand, decimal.js, sql.js, drizzle-orm, lucide-react-native, react-native-svg, react-native-qrcode-svg) + خطوط Google (@expo-google-fonts tajawal + ibm-plex-sans-arabic).
- src/db/: types.ts (واجهة DbEngine: run/all/exec/transaction/persist) + engine-web.ts (sql.js + استمرارية IndexedDB مع debounce 400ms + استرجاع عند الإقلاع + clearWebPersistence) + engine-native.ts (expo-sqlite + WAL، import ديناميكي فقط) + client.ts (كشف HermesInternal — بلا استيراد react-native) + migrate.ts + migrations/0001_init.ts (DDL كامل من SRS §5.3 مع triggers حماية audit_log والفهارس) + schema.ts (744 سطراً — Drizzle لكل الجداول) + drizzle.ts (sqlite-proxy) + test-db.ts (مساعد اختبارات in-memory).
- scripts/build-rn-web.sh: تصدير + إصلاحات (RTL، مسارات /rn/ في HTML وJS، حقن replaceState) + flock لمنع البناء المتوازي + نسخ wasm.
- app/_layout.tsx + app/index.tsx شاشة تحقق (عدد الجداول/إصدار الهجرة/seed) + src/theme.ts (ألوان DS-01→11) + src/i18n/ar.ts + src/utils/format.ts.
- إصلاحان من المنسق بعد التدقيق: (1) سكربت البناء كان ينسخ sql-wasm.wasm فقط بينما Metro يحل exports.browser → sql-wasm-browser.js الذي يطلب sql-wasm-browser.wasm — أُضيف نسخه. (2) زر seed كان يُدخل created_at في جدول currency (غير موجود في DDL — جدول مرجعي بلا طوابع) — صُحح.

Stage Summary:
- البوابات: tsc صفر أخطاء ✓ | bun test: 7 pass (30+ جدول، triggers append-only، doc_sequence ذري ×2، ROLLBACK، SAVEPOINT متداخل، تسجيل هجرة) ✓ | التصدير والدمج في public/rn ✓ | متصفح: 33 جدولاً، هجرة 1، seed عملة+شركة ✓، **الاستمرارية عبر إعادة التحميل ✓ (IndexedDB finacc)**.
- API للوكلاء اللاحقين: `import { getDb, setDbEngineForTesting } from '@/db/client'` + `DbEngine` من '@/db/types' + `getDrizzle()` من '@/db/drizzle' + المعاملات حصراً عبر `db.transaction(fn)` (لا drizzle.transaction) + مساعد الاختبارات `createTestDb/disposeTestDb` من '@/db/test-db' + الأنواع من '@/db/schema'.
- جدول currency بلا created_at/updated_at (كما في DDL حرفياً) — انتبه عند الإدراج.
- الالتزام: المنسق يلتزم git بعد كل موجة؛ الوكلاء لا يشغّلون git.
