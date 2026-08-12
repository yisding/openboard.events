import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { eventAccessRoleInputSchema, removeExplicitEventAccess, setExplicitEventAccess } from "@/features/organizations";
import { eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function ids(params: Record<string, string | string[] | undefined>) {
  const rawOrganizationId = params.organizationId;
  if (typeof rawOrganizationId !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return {
    organizationId: organizationIdSchema.parse(rawOrganizationId),
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
