// Server only: signs requests to the Python service and gates uploads.
// The signature scheme is defined in service/skillpool/signing.py; keep the two in step.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`environment variable ${name} is required`);
  return value;
}

export function sign(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.`).update(body).digest("hex");
}

/** Uploads are off unless switched on, and need the access code (PRD R18). */
export function uploadGate(code: string | null): "ok" | "disabled" | "denied" {
  const expected = process.env.UPLOAD_ACCESS_CODE;
  if (process.env.UPLOADS_ENABLED !== "true" || !expected) return "disabled";
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(code ?? ""), digest(expected)) ? "ok" : "denied";
}

export async function callService(
  method: string,
  path: string,
  body: string,
  forward: { correlationId: string | null; clientIp: string },
): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return fetch(env("SERVICE_URL").replace(/\/$/, "") + path, {
    method,
    body: method === "GET" ? undefined : body,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": sign(env("SERVICE_SIGNING_SECRET"), timestamp, method, path, body),
      "x-correlation-id": forward.correlationId ?? randomUUID(),
      "x-client-ip": forward.clientIp,
    },
  });
}
