import type { NextRequest } from "next/server";
import { z } from "zod";
import { createEventInputSchema, listEvents } from "@/features/events";
import { eventsHubAuth } from "@/features/events/server/guards";
import { provisionEventForActor } from "@/features/onboarding";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/**
 * M11's event hub, kept honest under M43 tenancy.
 *
 * `eventsHubAuth` has no organization route segment and admits any signed-in
 * admin, so both handlers below have to derive their tenant scope from the
 * actor rather than from the URL:
 *
 * - **GET** is scoped inside the query (`listEventsIn`). It used to return
 *   every tenant's events to every signed-in account.
 * - **POST** is compatibility-only. It delegates to the same organization
 *   provisioning path as guided onboarding, including organizer-role and
 *   plan-limit checks. The only exception is a hand-bootstrapped account with
 *   no organization, which retains the original single-tenant create path.
 *
 * `POST /api/internal/organizations/[organizationId]/onboarding/event` (M45)
 * remains the explicit path — it names its organization and enforces the M49
 * plan limits. This route is the legacy door, now pointing at the right tenant.
 */

const list = defineHandler({
  auth: eventsHubAuth(),
  input: z.object({}),
  handler: async ({ session }) => listEvents(userIdSchema.parse(session?.actorId)),
});

const create = defineHandler({
  auth: eventsHubAuth(),
  input: createEventInputSchema,
  handler: async ({ session, input }) => {
    const actorId = userIdSchema.parse(session?.actorId);
    return provisionEventForActor(actorId, input);
  },
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
