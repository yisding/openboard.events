import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { createCrmPipelineEntry, listCrmPipeline } from "@/features/crm";
import { createCrmPipelineEntryInputSchema, crmPipelineStageSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** The sourcing kanban: open/won/lost. */
const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({ stage: crmPipelineStageSchema.optional() }),
  handler: ({ params, input }) => listCrmPipeline(requireOrganizationId(params), input.stage),
});

const create = defineHandler({
  auth: organizationAuth(),
  input: createCrmPipelineEntryInputSchema,
  handler: ({ params, input }) => createCrmPipelineEntry(requireOrganizationId(params), input),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
