import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { reorderRoutingRules } from "@/features/forms/server/routing-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema });

const reorder = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ orderedIds: z.array(z.uuid()).min(1) }),
  handler: async ({ eventId, input, params }) => {
    await reorderRoutingRules(eventIdSchema.parse(eventId), paramsSchema.parse(params).formId, input.orderedIds);
    return { reordered: true };
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return reorder(request, route);
}
