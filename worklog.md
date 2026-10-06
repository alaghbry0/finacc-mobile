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

---
Task ID: 2-a
Agent: general-purpose (sonnet) + تدقيق المنسق
Task: طبقة الدومين النقية الأساسية + اختبارات منطق الأعمال (المرحلة 1 من SRS)

Work Log:
- src/utils/money.ts: dec/money/roundTo(HALF_UP موثق)/formatMoney/formatSigned عبر decimal.js (precision 28).
- src/services/crypto.ts: hashPin (PBKDF2 100k عبر globalThis.crypto.suble، صيغة pbkdf2$iters$salt$hash) + verifyPinHash + randomId.
- src/domain/settings.ts: سجل إعدادات الملحق هـ كاملاً (17 مفتاحاً) مع zod لكل نطاق + seedDefaultSettings (idempotent).
- src/domain/docseq.ts: nextDocNumber بـ UPSERT ذري (RETURNING غير مدعوم في sql.js — UPSERT ثم SELECT داخل نفس المعاملة، آمن بأحادية الخيط + قفل المعاملة).
- src/domain/fiscal.ts: assertPeriodOpen/assertBackdateAllowed (FiscalPeriodClosedError / BackdateConfirmationRequiredError).
- src/domain/currency.ts: getRateSnapshot (قرار 3: MissingRateError افتراضياً / fx.fallback=last_known بعلم rateIsFallback) + setDailyRate (UPSERT) + listActiveCurrencies/getBaseCurrency/convertToBase.
- src/domain/posting-map.ts: خريطة الترحيل الملزمة (ملحق و) — 9 حسابات، كل tx_type/movement_type + أحداث الشيكات والبيع/الشراء، مع getPosting.
- src/domain/audit.ts + session-user.ts: logAudit + تتبع currentUserId للسجلات.
- src/domain/onboarding.ts: isOnboarded/completeOnboarding داخل transaction واحدة (عملات + شركة + مخزن رئيسي + صندوق رئيسي + app_user + 5 فئات مصاريف بينها «رواتب» + seedDefaultSettings).
- src/domain/auth.ts: verifyPin بسياسة قفل القرار 4 (5+ → تأخير متصاعد 30ث×2^n حتى 15د، 10+ → requirePassphrase) + recordUnlockSuccess + verifyPassphraseAndUnlock.
- الاختبارات: 9 ملفات — docseq (100 استدعاء متوازٍ بلا تكرار/فجوات)، fiscal، currency، settings، posting-map، onboarding (ذرّية الفشل)، auth (تصعيد القفل)، money.

Stage Summary:
- البوابات: tsc صفر أخطاء ✓ | bun test: **116 pass / 0 fail** ✓.
- عقود الدوال متاحة للجميع عبر المسارات أعلاه — أي تعديل مستقبلي عليها يستلزم تحديث الاختبارات.
- على الوكلاء اللاحقين: استخدموا dec()/money() من '@/utils/money' لكل عملية مالية (لا float أبداً)، وlogAudit لكل حدث حساس، وgetPosting للتحقق من أثر أي حركة.

---
Task ID: 2-b
Agent: general-purpose (sonnet) + تدقيق المنسق
Task: نظام التصميم DS-17→40 + i18n سجل وحدات + الهيكل التنقلي + Onboarding + قفل PIN

Work Log:
- i18n كسجل وحدات: src/i18n/ar.ts فهرس يجمع ar/common.ts + ar/auth.ts + ar/tabs.ts (الوكلاء اللاحقون يضيفون ملفاتهم ويسجلونها في الفهرس).
- نظام تصميم كامل في src/components (24 ملفاً + barrel index): Screen, AppCard, AmountText (tnum + علامة غير لونية), StatTile, buttons (Primary/Secondary/Danger/Icon ≥48), SearchBar, ListRow, BottomSheet, EmptyState, NoResultsState, ErrorState, PermissionBlocked, LoadingSkeleton, StatusChip, ConfirmSheet (كلمة تأكيد للأخطار), FeedbackBar + store/toast (Undo), NumberPad, QtyStepper, OfflineBanner (ويب), fields (Field/TextField/PasswordField/SelectField/DateField), SectionTitle, Chip, ComingSoon.
- src/store/session.ts: آلة حالات boot/onboarding/locked/unlocked + unlock(pin) عبر domain + autolock بمؤقت خمول (security.autolock_minutes) + unlockDirect.
- الهيكل: app/_layout.tsx (خطوط + boot + توجيه) + app/(tabs)/_layout.tsx (4 تبويبات + زر بيع وسط بارز بتدرج سماوي router.push('/sales/new')) + dashboards/placeholders للمخزون والنقدية + more.tsx قائمة فعلية (أطراف/تقارير/أقساط/إعدادات/طباعة/حول → stubs ComingSoon على مسارات المستقبل) + sales/new.tsx stub. حُذفت شاشة التحقق القديمة.
- app/auth/onboarding.tsx: 3 شرائح ترحيب → نموذج منشأة (اسم/هاتف/واتساب/عنوان/عملة YER افتراضياً/ضريبة 0) → إنشاء PIN 4-6 أرقام بتأكيد عبر NumberPad → «ابدأ الآن» (hashPin + completeOnboarding).
- app/auth/login.tsx: قفل + NumberPad + زر «فتح» + اهتزاز عند الخطأ + رسائل المحاولات المتبقية + عداد قفل تنازلي + وضع عبارة المرور + زر بصمة (native فقط).

Stage Summary:
- التحقق المتصفحي (agent-browser): Onboarding كامل → الداشبورد بالتبويبات الخمسة ✓ | إعادة تحميل → شاشة القفل ✓ | PIN خاطئ → «رمز PIN غير صحيح — تبقى 4 محاولات» ✓ | PIN صحيح → فتح ✓ | تبويب المخزون يعمل ✓ | صفر أخطاء متصفح ✓.
- لقطات: docs/wave2-dashboard.png + docs/wave2-inventory.png.
- للموجات القادمة: كل شاشة جديدة تبدأ بـ <Screen> وتستخدم المكونات الجاهزة — لا تبنِ Modal/BottomSheet من الصفر. شاشات placeholder القائمة (inventory/cash/sales-new/parties/reports/installments/settings/printing + الداشبورد) ستُستبدل بالكامل.

---
Task ID: 3-a
Agent: general-purpose (sonnet) + تدقيق المنسق
Task: وحدة الأصناف والمخزون — دومين + اختبارات + شاشات (المرحلة 2 من SRS)

Work Log:
- src/utils/barcode.ts: توليد EAN-13 (بادئة 2 نطاق داخلي) + checksum + تحقق.
- src/domain/inventory.ts: createProduct (توليد باركود، خدمي بلا مخزون، كمية افتتاحية كحركة opening داخل المعاملة) + updateProduct + archiveProduct (الباركود يبقى محجوزاً) + getProductFull (أسعار/أرصدة/حركات) + searchProducts (LIKE + رصيد + سعر أساس) + findByBarcode + adjustStock (manual_adjust + منع السالب برسالة تسمّي الصنف) + listBelowMinStock + فئات/وحدات CRUD كاملة.
- الشاشات: (tabs)/inventory.tsx قائمة حية ببحث فوري وdebounce + BottomSheet مسح (ويب: إدخال يدوي) + inventory/new.tsx نموذج كامل (أسعار لكل عملة، خدمي، افتتاحية) + [id].tsx بطاقة صنف (QR + أرصدة مخازن + أسعار عملات + آخر 10 حركات + تعديل/أرشفة/تعديل رصيد) + alerts + categories + units + [id]/edit (نموذج مشترك ProductForm).
- i18n: ar/inventory.ts كامل.

Stage Summary:
- البوابات: tsc صفر ✓ | bun test الكل أخضر ✓ | تصدير ✓ | متصفح: إنشاء صنف كامل (باركود مولد 2182524042020، تكلفة، سعر YER، كمية افتتاحية 10) → ظهور بالقائمة → بطاقة كاملة بحركة افتتاحية +10 ✓ | صفر أخطاء ✓.
- مؤجل موثق: استيراد Excel (FR-01-13)، تحويل المخازن (FR-01-09 → V1.1)، الدفعات FEFO (FR-01-10)، تحديث الأسعار بالصرف (FR-01-11).
- عقود الدوال النهائية في src/domain/inventory.ts — شاشة البيع (الموجة 4) تستخدم searchProducts/findByBarcode/getProductFull.

---
Task ID: 3-b
Agent: general-purpose (sonnet) + تدقيق المنسق
Task: الأطراف (عملاء/موردون) + إدارة العملات وأسعار الصرف — دومين + اختبارات + شاشات

Work Log:
- src/domain/parties.ts: CRUD عملاء/موردين (حد ائتمان NULL/0 semantics، رصيد افتتاحي بعملته وسعره وتاريخه) + customerBalances/supplierBalances بمعادلة القرار 8 الحرفية (opening + Σ sale.due − Σ receipts − Σ sale_return.due لكل عملة على حدة) + بحث.
- توسيع src/domain/currency.ts: addCurrency/setCurrencyActive (الأساس لا يُعطل)/rateHistory/missingRateToday.
- الشاشات: parties/index.tsx (تبويب عملاء/موردون + قائمة + رصيد بدلالة مدين/دائن) + نماذج إنشاء وتعديل لكل من العملاء والموردين (PartyForm مشترك) + ملفات [id] (أرصدة لكل عملة + اتصال/واتساب wa.me عبر open-url) + settings/index.tsx قائمة إعدادات حقيقية + settings/currencies.tsx (إدارة عملات + سعر اليوم + سجل + شارات النقص).
- i18n: ar/parties.ts + ar/currency.ts + ar/settings.ts.

Stage Summary:
- البوابات: tsc صفر ✓ | bun test الكل أخضر (اختبار معادلة الرصيد بصفوف فواتير/سندات يدوية = AC-02 مبسط) ✓ | تصدير ✓ | متصفح: عميل «أحمد سعيد» برصيد افتتاحي 100,000 YER → مدين في القائمة والملف ✓ | سعر SAR أُدخل وحُفظ ✓ | شارة «لا سعر اليوم» تعمل ✓.
- مؤجل موثق: كشف الحساب التفصيلي (FR-03-04 → موجة 5)، استيراد عملاء Excel (FR-03-08).
- ملاحظة للموجة 4/5: معادلة الرصيد تستحقى من الجداول مباشرة — أي كتابة فاتورة/سند تلتزم بالمخطط تُحدّث الأرصدة تلقائياً بلا كود إضافي.

---
Task ID: 4-a + 4-b + 4-c (موجة الفوترة — الهدف الأول للمشروع)
Agent: 3 وكلاء general-purpose (sonnet) + تدقيق وإصلاحات المنسق
Task: شاشة البيع الكاشير + الشراء + المرتجعات المرتبطة + القوائم والتفاصيل — الدومين الذرّي الكامل

Work Log:
- src/domain/invoicing.ts (1320 سطراً): saveSaleInvoice داخل transaction واحدة (فحص مخزون برسالة تسمّي الصنف/الكمية الناقصة + snapshot سعر صرف + WAC line_cost + docseq INV + حركات مخزون سالبة + cash_tx receipt + payment_allocation + حد ائتمان warn/block) + convertDraftToCompleted (استهلاك الرقم عند التحويل + فحص الرصيد وقتها) + voidInvoice (حركات معاكسة كاملة + is_voided + reversal_of + رفض عند وجود مرتجعات) + getSaleInvoice/listInvoices/listBestSellers.
- src/domain/purchasing.ts (896): حفظ شراء بتوزيع خصم الرأس pro-rata قبل تحديث WAC (قاعدة 5.4-3) + دفع payment/آجل/مختلط + voidPurchase + getPurchaseInvoice/listPurchaseInvoices.
- src/domain/returns.ts (1018): createSaleReturn (بتكلفة line_cost الأصلية — لا WAC الجاري) + createPurchaseReturn (سعر Snapshot + إعادة حساب WAC للمتبقي) + returnableLines (المباع − المرتجع) + فحوصات AC-21 (كمية زائدة/فاتورة ملغاة).
- src/store/cart.ts (519): سلة zustand كاملة (بنود/عميل/صندوق/عملة/مستودع) + Park (سلال معلقة) + مسودة throttled تُستعاد بعد الانهيار مع Banner.
- شاشات البيع: 5 مكونات جاهزة (PaymentSheet DS-40 بالفئات السريعة و«المبلغ بالضبط» و«تحويل المتبقي آجلاً»، CustomerPickerSheet، ScanSaleSheet، ParkedCartsSheet، ExtrasSheet) + app/sales/new.tsx (§6.5 حرفياً: شريط أهداف Chips + بنود حية ب«المتاح: N» + QtyStepper + إجماليات ثابتة أسفل + 4 أزرار) + index.tsx قائمة بفلاتر + [id].tsx تفاصيل (شارة سعر تقديري + تكلفة/ربح + مرتجعات مرتبطة + إلغاء بكلمة تأكيد + تحويل مسودة) + return.tsx عبر ReturnFlow المشترك.
- الشراء: new.tsx + index.tsx + [id].tsx + return.tsx.
- الاختبارات: **211 pass** (آلة الحالات كاملة + 100 فاتورة متوازية + AC-02/03/21 + WAC + مرتجعات).

Stage Summary:
- **إصلاحات المنسق بعد موت الوكلاء عند المهلة**: (1) itemPicker لم يكن يغلق بعد إضافة صنف مسعَّر → backdrop خفي يحجب النقرات — صُحح addProduct ليغلق دائماً + شبكة أمان إجبارية لفك تركيب BottomSheet بعد 500ms. (2) router.push('/sales/index') كان يطابق مسار [id] — صُحح إلى '/sales'. (3) أخطاء tsc صغيرة (toFormat→formatMoney، SectionTitle+hint، استيراد مكرر، أنواع globals.d.ts).
- **التحقق المتصفحي النهائي (المنسق)**: بيع نقدي 3×1,000 عبر PaymentSheet «المبلغ بالضبط» → **INV-2026-00001** حُفظت والمخزون 50→47 بعد مرتجع + رصيد العميل 1,000 بعد بيع آجل (INV-2026-00002) + **مسودة السلة استُعيدت بعد إعادة التحميل مع Banner** (AC-23) + مرتجع SRN-2026-00001 يظهر مرتبطاً بالأصل والمخزون عاد + القائمة بالفلاتر تعمل + Print-on-save=ask يظهر بعد الحفظ. صفر أخطاء متصفح.
- ملاحظة للصقل: تفاصيل الفاتورة لا تعيد جلب «المرتجعات المرتبطة» تلقائياً بعد حفظ مرتجع (تظهر بعد إعادة تحميل) — تُصلح في موجة الصقل (useFocusEffect).
- **الهدف الأول «فاتورة مبيعات تُحفظ» تحقق** — الطباعة الفعلية توصلها الموجة 6.

---
Task ID: 5-a + 5-b + 5-c (موجة النقدية والديون)
Agent: 3 وكلاء general-purpose (sonnet) + تدقيق وإصلاحات المنسق
Task: الصناديق والحركات والسندات والوردية + الشيكات والأقساط وكشوف الحساب

Work Log:
- src/domain/cash.ts (1252 سطراً): createCashTx بكل الأنواع التسعة + cashboxBalances (رصيد حي لكل صندوق بعملته) + allocateOnAccountReceipt (تخصيص FIFO) + voidCashTx (معاكسة reversal_of) + consumeVoucherNo (سند مرقّم RVT/PMT عند الطباعة الأولى) + الوردية الكاملة (openShift/shiftExpected/closeShift بمعادلة القرار 9 الشاملة) + تحويل بين صندوقين بعملتين بحركتين + settlement_rate + fx_gain_loss.
- src/domain/cheques.ts: دورة حياة كاملة (create/pending → deposited → cleared [cash_tx + تسوية الفاتورة/الدين + fx] → bounced [عكس الدين + رسم مصروف + audit] → void [مدير]) + dueSoonCheques.
- src/domain/installments.ts: createInstallmentPlan (آجل فقط + دفعة أولى linked cash_tx + جدول بالفرق على الأخير 5.4-9) + installmentsDue (يوم/أسبوع/متأخر) + collectInstallment (قبض + partial) + reschedule (audit) + cancelPlan (مدير).
- src/domain/statements.ts: كشوف عملاء/موردين لكل عملة على حدة برصيد رأسي متحرك + الأحداث المعروضة بعملة الكشف حصراً (قرار 8).
- الشاشات (5-c): (tabs)/cash.tsx (صناديق بالأرصدة الحية + تحذير السالب + حركات بتبويب + شيكات عبر ChequesTab) + tx-new (8 أنواع بحدولها) + shift (فتح/معادلة حية/إقفال بعدد + عجز/زيادة) + cheques (قائمة/تفاصيل/جديد + أزرار دورة الحياة) + installments (قائمة/مستحق/تفاصيل + PlanFormSheet بمعاينة الجدول + زر تقسيط في تفاصيل الفاتورة) + statements (StatementView + أزرار في ملفات الأطراف) + VoucherSheet (معاينة السند المرقّم).
- الاختبارات: **251 pass** (+40: الوردية/FIFO/تحويل بعملتين/سندات/شيكات AC-17/أقساط AC-05 وتقريبها/كشوف AC-18).

Stage Summary:
- **إصلاحات المنسق**: (1) bounceFee cast بسيط. (2) **خلل installmentsDue: SELECT لم يكن يجلب p.currency_id → currencyId=NaN → «لا صندوق بعملة الخطة»** — أُضيف العمود للاستعلام وأعيد التصدير. (3) ChequeCard الناقص بناه 5-c.
- **التحقق المتصفحي الكامل (المنسق، بيانات جديدة من الصفر)**: نقدية: الصندوق 1,000 بعد بيع نقدي ✓ مسحوبة مالك 500 → 500 + toast ✓ الوردية: افتح (عد 500) → الوارد +1,000/الصادر −500/المتوقع 500 ✓ إقفال بعدد 990 → **«عجز في الدرج −10»** ✓ الشيك CHK-1001 وارد 400: pending لا يمس الرصيد ✓ cleared → رصيد أحمد 1,000→600 + سند قبض ✓ خطة 4×150 من INV-00002 (معاينة صحيحة) → حصّل قسطاً → 450 ✓ **كشف حساب YER: افتتاحي 0 → 3 أحداث (فاتورة مدين/شيك دائن/قسط دائن) → ختامي 450 متطابق تماماً** ✓ صفر أخطاء.
- لقطات: docs/wave5-shift.png, wave5-statement.png, wave5-cheque.png.
- روابط wa.me جاهزة (تذكير واتساب) — الطباعة الفعلية توصلها الموجة 6.

---
Task ID: 6-a + 6-b + 6-c (موجة الإغلاق — التقارير والداشبورد والطباعة والنسخ)
Agent: 2 وكلاء general-purpose (sonnet) + إكمال وتدقيق المنسق
Task: الداشبورد الحقيقي + 9 تقارير + الجرد + الطباعة (الفواتير/السندات/الكشوف/الوردية/التقارير) + النسخ الاحتياطي + الإعدادات الكاملة

Work Log:
- src/domain/reports/ (5 ملفات): dashboard (4 بلاطات + رسم 30 يوم + الأكثر مبيعاً) + profit-loss بالصيغة المصححة كاملة (قرار 7: COGS−تكلفة مرتجع + زيادات/عجز جرد ±FX + مسحوبات بند مستقل) + salesByCustomer/Product/Day بمقارنة الفترة + بطاقة صنف بالباقي التراكمي + ملخص مخزون + أعمار ديون FIFO.
- الجرد (stocktake.ts): جلسة عد لكل مخزن (قيد العد/معتمد) + فروق حية بقيمة التكلفة + apply داخل transaction (حركة stocktake_adjust موقعة بتكلفة اللقطة + total_diff + logAudit).
- خدمات الطباعة: templates.ts (فاتورة مختصر/مفصل 58/80/A4 + سند مرقم + كشف + تقرير وردية + قالب تقارير عام) + print.ts (printHtml/share/واتساب) + doc-print.ts (تجميع المستندات من الدومين).
- النسخ الاحتياطي: backup.ts (إنشاء/تحقق Checksum/إصدار مخطط/جدولة/احتفاظ/سجل) + backup-native.web.ts stub (منع تحزيم expo-sqlite في الويب).
- الشاشات: (tabs)/index.tsx داشبورد حي + reports/index + [reportId] (فلترة فترة جاهزة + جداول) + inventory/stocktake.tsx + settings/{company,invoicing,printing,backup,about}.tsx.

Stage Summary:
- **إصلاحات المنسق بعد موت الوكلاء عند المهلة**: (1) backup-native منصنف platform (expo-sqlite الديناميكي كسر تصدير الويب). (2) 22 خطأ tsc ميكانيكية. (3) إعادة بناء مع إصلاح خطوط Google 404 (نسخ md5-names في سكربت البناء — كانت تُطلب من assets/node_modules ولا تصدر). (4) **عزل الاختبارات بعد ترقية sql.js 1.14 (فحص FK صارم): disposeTestDb يمسح هوية المستخدم الجلسية** — 295/295 خضراء. (5) more/settings: كل المسارات حقيقية (كانت printing تذهب لـ stub قادم) + /printing تحويل قديم. (6) صياغة حالة الفراغ للداشبورد («لا ملخصات بعد» بدل «لوحة قادمة»). (7) **زر طباعة التقارير كان «يأتي في الموجة القادمة» → نُفذ فعلياً**: reportHtml عام + printReport + buildPrintPayload لكل التسعة (FR-10-09). (8) **شاشة «حول» (FR-13-07) نُفذت**: إصدار + حجم القاعدة (PRAGMA page_count×page_size) + إحصاءات + فحص سلامة + مسح بيانات المعاينة بكلمة تأكيد — مع إصلاح SQL (جدول invoice الموحد وليس sale_invoice). (9) **خلل عرض فرق الجرد**: كان يعرض diff−book بدل diff نفسه (88/90 → «−86» بدل «+2») — صُحح.
- **التحقق المتصفحي الكامل (المنسق، بيانات من الصفر عبر onboarding)**: بيع نقدي 2×1,200 → INV-2026-00001 → «طباعة الآن» → **نافذة طباعة بإيصال كامل** (رأس المنشأة + بنود + إجماليات + تذييل — هدف المستخدم الأول «تُحفظ ثم تُطبع» تحقق) | داشبورد: مبيعات 2,400/أرباح 600 (2×300)/1 فاتورة/صندوق 2,400 + رسم 30 يوم + الأكثر مبيعاً | مخزون 90→88 | P&L مطابق حرفياً (COGS 1,800 → صافي 600) | **طباعة تقرير P&L بجدول كامل** | الجرد: عدّ 90 → فرق +2.000 صحيح → اعتماد → مخزون 88→90 + **زيادات الجرد 1,800 في P&L** | نسخة احتياطية يدوية 312KB «سليمة» بسجل | حول: إحصاءات صحيحة + Integrity Check = ok | الإعدادات: قفل بادئة INV بعد الإصدار (قرار 6) ✓ | استمرارية IndexedDB عبر إعادة بناء التطبيق ✓ | خطوط Google 200 ✓ صفر 404 | صفر أخطاء متصفح.
- لقطات: docs/wave6-{print-receipt,report-print,dashboard,about,stocktake?,settings-printing,landing,landing-mobile}.png
- مؤجل موثق: بلوتوث ESC/POS على الجهاز (وضع الرستر جاهز — يتطلب جهازاً حقيقياً)، استيراد Excel، تحويل مخازن، FEFO دفعات — V1.1.
