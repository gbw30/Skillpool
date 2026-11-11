import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Backdrop } from "@/components/backdrop";
import { Logo } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "SkillPool",
  description: "Find the right people for a project, with the evidence for each one.",
};

// Runs before first paint so a saved light or system choice never flashes dark. A fixed string.
const APPLY_THEME = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="system")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script above changes data-theme before React hydrates.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
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
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink no-underline">
              <Logo className="text-accent" width={20} height={20} />
              SkillPool
            </Link>
            <nav aria-label="Main" className="ml-auto flex items-center gap-4 text-sm sm:gap-6">
              <Link className="text-muted no-underline hover:text-ink" href="/search">Search</Link>
              <Link className="text-muted no-underline hover:text-ink" href="/upload">
                <span className="sm:hidden">Upload</span>
                <span className="max-sm:hidden">Add documents</span>
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
