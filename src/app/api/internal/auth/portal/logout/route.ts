import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logoutPortal } from "@/features/auth";
import { isAppError, toHttp } from "@/shared/lib/errors";
import { assertSameOrigin } from "@/shared/server/csrf";

const inputSchema = z.object({ eventSlug: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    await logoutPortal(input.eventSlug);
    return NextResponse.json({ data: { signedOut: true } });
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid portal logout" } }, { status: 400 });
  }
}
