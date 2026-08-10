import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createImpersonationLink } from "@/features/auth/server/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { isAppError, toHttp } from "@/shared/lib/errors";
import { assertSameOrigin } from "@/shared/server/csrf";

const inputSchema = z.object({ eventId: eventIdSchema, contactId: contactIdSchema });

/**
 * The most sensitive of the four manual portal-auth routes (PLAN P3-SEC):
 * `createImpersonationLink` mints a live impersonation token off nothing but
 * the ambient admin session cookie, so this is exactly the shape of request
 * the origin check exists to stop a cross-site page from forging.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const location = await createImpersonationLink(input.eventId, input.contactId);
    return NextResponse.redirect(new URL(location, request.url), 303);
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid impersonation request" } }, { status: 400 });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Unable to start impersonation" } }, { status: 500 });
  }
}
