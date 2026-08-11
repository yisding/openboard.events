import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, formContextSchema, formIdSchema, taskTargetSchema } from "@/shared/contracts";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { createForm } from "@/features/forms/server/builder-mutations";
import { listForms } from "@/features/forms/server/builder-queries";
import { defineHandler } from "@/shared/server/handler";

const createInput = z.object({
  // Optional for legacy builder callers; onboarding sends a stable id so a
  // committed response can be retried without creating a second draft.
  id: formIdSchema.optional(),
  internalName: z.string().trim().min(1).max(255),
  kind: z.enum(["abstract", "session"]),
  collectParticipants: z.boolean(),
  // M24-GENERALIZE: both optional and both default away exactly as
  // `createFormIn` already does, so the existing CFP "+ Add" caller (which
  // never sends either) is unaffected. M24's portal-form create is the only
  // caller that sends `context: "portal"` + a `targetType`.
  context: formContextSchema.optional(),
  targetType: taskTargetSchema.optional(),
});

// M24-GENERALIZE: `context` is optional and defaults to "cfp", matching
// `listFormsIn`'s own default — the pre-existing CFP forms list page never
// sends it. M24's portal forms list passes `context=portal` to get the
// disjoint set (plan/modules/M24-portal-form-builder.md §3).
const list = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ eventId: eventIdSchema, context: formContextSchema.optional() }),
  handler: async ({ eventId, input }) => listForms(eventIdSchema.parse(eventId), input.context),
});

const create = defineHandler({
  auth: formBuilderAuth(),
  input: createInput,
  handler: async ({ eventId, input }) => createForm(eventIdSchema.parse(eventId), input),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
