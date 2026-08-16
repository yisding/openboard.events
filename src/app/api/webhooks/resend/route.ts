import { NextResponse, type NextRequest } from "next/server";
import { claimWebhookDelivery, parseResendWebhookEvent, recordSuppression, suppressAddress, verifyResendWebhookSignature } from "@/features/comms";
import { recordAdminAuthEmailSuppression } from "@/features/auth";
import { db } from "@/db/client";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { errorEnvelope } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Resend bounce/complaint webhook (PLAN roadmap P3-EMAIL). Signature-verified
 * (Svix scheme, `verifyResendWebhookSignature`), not cookie/session
 * authenticated, so this deliberately does not go through `defineHandler` —
 * the same documented exception the four hand-rolled portal-auth routes
 * take (src/app/api/internal/auth/portal/*), and for the same structural
 * reason here: signature verification needs the *raw* request body bytes,
 * and `defineHandler`'s guard/`bodyInput` split would each need their own
 * read of a body a `Request` can only be consumed once — cloning the
 * request there for one caller was a worse trade than hand-rolling this one
 * route the same way those four already do.
 *
 * Every recognized event that is not a bounce/complaint (delivered, opened,
 * clicked, …) is a 200 no-op — Resend does not need this route to
 * understand its full event catalog, only the two that suppress a contact.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const secret = getEnv().RESEND_WEBHOOK_SECRET;
    if (!secret) throw new AppError("INTERNAL", "RESEND_WEBHOOK_SECRET is not configured");

    const id = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!id || !timestamp || !signature) throw new AppError("UNAUTHORIZED", "Missing webhook signature headers");

    const body = await request.text();
    const verified = await verifyResendWebhookSignature({ id, timestamp, signature, body, secret });
    if (!verified) throw new AppError("UNAUTHORIZED", "Invalid webhook signature");

    // Signature and timestamp together prove the payload is genuine and recent.
    // Neither proves it is new: until this claim existed, anyone holding a
    // captured delivery could replay it for the full tolerance window. The
    // reply is a 200, not a rejection — the delivery *was* accepted, the first
    // time — because a 4xx here would put Svix into its retry ladder for a
    // message this endpoint has already handled.
    if (!await claimWebhookDelivery(db, "resend", id)) {
      log({ level: "info", msg: "webhook.resend.duplicate", requestId, feature: "comms", route: "/api/webhooks/resend" });
      return NextResponse.json({ data: { ok: true, duplicate: true } });
    }

    const parsed = parseResendWebhookEvent(body);
    if (parsed) {
      const result = await recordSuppression({ providerMessageId: parsed.emailId, reason: parsed.reason });
      if (!result) {
        // The platform outbox owns this message. Suppressing its row starts that
        // table's own 30-day ageing window, but stops there — so the comms
        // dispatcher, which has no ageing at all, kept mailing an address the
        // provider had already confirmed undeliverable, and the organizer's
        // Suppressions tab showed nothing to explain it. The two outboxes
        // provably address the same mailboxes: a reviewer invitation goes out
        // through the platform one, and `ensureReviewerContact` materialises a
        // `contacts` row from that same `users.email`. A bounce is a fact about
        // the mailbox, so it has to reach both.
        const suppressed = await recordAdminAuthEmailSuppression({ providerMessageId: parsed.emailId, reason: parsed.reason });
        if (suppressed) await suppressAddress(suppressed.recipientEmail, parsed.reason);
      }
      log({ level: "info", msg: "webhook.resend.suppression", requestId, feature: "comms", ...(result ? { eventId: result.eventId } : {}) });
    }
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    const { envelope, status, headers } = errorEnvelope(error, { requestId, feature: "comms", route: "/api/webhooks/resend", msg: "webhook.resend.failed" });
    return NextResponse.json(envelope, { status, headers });
  }
}
