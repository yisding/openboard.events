import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { PORTAL_LOGIN_THROTTLE, PORTAL_LOGIN_THROTTLE_MESSAGE, requestPortalLogin } from "@/features/auth";
import { nudgeOutbox } from "@/features/comms";
import { formIdSchema } from "@/shared/contracts";
import { assertSameOrigin } from "@/shared/server/csrf";
import { errorEnvelope } from "@/shared/server/handler";
import { checkRateLimit, clientIp } from "@/shared/server/rate-limit";

const inputSchema = z.object({
  eventSlug: z.string().min(1),
  email: z.email(),
  next: z.string().max(2_000).optional(),
  /**
   * Sent by the call-for-speakers account step, and by nothing else. It says
   * *which surface is asking*, not what may happen: `requestPortalLogin` looks
   * the form up itself and only treats an unknown address as a first-time
   * submitter when the id names a `cfp` form, on this event, that
   * `is_form_open` says is open right now. A forged or stale id therefore buys
   * exactly the behaviour of the plain sign-in box.
   */
  formId: formIdSchema.optional(),
});

/**
 * Public submit path front door (PLAN P3-SEC / roadmap "Fix now" item 4):
 * `requestPortalLoginIn`'s own throttle is per-contact (3/10min), which an
 * attacker defeats by cycling email addresses — each new address gets a
 * fresh bucket. This caps the same route by the one thing an address-cycling
 * attacker cannot rotate as cheaply: the calling IP.
 */
export async function POST(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await checkRateLimit(db, { key: `portal-login-request:${clientIp(request)}`, limit: 20, windowMs: 10 * 60 * 1000 });
    const input = inputSchema.parse(await request.json());
    // Per *address*, not per contact. `requestPortalLoginIn` counts the OTPs it
    // issued, which it can only do for an address that has a contact row — and
    // since it no longer creates one, an unknown address would otherwise never
    // be refused. That difference is an account-enumeration oracle as plainly
    // as a different screen would be: send four requests, and whether the
    // fourth is throttled tells you whether the person is on file. This bucket
    // fires on the same request with the same sentence for both.
    await checkRateLimit(db, {
      key: `portal-login-address:${input.eventSlug}:${input.email.trim().toLowerCase()}`,
      limit: PORTAL_LOGIN_THROTTLE.limit,
      windowMs: PORTAL_LOGIN_THROTTLE.windowMs,
      message: PORTAL_LOGIN_THROTTLE_MESSAGE,
    });
    const result = await requestPortalLogin(input.eventSlug, input.email, input.next, input.formId);
    // This request is waiting on a short-lived credential. Dispatch it now
    // instead of making a first-time speaker wait for the next one-minute cron
    // tick; the durable outbox and cron remain the failure/retry guarantee.
    try {
      const ctx = getCloudflareContext().ctx;
      nudgeOutbox(ctx.waitUntil.bind(ctx));
    } catch {
      // No Worker context (`next dev`, unit tests). The cron still drains it.
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "portal-auth",
      route: "/api/internal/auth/portal/request",
      fallbackMessages: { validation: "Enter a valid email", internal: "Unable to request a code" },
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
