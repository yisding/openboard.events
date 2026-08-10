import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { organizationSubscriptions } from "@/db/schema";
import { safeEqual } from "@/features/auth/server/crypto";
import { billingPlanIdSchema, organizationIdSchema, subscriptionStatusSchema, type OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";

/**
 * M49 — the billing provider seam.
 *
 * `BillingProviderAdapter` is the interface a real integration (Stripe,
 * Paddle, LemonSqueezy, …) implements: start a checkout, start a self-serve
 * billing-portal session, and verify/parse the webhook events it sends. The
 * webhook route (`src/app/api/webhooks/billing/route.ts`) and every caller
 * in this feature talk to that interface only, never to a specific
 * provider's SDK — swapping the adapter a real integration lands is a
 * one-function change (`getBillingProviderAdapter` below), not a rewrite of
 * the routes or the entitlement logic.
 *
 * **`StubBillingProviderAdapter` is the only adapter implemented.** No live
 * payment provider is connected anywhere in this codebase. Its checkout/
 * portal methods throw rather than fabricate a working-looking URL — a
 * scaffold that silently pretended a payment happened would be worse than
 * one that visibly refuses. Its webhook verification is a plain shared-secret
 * HMAC over the raw body (`BILLING_WEBHOOK_SECRET`), and its event shape
 * (`billingProviderWebhookEventSchema` below) is this application's own JSON,
 * **not** any real provider's wire format — a live adapter's job is to
 * translate its provider's payload into this same shape before calling
 * `applyBillingProviderEventIn`, the same way the shape itself is provider-
 * agnostic on purpose.
 */

export type BillingCheckoutInput = { organizationId: OrganizationId; planId: string; returnUrl: string };
export type BillingPortalInput = { organizationId: OrganizationId; returnUrl: string };

const billingProviderWebhookEventSchema = z.object({
  type: z.enum(["subscription.updated", "subscription.canceled"]),
  organizationId: organizationIdSchema,
  planId: billingPlanIdSchema,
  status: subscriptionStatusSchema,
  providerCustomerId: z.string().optional(),
  providerSubscriptionId: z.string().optional(),
  currentPeriodStart: z.iso.datetime().optional(),
  currentPeriodEnd: z.iso.datetime().optional(),
});
export type BillingProviderWebhookEvent = z.infer<typeof billingProviderWebhookEventSchema>;

export interface BillingProviderAdapter {
  readonly name: string;
  createCheckoutSession(input: BillingCheckoutInput): Promise<{ url: string }>;
  createBillingPortalSession(input: BillingPortalInput): Promise<{ url: string }>;
  /** `signature` is whatever header the provider signs with — `null` if the request carried none. */
  verifyWebhookSignature(input: { rawBody: string; signature: string | null }): Promise<boolean>;
  parseWebhookEvent(rawBody: string): BillingProviderWebhookEvent | null;
}

const NOT_CONNECTED = "Billing is a scaffold in this environment: no live payment provider is connected, so this action is not available yet.";

async function hmacSha256Hex(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class StubBillingProviderAdapter implements BillingProviderAdapter {
  readonly name = "stub";

  /**
   * `secretOverride` exists only so tests can exercise
   * `verifyWebhookSignature` without mutating `process.env` — mirrors
   * `verifyResendWebhookSignature`'s own choice to take `secret` as a plain
   * argument (`features/comms/server/webhook.ts`) rather than reading `getEnv()`
   * mid-function. `getBillingProviderAdapter()` (the only production call site)
   * never passes one, so a real request always reads the live env var.
   */
  constructor(private readonly secretOverride?: string) {}

  async createCheckoutSession(): Promise<{ url: string }> {
    throw new AppError("VALIDATION", NOT_CONNECTED);
  }

  async createBillingPortalSession(): Promise<{ url: string }> {
    throw new AppError("VALIDATION", NOT_CONNECTED);
  }

  /** Fails closed: no secret configured, or no signature header sent, is never treated as verified. */
  async verifyWebhookSignature({ rawBody, signature }: { rawBody: string; signature: string | null }): Promise<boolean> {
    const secret = this.secretOverride ?? getEnv().BILLING_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = await hmacSha256Hex(secret, rawBody);
    return safeEqual(signature, expected);
  }

  parseWebhookEvent(rawBody: string): BillingProviderWebhookEvent | null {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const parsed = billingProviderWebhookEventSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }
}

/**
 * The one place a real integration gets wired in later — swap what this
 * function returns, not any of its callers.
 */
export function getBillingProviderAdapter(): BillingProviderAdapter {
  return new StubBillingProviderAdapter();
}

/**
 * Applies a verified, parsed webhook event to `organization_subscriptions`.
 * `provider` on the row is set to the adapter's own `name` — never guessed —
 * so the row always states which adapter last wrote it. Zero rows updated
 * means the event named an organization with no subscription row, which the
 * invariant every other write in this feature maintains says should never
 * happen; that is `NOT_FOUND`, not a silent no-op.
 */
export async function applyBillingProviderEventIn(dbOrTx: DbOrTx, adapter: BillingProviderAdapter, event: BillingProviderWebhookEvent): Promise<void> {
  const [updated] = await dbOrTx.update(organizationSubscriptions)
    .set({
      planId: event.planId,
      status: event.status,
      provider: adapter.name,
      ...(event.providerCustomerId !== undefined ? { providerCustomerId: event.providerCustomerId } : {}),
      ...(event.providerSubscriptionId !== undefined ? { providerSubscriptionId: event.providerSubscriptionId } : {}),
      ...(event.currentPeriodStart !== undefined ? { currentPeriodStart: new Date(event.currentPeriodStart) } : {}),
      ...(event.currentPeriodEnd !== undefined ? { currentPeriodEnd: new Date(event.currentPeriodEnd) } : {}),
      // Only a `subscription.canceled` event asserts this — a plain
      // `subscription.updated` event leaves whatever value the row already
      // has alone, rather than stomping a pending cancellation back to
      // `false` every time an unrelated field changes.
      ...(event.type === "subscription.canceled" ? { cancelAtPeriodEnd: true } : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.organizationId, event.organizationId))
    .returning();
  if (!updated) throw new AppError("NOT_FOUND", "That organization has no billing subscription row");
}
export const applyBillingProviderEvent = (adapter: BillingProviderAdapter, event: BillingProviderWebhookEvent): Promise<void> =>
  applyBillingProviderEventIn(db, adapter, event);
