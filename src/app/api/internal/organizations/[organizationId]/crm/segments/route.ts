import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { createCrmSegment, listCrmSegments } from "@/features/crm";
import { createCrmSegmentInputSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** AC: "Save a dynamic segment, observe membership change after an
 * underlying field edit" — `filter` is resolved fresh on every read
 * (`GET .../segments/[segmentId]/resolve`), never materialized here. */
const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params }) => listCrmSegments(requireOrganizationId(params)),
});

const create = defineHandler({
  auth: organizationAuth(),
  input: createCrmSegmentInputSchema,
  handler: ({ params, session, input }) => {
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    return createCrmSegment(requireOrganizationId(params), input, actorUserId);
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
