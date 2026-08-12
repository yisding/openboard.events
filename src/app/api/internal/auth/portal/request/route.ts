import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requestPortalLogin } from "@/features/auth";
import { nudgeOutbox } from "@/features/comms";
import { isAppError, toHttp } from "@/shared/lib/errors";
import { assertSameOrigin } from "@/shared/server/csrf";
import { checkRateLimit, clientIp } from "@/shared/server/rate-limit";

const inputSchema = z.object({ eventSlug: z.string().min(1), email: z.email(), next: z.string().max(2_000).optional() });

/**
 * Public submit path front door (PLAN P3-SEC / roadmap "Fix now" item 4):
 * `requestPortalLoginIn`'s own throttle is per-contact (3/10min), which an
 * attacker defeats by cycling email addresses — each new address gets a
 * fresh bucket. This caps the same route by the one thing an address-cycling
 * attacker cannot rotate as cheaply: the calling IP.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(db, { key: `portal-login-request:${clientIp(request)}`, limit: 20, windowMs: 10 * 60 * 1000 });
    const input = inputSchema.parse(await request.json());
    const result = await requestPortalLogin(input.eventSlug, input.email, input.next);
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
    if (isAppError(error)) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Enter a valid email" } }, { status: 400 });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Unable to request a code" } }, { status: 500 });
  }
}
