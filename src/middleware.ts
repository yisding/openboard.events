import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, PORTAL_COOKIE_PREFIX } from "@/features/auth/cookies";
import { getEnv } from "@/shared/lib/env";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/events") && !request.cookies.has(ADMIN_COOKIE) && getEnv().TEST_AUTH !== "1") {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  const portalMatch = /^\/portal\/([^/]+)(?:\/|$)/u.exec(pathname);
  const isPortalAuthPage = pathname.endsWith("/login") || pathname.endsWith("/verify");
  const hasPortalCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX));
  if (portalMatch && !isPortalAuthPage && !hasPortalCookie && getEnv().TEST_AUTH !== "1") {
    const login = new URL(`/portal/${portalMatch[1]}/login`, request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/events/:path*", "/portal/:path*"] };
