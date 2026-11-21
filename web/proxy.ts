// Runs before every page and API request: without the access cookie there is only /access.
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, siteGate, uploadsOn } from "@/lib/access";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (siteGate(request.cookies.get(ACCESS_COOKIE)?.value) !== "locked") {
    // With uploads off the page is not linked from anywhere, and a typed address goes home. This only
    // keeps the page out of sight: the upload API refuses by itself (uploadGate in lib/service.ts).
    if (pathname === "/upload" && !uploadsOn()) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return Response.json(
      { code: "locked", message: "Enter the access code to use SkillPool." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the entry page, its API route, the public notices, and the build's own static files.
  matcher: ["/((?!access$|api/access$|privacy$|robots\\.txt$|\\.well-known/security\\.txt$|\\.well-known/gpc\\.json$|third-party-notices\\.txt$|_next/static|favicon.ico).*)"],
};
