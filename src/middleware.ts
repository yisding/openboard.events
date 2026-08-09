import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/features/auth/cookies";
import { safeInternalPath } from "@/features/auth/safe-next";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestPath = safeInternalPath(`${pathname}${request.nextUrl.search}`);
  if (pathname.startsWith("/events") && !request.cookies.has(ADMIN_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-openboard-request-path", requestPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/events/:path*"] };
