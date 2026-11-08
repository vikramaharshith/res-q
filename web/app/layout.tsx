import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import { INTRO_STORAGE_KEY } from "@/lib/intro/startup-timeline";
import "./globals.css";

const introBoot = `(function(){try{var reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;var seen=window.sessionStorage.getItem(${JSON.stringify(INTRO_STORAGE_KEY)})==="1";if(!reduce&&!seen){document.documentElement.dataset.resqIntro="play";window.__resqIntroArmed=performance.now();}}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RES-Q by B7 — Command Center",
  description:
    "Simulated disaster response command center for fictional flood incidents. Not for real emergencies.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full bg-[#050505] font-sans text-zinc-100 antialiased">
        <Script id="resq-intro-boot" strategy="beforeInteractive">
          {introBoot}
        </Script>
        {children}
      </body>
    </html>
  );
}
