import type { BuilderField, FieldPatch } from "../builder-types";
import { eventIdSchema, type MapsToTarget, type TaskTarget } from "@/shared/contracts";
import type { HandlerGuard } from "@/shared/server/handler";
import { AppError } from "@/shared/lib/errors";
import { requireAdmin } from "@/features/auth/index.server";

const LOCKED_MESSAGE = "Locked identity fields must remain required and keep their key, type, and mapping.";
export const STRUCTURAL_LOCK_MESSAGE = "This form has submissions. Duplicate it to change its structure.";

export const formBuilderAuth = (): HandlerGuard => async (request) => {
  const eventId = eventIdSchema.parse(request.nextUrl.searchParams.get("eventId"));
  const session = await requireAdmin(eventId, "organizer");
  return { actorId: session.userId, role: session.role, eventId };
};

export function assertNotLockedField(field: BuilderField, change: FieldPatch | { delete: true }): void {
  if (!field.locked) return;
  if ("delete" in change) throw new AppError("VALIDATION", LOCKED_MESSAGE, { fieldId: field.id });
  const invalid = change.required === false
    || (change.key !== undefined && change.key !== field.key)
    || (change.fieldType !== undefined && change.fieldType !== field.fieldType)
    || (change.mapsTo !== undefined && change.mapsTo !== field.mapsTo);
  if (invalid) throw new AppError("VALIDATION", LOCKED_MESSAGE, { fieldId: field.id });
}

export function fieldPatchIsStructural(field: BuilderField, patch: FieldPatch): boolean {
  return (patch.key !== undefined && patch.key !== field.key)
    || (patch.fieldType !== undefined && patch.fieldType !== field.fieldType)
    || (patch.required !== undefined && patch.required !== field.required)
    || (patch.mapsTo !== undefined && patch.mapsTo !== field.mapsTo)
    || patch.optionLabels !== undefined
    || patch.visibility !== undefined;
}

export function assertStructuralAllowed(hasNonDraftSubmissions: boolean, structural: boolean): void {
  if (hasNonDraftSubmissions && structural) throw new AppError("FORM_LOCKED", STRUCTURAL_LOCK_MESSAGE);
}

export function assertUniqueFieldKey(fields: BuilderField[], fieldId: string | null, key: string): void {
  if (fields.some((field) => field.id !== fieldId && field.key === key)) {
    throw new AppError("VALIDATION", `Another live field already uses the key “${key}”.`, { key });
  }
}

export function assertUniqueMapsTo(fields: BuilderField[], fieldId: string, mapsTo: string | null): void {
  if (mapsTo && fields.some((field) => field.id !== fieldId && field.mapsTo === mapsTo)) {
    throw new AppError("VALIDATION", `Another live field already maps to ${mapsTo}.`, { mapsTo });
  }
}

// data-model.md §3.4 / M24 §5's 8-triple library: a portal form's `target_type`
// ("contact" or "submission") must agree with the record a mapped field writes
// back to on task completion (`deriveMappedFields` in
// features/forms/server/pipeline.ts branches on the `mapsTo` prefix, and only
// the submission branch is gated by `submissionId` — the contact branch is
// unconditional). Without this check, a direct API call could set
// `mapsTo='contact.email'` on a `target_type='submission'` portal form field,
// and every future response to that field would silently overwrite the
// responding contact's real profile data on task completion. `mapsTo` values
// are always `"<target>.<column>"` (see `MAPS_TO_TARGETS`), so the prefix is
// the target. CFP forms have `targetType === null` and are intentionally
// exempt — a CFP form legitimately maps both `contact.*` and `submission.*`
// fields on the same form (see `cfpAuthoringRows` in builder-mutations.ts).
export function assertMapsToMatchesTarget(targetType: TaskTarget | null, mapsTo: MapsToTarget | null): void {
  if (targetType === null || mapsTo === null) return;
  const prefix = mapsTo.slice(0, mapsTo.indexOf("."));
  if (prefix !== targetType) {
    throw new AppError("VALIDATION", `“${mapsTo}” cannot be used on a ${targetType} form.`, { mapsTo, targetType });
  }
}
