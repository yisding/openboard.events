import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  COMMITTED_FIELD_TYPES,
  eventIdSchema,
  fieldIdSchema,
  formIdSchema,
  mapsToTargetSchema,
  reviewVisibilitySchema,
  visibilityRuleSchema,
} from "@/shared/contracts";
import { withTx } from "@/db/client";
import { deleteFieldIn, updateFieldIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema, fieldId: fieldIdSchema });
const patchSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  key: z.string().trim().min(1).max(80).optional(),
  fieldType: z.enum(COMMITTED_FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  maxChars: z.int().positive().max(100_000).nullable().optional(),
  helpText: z.string().max(5_000).optional(),
  optionLabels: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
  visibility: visibilityRuleSchema.nullable().optional(),
  mapsTo: mapsToTargetSchema.nullable().optional(),
  // M50 blind review. Not structural: it governs what a future anonymized
  // reviewer sees, never the answers a pinned snapshot already carries.
  reviewVisibility: reviewVisibilitySchema.optional(),
}).refine((patch) => Object.keys(patch).length > 0, "Patch must change at least one field");

const update = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ expectedUpdatedAt: z.iso.datetime(), patch: patchSchema }),
  handler: async ({ eventId, input, params }) => {
    const route = paramsSchema.parse(params);
    return withTx((tx) => updateFieldIn(tx, eventIdSchema.parse(eventId), route.formId, route.fieldId, input.patch, input.expectedUpdatedAt));
  },
});

const remove = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ expectedUpdatedAt: z.iso.datetime() }),
  handler: async ({ eventId, input, params }) => {
    const route = paramsSchema.parse(params);
    return withTx((tx) => deleteFieldIn(tx, eventIdSchema.parse(eventId), route.formId, route.fieldId, input.expectedUpdatedAt));
  },
});

type Route = { params: Promise<{ formId: string; fieldId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
