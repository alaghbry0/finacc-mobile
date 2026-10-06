import Image from "next/image";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Calculator,
  Check,
  DatabaseBackup,
  Download,
  Landmark,
  Package,
  PlayCircle,
  QrCode,
  Receipt,
  ShieldCheck,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";

const NUM_FONT = "[font-family:'IBM_Plex_Sans_Arabic',sans-serif]";

const features = [
  "فواتير بيع وشراء ومرتجعات",
  "مخزون بباركود وQR",
  "عملاء وموردون بأرصدة لكل عملة",
  "شيكات وأقساط",
  "صناديق ووردية",
  "أرباح وخسائر تلقائية",
  "نسخ احتياطي محلي",
  "قفل PIN",
];

const modules = [
  {
    icon: Receipt,
    title: "الفوترة",
    desc: "فواتير بيع وشراء ومرتجعات بخصومات وضريبة وإجماليات تلقائية.",
  },
  {
    icon: Package,
    title: "المخزون",
    desc: "جرد لحظي بالباركود وQR مع تنبيهات النقص وسجل حركة كامل.",
  },
  {
    icon: Users,
    title: "العملاء والموردون",
    desc: "ملفات بأرصدة لكل عملة وحدود دين وكشوف حساب تفصيلية.",
  },
  {
    icon: Wallet,
    title: "النقدية والوردية",
    desc: "صناديق متعددة بعملات مختلفة مع افتتاح وإقفال وردية.",
  },
  {
    icon: Landmark,
    title: "الشيكات",
    desc: "شيكات قبض ودفع بمواعيد استحقاق وحالات متابعة.",
  },
  {
    icon: CalendarClock,
    title: "الأقساط",
    desc: "دفعات مؤجلة بجدول سداد وتنبيهات قبل الاستحقاق.",
  },
  {
    icon: BarChart3,
    title: "التقارير والأرباح",
    desc: "أرباح وخسائر تلقائية وميزان مراجعة وتقارير لحظية.",
  },
  {
    icon: DatabaseBackup,
    title: "النسخ الاحتياطي",
    desc: "نسخ احتياطي محلي كامل واستعادة بنقرة واحدة.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0F172A] text-[#F1F5F9]">
      {/* ===== الهيدر ===== */}
      <header className="sticky top-0 z-50 border-b border-[#334155]/70 bg-[#0F172A]/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-l from-[#06B6D4] to-[#0EA5E9] shadow-lg shadow-cyan-500/25">
              <Calculator className="h-6 w-6 text-white" aria-hidden />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">المُحاسِب الشخصي</span>
                <span
                  className={`rounded-full border border-[#334155] bg-[#1E293B] px-2 py-0.5 text-[11px] font-semibold text-[#22D3EE] ${NUM_FONT}`}
                >
                  v1.0
                </span>
              </div>
              <span className="text-xs text-[#CBD5E1] sm:text-sm">
                محاسبة ومخزون كاملة — تعمل بلا إنترنت
              </span>
            </div>
          </div>
          <a
            href="#preview"
            className="hidden items-center gap-2 rounded-xl border border-[#334155] bg-[#1E293B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition hover:border-[#22D3EE]/60 hover:bg-[#263449] sm:flex"
          >
            <PlayCircle className="h-4 w-4 text-[#22D3EE]" aria-hidden />
            جرّب الآن
          </a>
        </div>
      </header>

      <main>
        {/* ===== القسم الرئيسي (Hero) ===== */}
        <section className="relative overflow-hidden">
          {/* خلفية تجانبية خفيفة من صورة التطبيق */}
          <Image
            src="/hero-app.png"
            alt=""
            aria-hidden
            fill
            priority
            sizes="100vw"
            className="pointer-events-none object-cover opacity-10 [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_70%,transparent)]"
          />
          {/* توهج سماوي خفيف أعلى القسم */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[#06B6D4]/10 blur-3xl"
          />

          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:py-20 lg:px-8">
            {/* يمين: المحتوى */}
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-3.5 py-1.5 text-sm text-[#22D3EE]">
                <WifiOff className="h-4 w-4" aria-hidden />
                أوفلاين 100% — بياناتك على جهازك وحدك
              </div>

              <h1 className="text-4xl font-bold leading-[1.2] sm:text-5xl lg:text-6xl">
                كل محاسبتك…
                <br />
                <span className="bg-linear-to-l from-[#22D3EE] to-[#0EA5E9] bg-clip-text text-transparent">
                  بلا إنترنت
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-[#CBD5E1] sm:text-lg">
                نظام محاسبة ومخزون عربي متكامل للتجار: فواتير، مخزون، عملاء
                وموردون، نقدية وشيكات وأقساط — كل شيء يعمل محلياً على جهازك،
                بسرعة وبخصوصية تامة، دون اشتراك أو خادم.
              </p>

              <ul className="mt-7 grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5 text-sm text-[#F1F5F9] sm:text-base">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#34D399]/15 text-[#34D399]">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a
                  href="#preview"
                  className="inline-flex items-center gap-2 rounded-xl bg-linear-to-l from-[#06B6D4] to-[#0EA5E9] px-6 py-3 text-base font-bold text-[#0F172A] shadow-lg shadow-cyan-500/25 transition hover:opacity-95 active:scale-[0.98]"
                >
                  <PlayCircle className="h-5 w-5" aria-hidden />
                  جرّب التطبيق الآن
                </a>
                <a
                  href="#android"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#334155] bg-[#1E293B] px-6 py-3 text-base font-medium text-[#F1F5F9] transition hover:border-[#22D3EE]/60 hover:bg-[#263449] active:scale-[0.98]"
                >
                  <Download className="h-5 w-5 text-[#22D3EE]" aria-hidden />
                  طريقة التثبيت
                </a>
              </div>
            </div>

            {/* يسار: إطار الهاتف مع المعاينة الحية */}
            <div id="preview" className="scroll-mt-24">
              <div className="mb-4 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#334155] bg-[#1E293B] px-3.5 py-1.5 text-xs text-[#CBD5E1]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#34D399]" />
                  </span>
                  معاينة حية — بيئة اختبار sql.js
                </span>
              </div>

              <div className="relative mx-auto w-full max-w-[380px]">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-8 rounded-full bg-[#06B6D4]/10 blur-3xl"
                />
                <div className="relative rounded-[2.5rem] border border-[#334155] bg-[#0B1220] p-3 shadow-2xl shadow-black/50">
                  {/* النوتش */}
                  <div
                    aria-hidden
                    className="mx-auto mb-2 h-5 w-28 rounded-full border border-[#334155] bg-[#1E293B]"
                  />
                  <div className="overflow-hidden rounded-[1.9rem] border border-[#1E293B]">
                    <iframe
                      src="/rn/index.html"
                      title="معاينة حية لتطبيق المُحاسِب الشخصي"
                      className="block h-[600px] w-full border-0 bg-[#0F172A] sm:h-[700px] lg:h-[750px]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== ماذا يفعل التطبيق؟ ===== */}
        <section className="border-t border-[#334155]/60 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold sm:text-3xl">ماذا يفعل التطبيق؟</h2>
            <p className="mt-3 max-w-2xl text-[#CBD5E1]">
              ثماني وحدات متكاملة تغطي دورة عمل التاجر كاملة — من أول فاتورة حتى
              ميزان المراجعة والأرباح.
            </p>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {modules.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-[#334155] bg-[#1E293B] p-5 transition hover:border-[#22D3EE]/50 hover:shadow-lg hover:shadow-cyan-500/5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#22D3EE]/10 text-[#22D3EE] transition group-hover:bg-[#22D3EE]/20">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#CBD5E1]">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== كيف تحصل عليه على أندرويد؟ ===== */}
        <section id="android" className="scroll-mt-24 border-t border-[#334155]/60 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold sm:text-3xl">كيف تحصل عليه على أندرويد؟</h2>
            <p className="mt-3 max-w-2xl text-[#CBD5E1]">
              ثلاث طرق — ابدأ بالمعاينة الآن، ثم انتقل لنسخة الجوال كاملة
              الخصائص.
            </p>

            <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* الخطوة 1: جرّب الويب */}
              <div className="relative flex flex-col rounded-2xl border border-[#334155] bg-[#1E293B] p-6 transition hover:border-[#22D3EE]/50">
                <span
                  className={`absolute left-5 top-5 rounded-full border border-[#334155] bg-[#0B1220] px-2.5 py-0.5 text-xs font-semibold text-[#22D3EE] ${NUM_FONT}`}
                >
                  1
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#22D3EE]/10 text-[#22D3EE]">
                  <PlayCircle className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-bold">الآن — جرّب الويب</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#CBD5E1]">
                  المعاينة الحية أعلاه تعمل الآن في متصفحك — كل البيانات تُخزَّن
                  على جهازك ولا تُرسل لأي خادم.
                </p>
                <a
                  href="#preview"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#22D3EE] transition hover:text-[#67E8F9]"
                >
                  ابدأ من المعاينة
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </a>
              </div>

              {/* الخطوة 2: Expo Go */}
              <div className="relative flex flex-col rounded-2xl border border-[#334155] bg-[#1E293B] p-6 transition hover:border-[#22D3EE]/50">
                <span
                  className={`absolute left-5 top-5 rounded-full border border-[#334155] bg-[#0B1220] px-2.5 py-0.5 text-xs font-semibold text-[#22D3EE] ${NUM_FONT}`}
                >
                  2
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#22D3EE]/10 text-[#22D3EE]">
                  <QrCode className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-bold">Expo Go</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#CBD5E1]">
                  على جهازك، ثم افتح تطبيق Expo Go على هاتفك وامسح رمز QR
                  الظاهر:
                </p>
                <pre
                  dir="ltr"
                  className="mt-4 overflow-x-auto rounded-xl border border-[#334155] bg-[#0B1220] px-4 py-3 text-left text-[13px] text-[#22D3EE] [font-family:ui-monospace,SFMono-Regular,Menlo,monospace]"
                >
                  <code>cd finacc-mobile && bun install && npx expo start</code>
                </pre>
              </div>

              {/* الخطوة 3: APK كامل */}
              <div className="relative flex flex-col rounded-2xl border border-[#334155] bg-[#1E293B] p-6 transition hover:border-[#22D3EE]/50">
                <span
                  className={`absolute left-5 top-5 rounded-full border border-[#334155] bg-[#0B1220] px-2.5 py-0.5 text-xs font-semibold text-[#22D3EE] ${NUM_FONT}`}
                >
                  3
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#22D3EE]/10 text-[#22D3EE]">
                  <Download className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-bold">APK كامل</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#CBD5E1]">
                  بناء نسخة تثبيت نهائية على جهازك — يتطلب حساب Expo مجاني.
                  الطباعة البلوتوثية والتشفير الكامل يعملان في نسخة APK فقط.
                </p>
                <pre
                  dir="ltr"
                  className="mt-4 overflow-x-auto rounded-xl border border-[#334155] bg-[#0B1220] px-4 py-3 text-left text-[13px] text-[#22D3EE] [font-family:ui-monospace,SFMono-Regular,Menlo,monospace]"
                >
                  <code>npx eas build -p android --profile preview</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ===== أرقام الثقة ===== */}
        <section className="border-t border-[#334155]/60 py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center justify-center gap-x-10 gap-y-5 rounded-2xl border border-[#334155] bg-[#1E293B]/60 px-6 py-6 text-center sm:flex-row sm:text-right">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-semibold text-[#22D3EE] ${NUM_FONT}`}>35+</span>
                <span className="text-sm text-[#CBD5E1]">جدولاً محاسبياً</span>
              </div>
              <span aria-hidden className="hidden h-1.5 w-1.5 rounded-full bg-[#334155] sm:block" />
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-semibold text-[#34D399] ${NUM_FONT}`}>211+</span>
                <span className="text-sm text-[#CBD5E1]">اختبار منطق أعمال أخضر</span>
              </div>
              <span aria-hidden className="hidden h-1.5 w-1.5 rounded-full bg-[#334155] sm:block" />
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-[#22D3EE]" aria-hidden />
                <span className="text-sm text-[#CBD5E1]">
                  بلا اشتراكات ولا إعلانات ولا تتبع
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ===== الفوتر ===== */}
      <footer className="mt-auto border-t border-[#334155]/70 bg-[#0B1220]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-4 py-8 text-center sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-l from-[#06B6D4] to-[#0EA5E9]">
              <Calculator className="h-4 w-4 text-white" aria-hidden />
            </div>
            <span className="font-bold">المُحاسِب الشخصي — يعمل محلياً 100% على جهازك</span>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-[#CBD5E1]">
            النسخة{" "}
            <span className={`font-semibold text-[#F1F5F9] ${NUM_FONT}`}>1.0.0</span> — بيانات
            المعاينة تُخزَّن في متصفحك (IndexedDB) ويمسحها زر «مسح البيانات» داخل
            التطبيق.
          </p>
        </div>
      </footer>
    </div>
  );
}
