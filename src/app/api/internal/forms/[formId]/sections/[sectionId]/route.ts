import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import { withTx } from "@/db/client";
import { updateSectionIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema, sectionId: sectionIdSchema });
const patchSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  pageHeading: z.string().trim().min(1).max(15).optional(),
  descriptionHtml: z.string().max(100_000).optional(),
}).refine((patch) => Object.keys(patch).length > 0, "Patch must change at least one field");

const update = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ expectedUpdatedAt: z.iso.datetime(), patch: patchSchema }),
  handler: async ({ eventId, input, params }) => {
    const route = paramsSchema.parse(params);
    return withTx((tx) => updateSectionIn(tx, eventIdSchema.parse(eventId), route.formId, route.sectionId, input.patch, input.expectedUpdatedAt));
  },
});

export function PATCH(request: NextRequest, route: { params: Promise<{ formId: string; sectionId: string }> }): Promise<Response> {
  return update(request, route);
}
