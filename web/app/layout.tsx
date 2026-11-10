import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkillPool",
  description: "Find the right people for a project, with the evidence for each one.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="site-header">
          <Link className="brand" href="/">SkillPool</Link>
          <nav aria-label="Main">
            <Link href="/search">Search</Link>
            <Link href="/upload">Add documents</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
