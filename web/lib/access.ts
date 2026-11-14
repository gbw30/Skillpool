// Server only: the whole site sits behind one access code (SITE_ACCESS_CODE).
// proxy.ts turns visitors away, and the API route checks again for itself.
import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "skillpool_access";
export const ACCESS_DAYS = 30;

// Hash both sides so the comparison is constant-time whatever the lengths.
const digest = (value: string) => createHash("sha256").update(value).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** What the cookie holds: a hash of the code, so the code itself never sits in a browser. */
export function accessToken(code: string): string {
  return digest(`skillpool-site:${code}`).toString("hex");
}

/** "open" means no code is configured, which only a development server allows. */
export function siteGate(token: string | undefined): "ok" | "open" | "locked" {
  const code = process.env.SITE_ACCESS_CODE;
  // A production deployment that forgot the code must not be public.
  if (!code) return process.env.NODE_ENV === "production" ? "locked" : "open";
  return same(token ?? "", accessToken(code)) ? "ok" : "locked";
}

/** The cookie value for a correct code, or null. */
export function tokenFor(code: string): string | null {
  const expected = process.env.SITE_ACCESS_CODE;
  return expected && same(code, expected) ? accessToken(expected) : null;
}
