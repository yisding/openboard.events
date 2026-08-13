import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { nudgeAdminAuthEmailOutbox, organizationAuth } from "@/features/auth";
import { inviteOrganizationMember, inviteOrganizationMemberInputSchema, listPendingOrganizationInvitations } from "@/features/organizations";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => listPendingOrganizationInvitations(requireOrganizationId(params)),
});

const invite = defineHandler({
  auth: organizationAuth(),
  input: inviteOrganizationMemberInputSchema,
  handler: async ({ params, session, input }) => {
    const organizationId = requireOrganizationId(params);
    const actorUserId = userIdSchema.parse(session?.actorId);
    return inviteOrganizationMember(organizationId, actorUserId, input);
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: Route): Promise<Response> {
  const response = await invite(request, route);
  if (response.ok) {
    // Invitation acceptance is a short-lived credential flow. Start delivery
    // immediately; the durable product outbox and cron remain the guarantee.
    try {
      const ctx = getCloudflareContext().ctx;
      nudgeAdminAuthEmailOutbox(ctx.waitUntil.bind(ctx));
    } catch {
      // No Worker context under next dev/unit tests; cron still drains it.
    }
  }
  return response;
}
