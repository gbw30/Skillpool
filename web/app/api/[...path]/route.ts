// The only server code in the web app: a signed proxy to the Python service.
// Browsers never reach the service directly, and only the routes listed here exist.
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, siteGate } from "@/lib/access";
import { attemptLimit, clientAddress, crossSite } from "@/lib/attempts";
import { readBody } from "@/lib/body";
import { MOCK, MOCK_STORAGE } from "@/lib/mock";
import { callService, uploadGate } from "@/lib/service";

const ID = "[A-Za-z0-9-]{1,80}";
const MAX_BODY_BYTES = 256 * 1024;
const uploadTries = attemptLimit(); // wrong upload codes

type Route = { method: "GET" | "POST"; pattern: RegExp; to: (m: RegExpMatchArray) => string; gated?: boolean };

const ROUTES: Route[] = [
  { method: "GET", pattern: /^health$/, to: () => "/healthz" },
  { method: "POST", pattern: /^upload\/session$/, to: () => "/upload/session", gated: true },
  { method: "POST", pattern: /^ingest\/start$/, to: () => "/ingest", gated: true },
  { method: "GET", pattern: new RegExp(`^jobs/(${ID})$`), to: (m) => `/jobs/${m[1]}` },
  { method: "POST", pattern: /^search$/, to: () => "/search" },
  { method: "GET", pattern: new RegExp(`^person/(${ID})$`), to: (m) => `/person/${m[1]}` },
  { method: "GET", pattern: new RegExp(`^documents/(${ID})/url$`), to: (m) => `/documents/${m[1]}/url` },
  { method: "GET", pattern: /^graph$/, to: () => "/graph" },
  { method: "GET", pattern: /^stats$/, to: () => "/stats" },
];

const error = (status: number, code: string, message: string) =>
  Response.json({ code, message }, { status, headers: { "cache-control": "no-store" } });

async function handle(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  // proxy.ts already turns these away; checked again here so the API never depends on it alone.
  if (siteGate(request.cookies.get(ACCESS_COOKIE)?.value) === "locked") {
    return error(401, "locked", "Enter the access code to use SkillPool.");
  }
  const path = (await ctx.params).path.join("/");
  if (MOCK && request.method === "POST" && path === MOCK_STORAGE) return new Response(null, { status: 204 }); // the bucket
  let target: string | undefined;
  let gated = false;
  for (const route of ROUTES) {
    const match = request.method === route.method ? path.match(route.pattern) : null;
    if (match) {
      target = route.to(match);
      gated = route.gated ?? false;
      break;
    }
  }
  if (!target) return error(404, "not_found", "No such endpoint.");

  const ip = clientAddress(request);
  if (request.method === "POST") {
    // Another site cannot make a signed-in visitor's browser search or upload: browsers label such
    // requests, and a plain form cannot send JSON.
    if (crossSite(request)) return error(403, "cross_site", "This request did not come from SkillPool.");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return error(415, "unsupported_media_type", "Send JSON.");
    }
  }
  if (gated) {
    if (uploadTries.locked(ip)) return error(429, "rate_limited", "Too many tries. Wait ten minutes and try again.");
    const gate = uploadGate(request.headers.get("x-access-code"));
    if (gate === "disabled") return error(403, "uploads_disabled", "Uploads are switched off on this deployment.");
    if (gate === "denied") {
      uploadTries.failed(ip);
      return error(403, "forbidden", "That access code is not valid.");
    }
  }

  const body = request.method === "POST" ? await readBody(request, MAX_BODY_BYTES) : "";
  if (body === null) return error(413, "payload_too_large", "Request body is too large.");

  let upstream: Response;
  try {
    upstream = await callService(request.method, target, body, {
      // Passed on only in the expected shape; the service logs it.
      correlationId: /^[A-Za-z0-9-]{1,64}$/.test(request.headers.get("x-correlation-id") ?? "") ? request.headers.get("x-correlation-id") : null,
      clientIp: ip,
    });
  } catch (cause) {
    console.error("service call failed", target, cause);
    return error(502, "service_unavailable", "The search service is not reachable.");
  }
  // Pass the body through as a stream so search results arrive as they are produced.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-correlation-id": upstream.headers.get("x-correlation-id") ?? "",
    },
  });
}

export { handle as GET, handle as POST };
