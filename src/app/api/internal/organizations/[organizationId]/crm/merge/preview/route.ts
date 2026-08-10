import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { previewCrmMerge } from "@/features/crm";
import { previewCrmMergeInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../_lib";

/** Guardrail: merge "requires preview, explicit primary, reference counts"
 * before committing. Never writes. */
const preview = defineHandler({
  auth: organizationAuth(),
  input: previewCrmMergeInputSchema,
  handler: ({ params, input }) => previewCrmMerge(requireOrganizationId(params), input),
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return preview(request, route);
}
