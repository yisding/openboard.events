import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requestPortalLogin } from "@/features/auth";
import { isAppError, toHttp } from "@/shared/lib/errors";

const inputSchema = z.object({ eventSlug: z.string().min(1), email: z.email(), next: z.string().max(2_000).optional() });

export async function POST(request: NextRequest) {
  try {
    const input = inputSchema.parse(await request.json());
    return NextResponse.json({ data: await requestPortalLogin(input.eventSlug, input.email, input.next) });
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Enter a valid email" } }, { status: 400 });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Unable to request a code" } }, { status: 500 });
  }
}
