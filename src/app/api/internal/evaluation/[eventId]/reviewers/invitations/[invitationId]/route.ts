import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { revokeEventReviewerInvitation } from "@/features/organizations";
import { eventIdSchema, organizationInvitationIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const revoke = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params, session }) => {
    const invitationId = organizationInvitationIdSchema.parse(params.invitationId);
    await revokeEventReviewerInvitation(
      eventIdSchema.parse(eventId),
      invitationId,
      userIdSchema.parse(session?.actorId),
    );
    return { revoked: true };
  },
});

type Route = { params: Promise<{ eventId: string; invitationId: string }> };

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return revoke(request, route);
}
