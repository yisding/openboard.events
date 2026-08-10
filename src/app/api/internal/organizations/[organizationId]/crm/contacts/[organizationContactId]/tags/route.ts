import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { setCrmContactTags } from "@/features/crm";
import { setCrmContactTagsInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationContactId, requireOrganizationId } from "../../../_lib";

/** Full-set tag replace for one contact. */
const set = defineHandler({
  auth: organizationAuth(),
  input: setCrmContactTagsInputSchema,
  handler: async ({ params, input }) => {
    await setCrmContactTags(requireOrganizationId(params), requireOrganizationContactId(params), input);
    return { updated: true };
  },
});

type Route = { params: Promise<{ organizationId: string; organizationContactId: string }> };

export function PUT(request: NextRequest, route: Route): Promise<Response> {
  return set(request, route);
}
