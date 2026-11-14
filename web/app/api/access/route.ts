// Trades the site access code for a cookie. The only API route that works without that cookie.
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_DAYS, tokenFor } from "@/lib/access";
import { readBody } from "@/lib/body";

const WINDOW_MS = 10 * 60 * 1000;
const TRIES = 10; // wrong codes from one address in a window
const ALL_TRIES = 100; // wrong codes from everyone in a window
// The address comes from a header, which only a hosting platform's proxy makes trustworthy, so a
// caller who fakes it gets a fresh count each time. The total across all addresses does not
// depend on it: past ALL_TRIES nobody is let in until the window passes. That lets an attacker
// lock the page for ten minutes, which is the safe way for a private demo to fail.
// shortcut: both counts live in this process's memory, so each server instance counts on its
// own and a restart forgets. Use a long random code; move to a shared store if guessing shows
// up in the logs.
const byAddress = new Map<string, number[]>();
let everyone: number[] = [];

const error = (status: number, code: string, message: string) => Response.json({ code, message }, { status });
const tooMany = () => error(429, "rate_limited", "Too many tries. Wait ten minutes and try again.");

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  /** Wrong codes still inside the window: from this address, and whether either limit is reached. */
  function count() {
    const now = Date.now();
    const fresh = (at: number) => now - at < WINDOW_MS;
    everyone = everyone.filter(fresh);
    const mine = (byAddress.get(ip) ?? []).filter(fresh);
    return { now, fresh, mine, locked: everyone.length >= ALL_TRIES || mine.length >= TRIES };
  }
  if (count().locked) return tooMany(); // before reading anything a locked-out caller sends

  const text = await readBody(request, 2000);
  if (text === null) return error(413, "payload_too_large", "Request body is too large.");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {} // not JSON: treated as a wrong code below
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";

  // Counted again now that the wait is over. Nothing below pauses, so two requests that arrive
  // together cannot both pass this check before either is counted.
  const { now, fresh, mine, locked } = count();
  if (locked) return tooMany();

  const token = code.length <= 200 ? tokenFor(code) : null;
  if (!token) {
    everyone.push(now);
    byAddress.set(ip, [...mine, now]);
    // Bounded by ALL_TRIES new entries per window; drop the ones that have aged out.
    for (const [key, times] of byAddress) if (!times.some(fresh)) byAddress.delete(key);
    return error(403, "forbidden", "That access code is not valid.");
  }

  byAddress.delete(ip);
  const cookie = [
    `${ACCESS_COOKIE}=${token}`, "Path=/", `Max-Age=${ACCESS_DAYS * 24 * 60 * 60}`, "HttpOnly", "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}
