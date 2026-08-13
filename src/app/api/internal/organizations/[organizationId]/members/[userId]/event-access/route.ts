import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { listManageableEventAccessForMember } from "@/features/organizations";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../../_lib";

const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params, session }) => listManageableEventAccessForMember(
    requireOrganizationId(params),
    userIdSchema.parse(session?.actorId),
    userIdSchema.parse(params.userId),
  ),
});

type Route = { params: Promise<{ organizationId: string; userId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}
