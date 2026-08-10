import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { createCrmCustomField, listCrmCustomFields } from "@/features/crm";
import { createCrmCustomFieldInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params }) => listCrmCustomFields(requireOrganizationId(params)),
});

const create = defineHandler({
  auth: organizationAuth(),
  input: createCrmCustomFieldInputSchema,
  handler: ({ params, input }) => createCrmCustomField(requireOrganizationId(params), input),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
