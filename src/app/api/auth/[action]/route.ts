import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminCookieOptions, authenticateAdmin, signAdminToken } from "@/features/auth";

const signInSchema = z.object({ email: z.email(), password: z.string().min(8).max(256) });

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action === "sign-out") {
    const response = NextResponse.json({ data: { signedOut: true } });
    response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
    return response;
  }
  if (action !== "sign-in") return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });

  const input = signInSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password" } }, { status: 401 });
  const identity = await authenticateAdmin(input.data.email, input.data.password);
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password" } }, { status: 401 });
  const response = NextResponse.json({ data: { signedIn: true } });
  response.cookies.set(ADMIN_COOKIE, await signAdminToken(identity), adminCookieOptions());
  return response;
}
