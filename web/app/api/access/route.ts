// Trades the site access code for a cookie. The only API route that works without that cookie.
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_DAYS, tokenFor } from "@/lib/access";

const TRIES = 10;
const WINDOW_MS = 10 * 60 * 1000;
// shortcut: counted in this process's memory, so each server instance counts on its own and a
// restart forgets. Use a long random code; move to a shared store if guessing ever shows up in logs.
const attempts = new Map<string, number[]>();

const error = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= TRIES) return error(429, "rate_limited", "Too many tries. Wait ten minutes and try again.");
  if (attempts.size > 10_000) attempts.clear(); // never grows without bound
  attempts.set(ip, [...recent, now]);

  const body: unknown = await request.json().catch(() => null);
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";
  const token = code.length <= 200 ? tokenFor(code) : null;
  if (!token) return error(403, "forbidden", "That access code is not valid.");

  attempts.delete(ip);
  const cookie = [
    `${ACCESS_COOKIE}=${token}`, "Path=/", `Max-Age=${ACCESS_DAYS * 24 * 60 * 60}`, "HttpOnly", "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}
