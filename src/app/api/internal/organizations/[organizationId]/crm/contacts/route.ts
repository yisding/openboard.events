import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { createOrganizationContact, listOrganizationContacts } from "@/features/crm";
import { createOrganizationContactInputSchema, crmPipelineStageSchema, crmTagIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** The organization-wide speaker directory: search/filter (AC: "search/filter
 * across at least two events") and manual creation. */

const csv = (value: unknown): string[] | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.split(",").filter(Boolean);
};

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tagIds: z.string().optional(),
  eventIds: z.string().optional(),
  hasEventLink: z.enum(["true", "false"]).optional(),
  pipelineStage: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).transform((raw) => ({
  search: raw.search,
  tagIds: csv(raw.tagIds)?.map((id) => crmTagIdSchema.parse(id)),
  eventIds: csv(raw.eventIds)?.map((id) => eventIdSchema.parse(id)),
  hasEventLink: raw.hasEventLink === undefined ? undefined : raw.hasEventLink === "true",
  pipelineStage: csv(raw.pipelineStage)?.map((stage) => crmPipelineStageSchema.parse(stage)),
  limit: raw.limit,
  offset: raw.offset,
}));

const list = defineHandler({
  auth: organizationAuth(),
  input: listQuerySchema,
  handler: ({ params, input }) => listOrganizationContacts(requireOrganizationId(params), input),
});

const create = defineHandler({
  auth: organizationAuth(),
  input: createOrganizationContactInputSchema,
  handler: async ({ params, input }) => {
    const organizationId = requireOrganizationId(params);
    const id = await createOrganizationContact(organizationId, input);
    return { id };
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
