import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { transitionCrmPipeline } from "@/features/crm";
import { transitionCrmPipelineInputSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId, requirePipelineId } from "../../../_lib";

/** AC: "Move a prospect through open/won/lost states and verify timestamped
 * history." */
const transition = defineHandler({
  auth: organizationAuth(),
  input: transitionCrmPipelineInputSchema,
  handler: ({ params, session, input }) => {
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    return transitionCrmPipeline(requireOrganizationId(params), requirePipelineId(params), input, actorUserId);
  },
});

type Route = { params: Promise<{ organizationId: string; pipelineId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return transition(request, route);
}
