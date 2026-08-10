import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { organizationIdSchema } from "@/shared/contracts";
import { StubBillingProviderAdapter, type BillingProviderAdapter } from "./provider";

const SECRET = "test-billing-webhook-secret";
const ORG_ID = organizationIdSchema.parse("b1110000-0000-4000-8000-000000000001");

function signHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * M49 — the stub billing provider adapter. `StubBillingProviderAdapter` is
 * the only `BillingProviderAdapter` implemented (no live payment provider);
 * these are the properties that make it a *safe* stub rather than a
 * misleading one — checkout/portal never fabricate success, and webhook
 * verification fails closed exactly like `verifyResendWebhookSignature`
 * already does for the email side.
 */
describe("StubBillingProviderAdapter", () => {
  it("never fabricates a working checkout or billing-portal session", async () => {
    // Typed as the interface, not the concrete class: `BillingProviderAdapter`
    // declares both methods as taking an input object, and this is the type
    // every real caller (the checkout route) has — the concrete class'
    // narrower "ignores its input" signature is an implementation detail.
    const adapter: BillingProviderAdapter = new StubBillingProviderAdapter(SECRET);
    await expect(adapter.createCheckoutSession({ organizationId: ORG_ID, planId: "pro", returnUrl: "https://example.test" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(adapter.createBillingPortalSession({ organizationId: ORG_ID, returnUrl: "https://example.test" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });

  describe("verifyWebhookSignature", () => {
    it("verifies a correctly signed request", async () => {
      const adapter = new StubBillingProviderAdapter(SECRET);
      const body = JSON.stringify({ type: "subscription.updated" });
      await expect(adapter.verifyWebhookSignature({ rawBody: body, signature: signHex(SECRET, body) })).resolves.toBe(true);
    });

    it("rejects a tampered body or the wrong secret's signature", async () => {
      const adapter = new StubBillingProviderAdapter(SECRET);
      const body = JSON.stringify({ type: "subscription.updated" });
      const signature = signHex(SECRET, body);
      await expect(adapter.verifyWebhookSignature({ rawBody: '{"tampered":true}', signature })).resolves.toBe(false);
      await expect(adapter.verifyWebhookSignature({ rawBody: body, signature: signHex("wrong-secret", body) })).resolves.toBe(false);
    });

    it("fails closed with no signature header, and with no secret configured", async () => {
      const body = JSON.stringify({ type: "subscription.updated" });
      await expect(new StubBillingProviderAdapter(SECRET).verifyWebhookSignature({ rawBody: body, signature: null })).resolves.toBe(false);
      await expect(new StubBillingProviderAdapter(undefined).verifyWebhookSignature({ rawBody: body, signature: signHex(SECRET, body) })).resolves.toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a well-formed event", () => {
      const adapter = new StubBillingProviderAdapter(SECRET);
      const event = adapter.parseWebhookEvent(JSON.stringify({
        type: "subscription.updated",
        organizationId: ORG_ID,
        planId: "pro",
        status: "active",
      }));
      expect(event).toEqual({ type: "subscription.updated", organizationId: ORG_ID, planId: "pro", status: "active" });
    });

    it("returns null for malformed JSON or a payload missing required fields", () => {
      const adapter = new StubBillingProviderAdapter(SECRET);
      expect(adapter.parseWebhookEvent("not json")).toBeNull();
      expect(adapter.parseWebhookEvent(JSON.stringify({ type: "subscription.updated" }))).toBeNull();
      expect(adapter.parseWebhookEvent(JSON.stringify({ type: "unknown.event", organizationId: ORG_ID, planId: "pro", status: "active" }))).toBeNull();
    });
  });
});
