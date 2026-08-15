import { NextResponse, type NextRequest } from "next/server";
import { parseResendWebhookEvent, recordSuppression, verifyResendWebhookSignature } from "@/features/comms";
import { recordAdminAuthEmailSuppression } from "@/features/auth";
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

    const parsed = parseResendWebhookEvent(body);
    if (parsed) {
      const result = await recordSuppression({ providerMessageId: parsed.emailId, reason: parsed.reason });
      if (!result) await recordAdminAuthEmailSuppression({ providerMessageId: parsed.emailId, reason: parsed.reason });
      log({ level: "info", msg: "webhook.resend.suppression", requestId, feature: "comms", ...(result ? { eventId: result.eventId } : {}) });
    }
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    const { envelope, status } = errorEnvelope(error, { requestId, feature: "comms", msg: "webhook.resend.failed" });
    return NextResponse.json(envelope, { status });
  }
}
