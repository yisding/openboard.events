import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import { withTx } from "@/db/client";
import { reorderFieldsIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema });

const reorder = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ expectedUpdatedAt: z.iso.datetime(), sectionId: sectionIdSchema, orderedFieldIds: z.array(fieldIdSchema).min(1) }),
  handler: async ({ eventId, input, params }) => withTx((tx) => reorderFieldsIn(
    tx,
    eventIdSchema.parse(eventId),
    paramsSchema.parse(params).formId,
    input.sectionId,
    input.orderedFieldIds,
    input.expectedUpdatedAt,
  )),
});

export function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return reorder(request, route);
}
