import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { recoverCrmMerge } from "@/features/crm";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireCrmMergeId, requireOrganizationId } from "../../../_lib";

const recover = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params, session }) => {
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    return recoverCrmMerge(requireOrganizationId(params), requireCrmMergeId(params), actorUserId);
  },
});

type Route = { params: Promise<{ organizationId: string; mergeId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return recover(request, route);
}
