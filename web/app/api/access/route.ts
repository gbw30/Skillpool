// Trades the site access code for a cookie. The only API route that works without that cookie.
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_DAYS, tokenFor } from "@/lib/access";
import { attemptLimit, clientAddress, crossSite } from "@/lib/attempts";
import { readBody } from "@/lib/body";

const tries = attemptLimit();

const error = (status: number, code: string, message: string) =>
  Response.json({ code, message }, { status, headers: { "cache-control": "no-store" } });
const tooMany = () => error(429, "rate_limited", "Too many tries. Wait ten minutes and try again.");

export async function POST(request: NextRequest) {
  if (crossSite(request)) return error(403, "cross_site", "This request did not come from SkillPool.");
  const ip = clientAddress(request);
  if (tries.locked(ip)) return tooMany(); // before reading anything a locked-out caller sends

  const text = await readBody(request, 2000);
  if (text === null) return error(413, "payload_too_large", "Request body is too large.");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {} // not JSON: treated as a wrong code below
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";

  // Checked again now that the wait is over. Nothing below pauses, so two requests that arrive
  // together cannot both pass this check before either is counted.
  if (tries.locked(ip)) return tooMany();

  const token = code.length <= 200 ? tokenFor(code) : null;
  if (!token) {
    tries.failed(ip);
    return error(403, "forbidden", "That access code is not valid.");
  }

  tries.passed(ip);
  const cookie = [
    `${ACCESS_COOKIE}=${token}`, "Path=/", `Max-Age=${ACCESS_DAYS * 24 * 60 * 60}`, "HttpOnly", "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}

/** Sign out: drop the cookie from this browser. Changing SITE_ACCESS_CODE signs everyone out. */
export async function DELETE(request: NextRequest) {
  if (crossSite(request)) return error(403, "cross_site", "This request did not come from SkillPool.");
  const cookie = [
    `${ACCESS_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}
