import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ADMIN_COOKIE, adminCookieOptions, signAdminToken } from "@/features/auth";
import { type UserId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";

const inputSchema = z.object({ email: z.email() });

/**
 * This route mints the *fallback* provider's cookie and nothing else: a signed
 * `ob_admin` JWT (`signAdminToken`). Under `ADMIN_AUTH_PROVIDER=better-auth`
 * `getAdminIdentity` reads `admin_sessions` through Better Auth and never looks
 * at that cookie, so a 200 here would hand back a session the very next request
 * ignores — `/api/test/login` succeeds, then every `/api/internal/*` call is
 * `401 UNAUTHORIZED Sign in required` and every `/events/*` page bounces to
 * `/login`, with nothing in the failure naming the cause.
 *
 * That is not hypothetical: it is exactly what installing `ADMIN_AUTH_PROVIDER`
 * as a worker secret on `sb-web-preview` did to the Playwright suite, which
 * reported twenty-one unrelated-looking UI failures for one config change.
 * Refusing here costs the same red run and explains it in one sentence.
 *
 * The two ways out are both the operator's, and both are named in the message:
 * put the preview back on `fallback`, or teach this route to mint a Better Auth
 * session (a real `admin_sessions` row plus its signed cookie) so the machine
 * path into an admin session works on whichever provider is switched on.
 */
const WRONG_PROVIDER =
  "TEST_AUTH sign-in only works under ADMIN_AUTH_PROVIDER=fallback: this route mints the fallback ob_admin cookie, "
  + "and the active provider ignores it. Set ADMIN_AUTH_PROVIDER=fallback on this deployment, or give this route a "
  + "Better Auth session path.";

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (env.TEST_AUTH !== "1") return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  if (env.ADMIN_AUTH_PROVIDER !== "fallback") {
    return NextResponse.json({ error: { code: "CONFLICT", message: WRONG_PROVIDER } }, { status: 409 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION" } }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const response = NextResponse.json({ data: { signedIn: true } });
  response.cookies.set(ADMIN_COOKIE, await signAdminToken({ userId: user.id as UserId, email: user.email, name: user.name }), adminCookieOptions());
  return response;
}
