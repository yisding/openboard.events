import { z } from "zod";
import type { NextRequest } from "next/server";
import { conditionSchema, eventIdSchema, formIdSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import { deleteRoutingRule, saveRoutingRule } from "@/features/forms/server/routing-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema, ruleId: z.uuid() });

const routingRuleInputSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(5),
  setTrackId: trackIdSchema.nullable(),
  addTagIds: z.array(tagIdSchema).max(50),
  enabled: z.boolean(),
});

// Routing rules are small, single-owner rows (Trap #6): last-write-wins here
// is deliberate — unlike M12's field/section saves, there is no
// `expectedUpdatedAt` staleness check for a single rule's full-replace PATCH.
const update = defineHandler({
  auth: formBuilderAuth(),
  input: routingRuleInputSchema,
  handler: async ({ eventId, input, params }) => {
    const route = paramsSchema.parse(params);
    return saveRoutingRule(eventIdSchema.parse(eventId), route.formId, { ...input, id: route.ruleId });
  },
});

const remove = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const route = paramsSchema.parse(params);
    await deleteRoutingRule(eventIdSchema.parse(eventId), route.formId, route.ruleId);
    return { deleted: true };
  },
});

type Route = { params: Promise<{ formId: string; ruleId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
