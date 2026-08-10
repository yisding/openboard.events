import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { createCrmTag, listCrmTags } from "@/features/crm";
import { createCrmTagInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params }) => listCrmTags(requireOrganizationId(params)),
});

const create = defineHandler({
  auth: organizationAuth(),
  input: createCrmTagInputSchema,
  handler: ({ params, input }) => createCrmTag(requireOrganizationId(params), input),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
