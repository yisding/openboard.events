import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createImpersonationLink } from "@/features/auth/server/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { assertSameOrigin } from "@/shared/server/csrf";
import { errorEnvelope } from "@/shared/server/handler";

const inputSchema = z.object({ eventId: eventIdSchema, contactId: contactIdSchema });

/**
 * The most sensitive of the four manual portal-auth routes (PLAN P3-SEC):
 * `createImpersonationLink` mints a live impersonation token off nothing but
 * the ambient admin session cookie, so this is exactly the shape of request
 * the origin check exists to stop a cross-site page from forging.
 */
export async function POST(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const location = await createImpersonationLink(input.eventId, input.contactId);
    return NextResponse.redirect(new URL(location, request.url), 303);
  } catch (error) {
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "portal-auth",
      route: "/api/internal/auth/portal/impersonate",
      fallbackMessages: { validation: "Invalid impersonation request", internal: "Unable to start impersonation" },
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
