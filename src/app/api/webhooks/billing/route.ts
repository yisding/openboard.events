import { NextResponse, type NextRequest } from "next/server";
import { applyBillingProviderEvent, getBillingProviderAdapter } from "@/features/billing";
import { AppError, isAppError, toHttp } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";

export const dynamic = "force-dynamic";

/**
 * M49 — the billing provider webhook. Signature-verified
 * (`BillingProviderAdapter.verifyWebhookSignature`), not cookie/session
 * authenticated, so this deliberately does not go through `defineHandler` —
 * the same documented exception `src/app/api/webhooks/resend/route.ts`
 * takes: signature verification needs the *raw* request body bytes, and
 * `defineHandler`'s guard/`bodyInput` split would each need their own read
 * of a body a `Request` can only be consumed once.
 *
 * Against `StubBillingProviderAdapter` (the only adapter implemented — see
 * its header comment) `verifyWebhookSignature` fails closed whenever
 * `BILLING_WEBHOOK_SECRET` is unset or the caller sent no signature header,
 * so this route 401s until that secret is provisioned. It exists now so the
 * seam — route, adapter interface, event shape, and the
 * `applyBillingProviderEventIn` write it drives — is real and testable
 * before any live provider is chosen, not bolted on afterward.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const adapter = getBillingProviderAdapter();
    const signature = request.headers.get("x-billing-signature");
    const rawBody = await request.text();

    const verified = await adapter.verifyWebhookSignature({ rawBody, signature });
    if (!verified) throw new AppError("UNAUTHORIZED", "Invalid or missing webhook signature");

    const event = adapter.parseWebhookEvent(rawBody);
    if (event) {
      await applyBillingProviderEvent(adapter, event);
      log({ level: "info", msg: `webhook.billing.applied.${event.type}`, requestId, feature: "billing" });
    }
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    const appError = isAppError(error) ? error : new AppError("INTERNAL", "Unexpected server error");
    log({ level: appError.code === "INTERNAL" ? "error" : "warn", msg: "webhook.billing.failed", code: appError.code, requestId, feature: "billing" });
    return NextResponse.json({ error: { code: appError.code, message: appError.message } }, { status: toHttp(appError.code) });
  }
}
