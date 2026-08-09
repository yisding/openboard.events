import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/features/auth/cookies";
import { getEnv } from "@/shared/lib/env";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/events") && !request.cookies.has(ADMIN_COOKIE) && getEnv().TEST_AUTH !== "1") {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/events/:path*"] };
