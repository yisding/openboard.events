import { getEnv, type RuntimeEnv } from "@/shared/lib/env";

type BillingAvailabilityEnv = Pick<RuntimeEnv, "APP_ENV" | "BILLING_MODE">;

/**
 * Persisted plans and event entitlements remain active, but the commercial
 * UI/API/webhook surface must not ship while the only provider is the stub.
 */
export function isBillingSurfaceEnabled(env: BillingAvailabilityEnv = getEnv()): boolean {
  return env.APP_ENV === "local" && env.BILLING_MODE === "scaffold";
}

export function billingSurfaceUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Billing is not available" } },
    { status: 404 },
  );
}
