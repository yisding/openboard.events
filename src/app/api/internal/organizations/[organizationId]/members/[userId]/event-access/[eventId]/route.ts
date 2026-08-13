import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { eventAccessRoleInputSchema, removeExplicitEventAccess, setExplicitEventAccess } from "@/features/organizations";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../../../_lib";

function ids(params: Record<string, string | string[] | undefined>) {
  return {
    organizationId: requireOrganizationId(params),
    targetUserId: userIdSchema.parse(params.userId),
    eventId: eventIdSchema.parse(params.eventId),
  };
}

const set = defineHandler({
  auth: organizationAuth(),
  input: eventAccessRoleInputSchema,
  handler: async ({ params, session, input }) => {
    const scoped = ids(params);
    const role = await setExplicitEventAccess(
      scoped.organizationId,
      scoped.eventId,
      userIdSchema.parse(session?.actorId),
      scoped.targetUserId,
      input.role,
    );
    return { eventId: scoped.eventId, role };
  },
});

const remove = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params, session }) => {
    const scoped = ids(params);
    await removeExplicitEventAccess(
      scoped.organizationId,
      scoped.eventId,
      userIdSchema.parse(session?.actorId),
      scoped.targetUserId,
    );
    return { removed: true };
  },
});

type Route = { params: Promise<{ organizationId: string; userId: string; eventId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return set(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
