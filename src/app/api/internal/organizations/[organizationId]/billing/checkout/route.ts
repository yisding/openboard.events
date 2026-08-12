import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { billingSurfaceUnavailableResponse, getBillingProviderAdapter, isBillingSurfaceEnabled, startBillingCheckoutInputSchema } from "@/features/billing";
import { organizationIdSchema } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function requireOrganizationId(params: Record<string, string | string[] | undefined>) {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

/**
 * M49 — starts a plan-change checkout through the provider seam
 * (`@/features/billing`'s `BillingProviderAdapter`). Owner-only: a plan
 * change is a financial commitment, the same bar `changeOrganizationMemberRole`
 * sets for granting/revoking ownership itself. Against the only adapter
 * implemented (`StubBillingProviderAdapter`) this always throws `VALIDATION`
 * — see that adapter's header comment — so this route exists to prove the
 * seam is wired end to end, not to actually collect payment.
 */
const post = defineHandler({
  auth: organizationAuth({ role: "owner" }),
  input: startBillingCheckoutInputSchema,
  handler: async ({ params, input }) => {
    const organizationId = requireOrganizationId(params);
    const returnUrl = `${getEnv().APP_BASE_URL}/organizations/${organizationId}/billing`;
    return getBillingProviderAdapter().createCheckoutSession({ organizationId, planId: input.planId, returnUrl });
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  if (!isBillingSurfaceEnabled()) return Promise.resolve(billingSurfaceUnavailableResponse());
  return post(request, route);
}
