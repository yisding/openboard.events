import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { revokeOrganizationInvitation } from "@/features/organizations";
import { organizationIdSchema, organizationInvitationIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const revoke = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params, session }) => {
    const rawOrganizationId = params.organizationId;
    if (typeof rawOrganizationId !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
    const organizationId = organizationIdSchema.parse(rawOrganizationId);
    const invitationId = organizationInvitationIdSchema.parse(params.invitationId);
    const actorUserId = userIdSchema.parse(session?.actorId);
    await revokeOrganizationInvitation(organizationId, invitationId, actorUserId);
    return { revoked: true };
  },
});

type Route = { params: Promise<{ organizationId: string; invitationId: string }> };

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return revoke(request, route);
}
