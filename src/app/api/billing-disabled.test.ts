import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getBilling } from "./internal/organizations/[organizationId]/billing/route";
import { POST as startCheckout } from "./internal/organizations/[organizationId]/billing/checkout/route";
import { POST as billingWebhook } from "./webhooks/billing/route";

const organizationId = "c0000000-0000-4000-8000-000000000001";
const route = { params: Promise.resolve({ organizationId }) };

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    error: { code: "NOT_FOUND", message: "Billing is not available" },
  });
}

describe("disabled billing launch surface", () => {
  it("does not expose the organization billing API", async () => {
    await expectUnavailable(await getBilling(
      new NextRequest(`http://localhost/api/internal/organizations/${organizationId}/billing`),
      route,
    ));
  });

  it("does not accept checkout attempts", async () => {
    await expectUnavailable(await startCheckout(
      new NextRequest(`http://localhost/api/internal/organizations/${organizationId}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ planId: "pro" }),
      }),
      route,
    ));
  });

  it("does not expose a provider webhook", async () => {
    await expectUnavailable(await billingWebhook(new NextRequest("http://localhost/api/webhooks/billing", {
      method: "POST",
      body: "not a provider payload",
    })));
  });
});
