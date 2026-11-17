// Server only: the whole site sits behind one access code (SITE_ACCESS_CODE).
// proxy.ts turns visitors away, and the API route checks again for itself.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// "__Host-": the browser keeps it only if it came over HTTPS for this exact host and path "/", so
// no other site or subdomain can plant one. Local development runs over plain HTTP.
export const ACCESS_COOKIE = process.env.NODE_ENV === "production" ? "__Host-skillpool_access" : "skillpool_access";
export const ACCESS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Hash both sides so the comparison is constant-time whatever the lengths.
const digest = (value: string) => createHash("sha256").update(value).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const seal = (code: string, issued: string) => createHmac("sha256", code).update(`skillpool-site:${issued}`).digest("hex");

/**
 * What the cookie holds: when it was issued, sealed with the code. The code never sits in a
 * browser, a copied cookie stops working after ACCESS_DAYS, and a new code ends every cookie.
 */
export function accessToken(code: string, issued = Date.now()): string {
  return `${issued}.${seal(code, String(issued))}`;
}

/** "open" means no code is configured, which only a development server allows. */
export function siteGate(token: string | undefined): "ok" | "open" | "locked" {
  const code = process.env.SITE_ACCESS_CODE;
  // A production deployment that forgot the code must not be public.
  if (!code) return process.env.NODE_ENV === "production" ? "locked" : "open";
  const [issued = "", mark = ""] = (token ?? "").split(".");
  const age = Date.now() - Number(issued);
  const fresh = /^\d{13}$/.test(issued) && age > -60_000 && age < ACCESS_DAYS * DAY_MS;
  return same(mark, seal(code, issued)) && fresh ? "ok" : "locked";
}

/** The cookie value for a correct code, or null. */
export function tokenFor(code: string): string | null {
  const expected = process.env.SITE_ACCESS_CODE;
  return expected && same(code, expected) ? accessToken(expected) : null;
}

/**
 * Uploads are offered only when switched on. The proxy asks on every request. The header and the
 * landing page ask when the site is built, since they are prerendered: rebuild after changing it.
 */
export const uploadsOn = () => process.env.UPLOADS_ENABLED === "true";
