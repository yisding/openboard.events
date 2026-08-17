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

/**
 * Refuse an option edit that would orphan another question's visibility rule.
 *
 * `compileFormSnapshot` validates only that a condition's `sourceFieldId` names
 * an *earlier* field; nothing checks the condition's `value` against that
 * field's option ids, and nothing recomputed other fields' rules when options
 * changed. Delete the Workshop option from a Format question and the rule
 * "show *Workshop length* when Format is Workshop" keeps its now-vanished id:
 * `eq` stops matching for everyone, so the dependent question is unreachable on
 * the public form forever — or, with `is not`, shows unconditionally. The save
 * succeeded, and nothing warned.
 *
 * The routing-rules side already solved this shape — `findDanglingConditions`
 * checks `kind: "option"`, invalidated rules are soft-disabled and badged. A
 * visibility rule has no `enabled` flag to fall back to, so this refuses the
 * edit and names the dependent question instead of silently rewriting form
 * logic underneath the organizer.
 *
 * Only *newly* orphaned conditions count, because a removed option is all this
 * guard can compare against. A rule that was already dangling belongs to
 * `compileFormSnapshot`, which refuses to publish one from any writer;
 * drizzle/0054 repaired the forms that were carrying them when that check
 * arrived.
 */
export function assertNoNewlyOrphanedVisibility(
  fields: readonly BuilderField[],
  fieldId: string,
  previousOptions: readonly { id: string }[],
  nextOptions: readonly { id: string }[],
): void {
  const removed = new Set(previousOptions.map((option) => option.id));
  for (const option of nextOptions) removed.delete(option.id);
  if (removed.size === 0) return;

  for (const candidate of fields) {
    if (candidate.id === fieldId) continue;
    const conditions = candidate.visibility?.conditions ?? [];
    for (const condition of conditions) {
      if (condition.sourceFieldId !== fieldId) continue;
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (values.some((value) => typeof value === "string" && removed.has(value))) {
        throw new AppError(
          "VALIDATION",
          `“${candidate.label}” is only shown for an option you are removing. Update that question's visibility rule first.`,
          { fieldId: candidate.id },
        );
      }
    }
  }
}

/**
 * Refuse a visibility rule whose value does not name a live option of its
 * source field.
 *
 * The builder mints `draft-N` placeholder ids for option lines that have no
 * saved id to claim yet, and `FieldInspector` builds its "earlier fields" list
 * from live builder state — so the condition editor offered those placeholders
 * and stored one as `condition.value`. Add a "Workshop" line to a Format
 * dropdown, click straight over to another question and set "Show when Format is
 * Workshop", save that question, then save Format: the server mints a real UUID
 * for the option while the rule still says `draft-2`. `conditionSchema.value` is
 * a plain string and `compileFormSnapshot` validates only condition *ordering*,
 * so nothing refused it. The dependent question then never appears on the public
 * form — or, with `is not`, always does — and after a reload the rule summary
 * reads "Shown when Format is draft-2" with a blank value select.
 *
 * Checked on the patch that supplies the rule, which is the only moment both
 * questions can be named in the message. The invariant itself belongs to
 * `compileFormSnapshot`, which re-derives it on every publish from every
 * writer; this guard exists so the organizer who just made the mistake reads a
 * sentence instead of a field id.
 */
export function assertVisibilityValuesResolve(
  fields: readonly BuilderField[],
  field: Pick<BuilderField, "id" | "label" | "visibility">,
): void {
  const conditions = field.visibility?.conditions ?? [];
  if (conditions.length === 0) return;
  const byId = new Map(fields.map((candidate) => [candidate.id, candidate]));

  for (const condition of conditions) {
    const source = byId.get(condition.sourceFieldId);
    // A missing source field is `compileFormSnapshot`'s to reject, not this
    // guard's — it already refuses a forward or dangling reference.
    if (!source) continue;
    if (source.fieldType !== "dropdown" && source.fieldType !== "multiselect") continue;
    if (condition.value === undefined) continue;
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    const live = new Set(source.options.map((option) => option.id));
    for (const value of values) {
      if (typeof value === "string" && !live.has(value)) {
        throw new AppError(
          "VALIDATION",
          `“${field.label}” is shown for an option of “${source.label}” that no longer exists. Save that question first, then set this rule.`,
          { fieldId: field.id },
        );
      }
    }
  }
}
