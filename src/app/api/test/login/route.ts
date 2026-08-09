import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ADMIN_COOKIE, adminCookieOptions, signAdminToken } from "@/features/auth";
import { type UserId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";

const inputSchema = z.object({ email: z.email() });

export async function POST(request: NextRequest) {
  if (getEnv().TEST_AUTH !== "1") return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION" } }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const response = NextResponse.json({ data: { signedIn: true } });
  response.cookies.set(ADMIN_COOKIE, await signAdminToken({ userId: user.id as UserId, email: user.email, name: user.name }), adminCookieOptions());
  return response;
}
