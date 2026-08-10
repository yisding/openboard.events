import { z } from "zod";
import type { NextRequest } from "next/server";
import { COMMITTED_FIELD_TYPES, eventIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
import { createFieldIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const paramsSchema = z.object({ formId: formIdSchema });

const create = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({
    expectedUpdatedAt: z.iso.datetime(),
    sectionId: sectionIdSchema,
    label: z.string().trim().min(1).max(255),
    fieldType: z.enum(COMMITTED_FIELD_TYPES),
  }),
  handler: async ({ eventId, input, params }) => createFieldIn(db, eventIdSchema.parse(eventId), paramsSchema.parse(params).formId, input, input.expectedUpdatedAt),
});

export function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return create(request, route);
}
