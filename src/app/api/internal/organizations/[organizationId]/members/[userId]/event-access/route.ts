import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { listManageableEventAccessForMember } from "@/features/organizations";
import { organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function requireOrganizationId(params: Record<string, string | string[] | undefined>) {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

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
