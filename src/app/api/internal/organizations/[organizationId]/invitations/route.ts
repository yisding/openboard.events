import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { nudgeAdminAuthEmailOutbox, organizationAuth } from "@/features/auth";
import { inviteOrganizationMember, inviteOrganizationMemberInputSchema, listPendingOrganizationInvitations } from "@/features/organizations";
import { organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function requireOrganizationId(params: Record<string, string | string[] | undefined>) {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

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
