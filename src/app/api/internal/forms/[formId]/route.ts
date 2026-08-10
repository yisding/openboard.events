import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  eventIdSchema,
  formIdSchema,
  formStatusSchema,
  participantRoleSchema,
  submissionKindSchema,
} from "@/shared/contracts";
import { updateFormIn } from "@/features/forms/server/builder-mutations";
import { getFormForBuilder } from "@/features/forms/server/builder-queries";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { db } from "@/db/client";
import { defineHandler } from "@/shared/server/handler";

const routeInput = z.object({ formId: formIdSchema });
const nullableIso = z.union([z.iso.datetime(), z.null()]);
const patchSchema = z.object({
  internalName: z.string().trim().min(1).max(255).optional(),
  externalTitle: z.string().trim().min(1).max(255).optional(),
  pageHeading: z.string().trim().min(1).max(15).optional(),
  status: formStatusSchema.optional(),
  kind: submissionKindSchema.optional(),
  collectParticipants: z.boolean().optional(),
  opensAt: nullableIso.optional(),
  closesAt: nullableIso.optional(),
  submissionLimit: z.int().positive().max(100_000).nullable().optional(),
  showWelcome: z.boolean().optional(),
  welcomeHtml: z.string().max(100_000).optional(),
  successHtml: z.string().max(100_000).optional(),
  autoRedirectToPortal: z.boolean().optional(),
  participantRoles: z.array(z.object({ role: participantRoleSchema, enabled: z.boolean() })).min(1).max(4).optional(),
  sendConfirmation: z.boolean().optional(),
  confirmationSubject: z.string().max(255).optional(),
  confirmationBodyHtml: z.string().max(100_000).optional(),
}).refine((patch) => Object.keys(patch).length > 0, "Patch must change at least one field");

const get = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => getFormForBuilder(eventIdSchema.parse(eventId), routeInput.parse(params).formId),
});

const update = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ expectedUpdatedAt: z.iso.datetime(), patch: patchSchema }),
  handler: async ({ eventId, input, params }) => updateFormIn(db, eventIdSchema.parse(eventId), routeInput.parse(params).formId, input.patch, input.expectedUpdatedAt),
});

type Route = { params: Promise<{ formId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}
