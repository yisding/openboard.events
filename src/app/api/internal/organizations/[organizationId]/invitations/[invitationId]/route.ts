import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { revokeOrganizationInvitation } from "@/features/organizations";
import { organizationInvitationIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../_lib";

const revoke = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params, session }) => {
    const organizationId = requireOrganizationId(params);
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
