import type { Metadata } from "next";
import { Cormorant_Garamond, Geist_Mono, Hanken_Grotesk } from "next/font/google";
import Link from "next/link";
import { Backdrop } from "@/components/backdrop";
import { SignOut } from "@/components/sign-out";
import { ThemeToggle } from "@/components/theme-toggle";
import { uploadsOn } from "@/lib/access";
import "./globals.css";

// "Nocturne": a light serif for headlines and names, a quiet grotesque for everything else.
const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "400", "500"], style: ["normal", "italic"], variable: "--font-display" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-text" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "SkillPool",
  description: "Find the right people for a project, with the evidence for each one.",
  robots: { index: false, follow: false }, // a private demo
};

// Runs before first paint so a saved light or system choice never flashes dark. A fixed string.
const APPLY_THEME = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="system")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script above changes data-theme before React hydrates.
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Backdrop />
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          href="#main"
        >
          Skip to content
        </a>
        <header>
          {/* The wordmark sits in the middle; on a narrow screen it moves left and the links stay right. */}
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr]">
            <nav aria-label="Main" className="flex items-center gap-3 text-[0.8125rem] max-lg:order-2 sm:gap-6">
              <Link className="text-ink/80 no-underline hover:text-ink" href="/search">Search</Link>
              {uploadsOn() && (
                <Link className="text-ink/80 no-underline hover:text-ink" href="/upload">
                  <span className="sm:hidden">Upload</span>
                  <span className="max-sm:hidden">Add documents</span>
                </Link>
              )}
            </nav>
            <Link href="/" className="font-serif text-sm font-medium tracking-[0.12em] text-ink no-underline max-lg:order-1 max-lg:mr-auto sm:text-xl sm:tracking-[0.3em] lg:pl-[0.3em]">SKILLPOOL</Link>
            <div className="flex items-center justify-end gap-3 text-[0.8125rem] max-lg:order-3 sm:gap-5">
              <SignOut />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
