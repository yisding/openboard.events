import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { changeOrganizationMemberRole, changeOrganizationMemberRoleInputSchema, removeOrganizationMemberAudited } from "@/features/organizations";
import { organizationIdSchema, userIdSchema, type MemberRole } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function requireOrganizationId(params: Record<string, string | string[] | undefined>) {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

const changeRole = defineHandler({
  auth: organizationAuth(),
  input: changeOrganizationMemberRoleInputSchema,
  handler: async ({ params, session, input }) => {
    const organizationId = requireOrganizationId(params);
    const targetUserId = userIdSchema.parse(params.userId);
    const actorUserId = userIdSchema.parse(session?.actorId);
    const role = await changeOrganizationMemberRole(organizationId, actorUserId, (session?.role ?? "reviewer") as MemberRole, targetUserId, input.role);
    return { userId: targetUserId, role };
  },
});

const remove = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params, session }) => {
    const organizationId = requireOrganizationId(params);
    const targetUserId = userIdSchema.parse(params.userId);
    const actorUserId = userIdSchema.parse(session?.actorId);
    await removeOrganizationMemberAudited(organizationId, actorUserId, (session?.role ?? "reviewer") as MemberRole, targetUserId);
    return { removed: true };
  },
});

type Route = { params: Promise<{ organizationId: string; userId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return changeRole(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
