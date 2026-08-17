import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { renewImpersonationSession } from "@/features/auth/server/portal";
import { assertSameOrigin } from "@/shared/server/csrf";
import { errorEnvelope } from "@/shared/server/handler";

const inputSchema = z.object({ eventSlug: z.string().min(1), token: z.string().min(1) });

/**
 * "Get a fresh link" on the impersonation confirm page — the recovery for a
 * link that expired while the organizer was reading the interstitial in front
 * of it. Same guard as `../route.ts` (organizer on the event, same-origin POST)
 * because `renewImpersonationSession` grants exactly what that route's link
 * grants; the difference is only that it picks the speaker up from the stale
 * link instead of from the admin UI.
 */
export async function POST(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const session = await renewImpersonationSession({ eventSlug: input.eventSlug, token: input.token });
    return NextResponse.json({ data: { eventId: session.eventId, contactId: session.contactId } });
  } catch (error) {
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "portal-auth",
      route: "/api/internal/auth/portal/impersonate/renew",
      fallbackMessages: { validation: "Invalid impersonation request", internal: "Unable to reopen the speaker portal" },
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
