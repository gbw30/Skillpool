// The only server code in the web app: a signed proxy to the Python service.
// Browsers never reach the service directly, and only the routes listed here exist.
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, siteGate } from "@/lib/access";
import { MOCK, MOCK_STORAGE } from "@/lib/mock";
import { callService, uploadGate } from "@/lib/service";

const ID = "[A-Za-z0-9-]{1,80}";
const MAX_BODY_BYTES = 256 * 1024;

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

const error = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

/** The request body as text, or null once it passes MAX_BODY_BYTES. Never buffers more than that. */
async function readBody(request: NextRequest): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let bytes = 0; ; ) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

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

  if (gated) {
    const gate = uploadGate(request.headers.get("x-access-code"));
    if (gate === "disabled") return error(403, "uploads_disabled", "Uploads are switched off on this deployment.");
    if (gate === "denied") return error(403, "forbidden", "That access code is not valid.");
  }

  const body = request.method === "POST" ? await readBody(request) : "";
  if (body === null) return error(413, "payload_too_large", "Request body is too large.");

  let upstream: Response;
  try {
    upstream = await callService(request.method, target, body, {
      correlationId: request.headers.get("x-correlation-id"),
      // The first entry is the client as seen by the hosting platform's proxy.
      clientIp: request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown",
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
