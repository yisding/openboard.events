import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { createEventInputSchema } from "@/features/events";
import { onboardingProgressUpdateSchema, provisionOrganizationEvent, updateOrganizationOnboarding } from "@/features/onboarding";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../_lib";

/**
 * M45 step 1 — "event basics". The organization-scoped twin of `POST
 * /api/internal/events` (M11): same input, same `createEventIn` underneath
 * (via `provisionOrganizationEvent`), but the caller is authorized against
 * `organization_members` (this organization, organizer+) instead of "any
 * signed-in admin", and the created event is assigned to `organizationId`
 * before this responds — never left under the default organization for a
 * self-serve org to lose track of.
 */
const create = defineHandler({
  auth: organizationAuth(),
  input: createEventInputSchema,
  handler: async ({ session, input, params }) =>
    provisionOrganizationEvent(userIdSchema.parse(session?.actorId), requireOrganizationId(params), input),
});

const updateProgress = defineHandler({
  auth: organizationAuth(),
  input: onboardingProgressUpdateSchema,
  handler: ({ session, input, params }) => updateOrganizationOnboarding(
    userIdSchema.parse(session?.actorId),
    requireOrganizationId(params),
    input,
  ),
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return updateProgress(request, route);
}
