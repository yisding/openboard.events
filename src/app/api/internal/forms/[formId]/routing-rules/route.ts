import { z } from "zod";
import type { NextRequest } from "next/server";
import { conditionSchema, eventIdSchema, formIdSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import { listRoutingRules, saveRoutingRule } from "@/features/forms/server/routing-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema });

const routingRuleInputSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(5),
  setTrackId: trackIdSchema.nullable(),
  addTagIds: z.array(tagIdSchema).max(50),
  enabled: z.boolean(),
});

const list = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => listRoutingRules(eventIdSchema.parse(eventId), paramsSchema.parse(params).formId),
});

const create = defineHandler({
  auth: formBuilderAuth(),
  input: routingRuleInputSchema,
  handler: async ({ eventId, input, params }) => saveRoutingRule(eventIdSchema.parse(eventId), paramsSchema.parse(params).formId, input),
});

type Route = { params: Promise<{ formId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
