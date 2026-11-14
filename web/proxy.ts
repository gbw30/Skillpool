// Runs before every page and API request: without the access cookie there is only /access.
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, siteGate } from "@/lib/access";

export function proxy(request: NextRequest) {
  if (siteGate(request.cookies.get(ACCESS_COOKIE)?.value) !== "locked") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return Response.json({ code: "locked", message: "Enter the access code to use SkillPool." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the entry page, its API route, and the build's own static files.
  matcher: ["/((?!access$|api/access$|_next/static|_next/image|favicon.ico).*)"],
};
