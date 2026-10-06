import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "المُحاسِب الشخصي — محاسبة ومخزون بلا إنترنت",
  description:
    "نظام محاسبة ومخزون عربي كامل يعمل أوفلاين 100% على جهازك: فواتير بيع وشراء ومرتجعات، مخزون بباركود وQR، عملاء وموردون بأرصدة لكل عملة، شيكات وأقساط، صناديق ووردية، أرباح وخسائر تلقائية، ونسخ احتياطي محلي.",
  keywords: [
    "المحاسب الشخصي",
    "محاسبة",
    "مخزون",
    "فواتير",
    "أوفلاين",
    "بدون إنترنت",
    "اليمن",
    "محاسبة عربية",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="scroll-smooth" suppressHydrationWarning>
      <body className="antialiased bg-[#0F172A] text-[#F1F5F9] [font-family:'Tajawal','IBM_Plex_Sans_Arabic',system-ui,sans-serif]">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* قاعدة no-page-custom-font خاصة بـ Pages Router — نحن في App Router والخط يُحمَّل لكل الصفحات */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=IBM+Plex+Sans+Arabic:wght@600&display=swap"
          precedence="default"
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
