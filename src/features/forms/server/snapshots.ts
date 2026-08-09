import { and, asc, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { formVersions, forms, routingRules } from "@/db/schema";
import {
  formSnapshotSchema,
  routingRuleSchema,
  type EventId,
  type FormId,
  type FormSnapshot,
  type RoutingRule,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * Read access to published form snapshots — M12's Step 1 contract slice, which
 * is what the whole public runtime reads through.
 *
 * `form_versions` rows are immutable by construction: the builder compiles a new
 * one on every save rather than editing the last. That is what makes a pinned
 * snapshot meaningful — the version a speaker rendered still describes the form
 * they saw, however many times an organizer has edited it since.
 *
 * Every lookup is scoped by `(eventId, formId)` together. The `form_id` foreign
 * key proves a form exists, not whose it is.
 */
function parseSnapshot(value: unknown, formId: FormId, version: number): FormSnapshot {
  const parsed = formSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    // A stored snapshot that no longer parses is a schema-drift bug, not a user
    // error: fail loudly rather than rendering half a form.
    throw new AppError("INTERNAL", `Form ${formId} version ${version} did not parse as a snapshot`);
  }
  return parsed.data;
}

/**
 * The exact snapshot a client rendered. Null when that version does not exist,
 * which the caller turns into `FORM_VERSION_STALE` rather than guessing.
 */
export async function getPinnedSnapshotIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  formId: FormId,
  version: number,
): Promise<FormSnapshot | null> {
  const [row] = await dbOrTx
    .select({ snapshot: formVersions.snapshot })
    .from(formVersions)
    .where(and(eq(formVersions.eventId, eventId), eq(formVersions.formId, formId), eq(formVersions.version, version)))
    .limit(1);
  return row ? parseSnapshot(row.snapshot, formId, version) : null;
}

/**
 * The newest published snapshot. Throws rather than returning null: a form with
 * no published version cannot be rendered or submitted at all, and every caller
 * would otherwise invent the same error.
 */
export async function getCurrentSnapshotIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<FormSnapshot> {
  const [form] = await dbOrTx
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
    .limit(1);
  if (!form) throw new AppError("NOT_FOUND", "Form not found");

  const [row] = await dbOrTx
    .select({ snapshot: formVersions.snapshot, version: formVersions.version })
    .from(formVersions)
    .where(and(eq(formVersions.eventId, eventId), eq(formVersions.formId, formId)))
    .orderBy(desc(formVersions.version))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "This form has not been published yet");
  return parseSnapshot(row.snapshot, formId, row.version);
}

/**
 * Routing rules in the order the evaluator expects — enabled ones only, sorted
 * so the first match wins deterministically. Disabled rules are filtered here so
 * no caller has to remember to.
 */
export async function getActiveRoutingRulesIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<RoutingRule[]> {
  const rows = await dbOrTx
    .select({
      id: routingRules.id,
      sortOrder: routingRules.sortOrder,
      match: routingRules.match,
      conditions: routingRules.conditions,
      setTrackId: routingRules.setTrackId,
      addTagIds: routingRules.addTagIds,
      enabled: routingRules.enabled,
    })
    .from(routingRules)
    .where(and(eq(routingRules.eventId, eventId), eq(routingRules.formId, formId), eq(routingRules.enabled, true)))
    .orderBy(asc(routingRules.sortOrder), asc(routingRules.id));

  return rows.map((row) => routingRuleSchema.parse({
    id: row.id,
    sortOrder: row.sortOrder,
    match: row.match,
    conditions: row.conditions,
    ...(row.setTrackId ? { setTrackId: row.setTrackId } : {}),
    addTagIds: row.addTagIds,
    enabled: row.enabled,
  }));
}

export function getPinnedSnapshot(eventId: EventId, formId: FormId, version: number): Promise<FormSnapshot | null> {
  return getPinnedSnapshotIn(db, eventId, formId, version);
}

export function getCurrentSnapshot(eventId: EventId, formId: FormId): Promise<FormSnapshot> {
  return getCurrentSnapshotIn(db, eventId, formId);
}

export function getActiveRoutingRules(eventId: EventId, formId: FormId): Promise<RoutingRule[]> {
  return getActiveRoutingRulesIn(db, eventId, formId);
}
