// Server only: reads a request body without trusting what the caller says about its size.
import type { NextRequest } from "next/server";

/** The request body as text, or null once it passes `maxBytes`. Never buffers more than that. */
export async function readBody(request: NextRequest, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let bytes = 0; ; ) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
