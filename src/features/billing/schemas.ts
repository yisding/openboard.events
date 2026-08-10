import { z } from "zod";
import { billingPlanIdSchema } from "@/shared/contracts";

/**
 * Pure zod schemas for the billing feature — no server imports, same split
 * `features/organizations/schemas.ts` uses.
 */

export const startBillingCheckoutInputSchema = z.object({ planId: billingPlanIdSchema });
export type StartBillingCheckoutInput = z.infer<typeof startBillingCheckoutInputSchema>;
