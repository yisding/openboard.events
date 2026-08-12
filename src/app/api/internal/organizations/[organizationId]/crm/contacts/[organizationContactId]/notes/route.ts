import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { createCrmNote } from "@/features/crm";
import { createCrmNoteInputSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationContactId, requireOrganizationId } from "../../../_lib";

const create = defineHandler({
  auth: organizationAuth(),
  input: createCrmNoteInputSchema,
  handler: async ({ params, session, input }) => {
    const organizationId = requireOrganizationId(params);
    const organizationContactId = requireOrganizationContactId(params);
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    return createCrmNote(organizationId, organizationContactId, input, actorUserId);
  },
});

type Route = { params: Promise<{ organizationId: string; organizationContactId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
