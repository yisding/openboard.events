import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  eventIdSchema,
  formIdSchema,
  formStatusSchema,
  participantRoleSchema,
  submissionKindSchema,
} from "@/shared/contracts";
import { deleteFormIn, updateFormWithAvailabilityReplayIn } from "@/features/forms/server/builder-mutations";
import { getFormForBuilder } from "@/features/forms/server/builder-queries";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { assertValidConfirmationTemplate, assertValidSubmissionLimit } from "@/features/forms/server/settings-mutations";
import { tryRecordEventOnboardingMilestoneIn } from "@/features/product-signals";
import { db, withTx } from "@/db/client";
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
  // Pinned to `context='cfp'`: this route has no portal caller (the portal
  // builder's page.tsx loads its form via a direct `getFormForBuilder(...,
  // "portal")` server-component call, never this GET), so a portal form id
  // must 404 here rather than load into the CFP-only builder response shape.
  handler: async ({ eventId, params }) => getFormForBuilder(eventIdSchema.parse(eventId), routeInput.parse(params).formId, "cfp"),
});

// Unlike GET above, PATCH is deliberately left context-generic: the portal
// form builder (src/features/portal/form-builder/components/portal-form-
// builder.tsx) saves through this same route, so pinning it to "cfp" would
// 404 every portal-form save. The client already knows the form id it is
// editing — there is no context-confusion path here, only the (harmless,
// same-organizer, same-event) ability to PATCH a form of either context by
// id, which `updateFormIn`'s own event scoping still bounds.
const update = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({
    expectedUpdatedAt: z.iso.datetime(),
    patch: patchSchema,
    availabilityReplay: z.boolean().optional(),
  }),
  // M14: the Settings/Notifications steps' own validation (submission-limit
  // range, confirmation-template variables — R2 boundary #6, checked at save
  // time) runs here too, since every builder step's save reaches the
  // database through this one generic route.
  handler: async ({ eventId, input, params }) => {
    const parsedEventId = eventIdSchema.parse(eventId);
    const formId = routeInput.parse(params).formId;
    assertValidSubmissionLimit(input.patch.submissionLimit);
    await assertValidConfirmationTemplate(db, parsedEventId, formId, input.patch);
    const updated = await withTx((tx) => updateFormWithAvailabilityReplayIn(
      tx,
      parsedEventId,
      formId,
      input.patch,
      input.expectedUpdatedAt,
      input.availabilityReplay === true,
    ));
    // Product telemetry is intentionally outside the authoring transaction.
    // Catching a failed SQL statement inside a PostgreSQL transaction cannot
    // make that transaction committable again, even when the JS helper catches
    // the error. The idempotent signal runs only after authoring has committed.
    if (input.patch.status === "open") {
      await tryRecordEventOnboardingMilestoneIn(db, parsedEventId, "form_published");
    }
    return updated;
  },
});

// M24 §7: generic delete, RESTRICT-guarded by `deleteFormIn` itself (a form
// referenced by a task surfaces the same CONFLICT copy M23's file-request
// delete shows, not a raw FK 500). Also context-generic like PATCH above —
// the portal forms list (portal-forms-page.tsx) deletes through this same
// route, so this stays unpinned on purpose.
const remove = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    await deleteFormIn(db, eventIdSchema.parse(eventId), routeInput.parse(params).formId);
    return { deleted: true };
  },
});

type Route = { params: Promise<{ formId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
