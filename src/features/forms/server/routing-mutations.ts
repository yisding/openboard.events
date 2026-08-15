import { and, asc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { routingRules } from "@/db/schema";
import { listTagsIn, listTracksIn } from "@/features/events";
import {
  conditionSchema,
  routingRuleSchema,
  type Condition,
  type EventId,
  type FormId,
  type RoutingRule,
  type TagId,
  type TrackId,
  type TrackDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { z } from "zod";
import type { BuilderField } from "../builder-types";
import { getFormForBuilderIn } from "./builder-queries";

/**
 * Routing rules are read live at submit time (`getActiveRoutingRulesIn` in
 * `./snapshots.ts`, M13a/M16's territory — not duplicated here) and authored
 * here, on demand, by the organizer. Rules are deliberately NOT part of the
 * compiled `FormSnapshot`: freezing them for an in-flight draft would mean a
 * speaker's routing outcome depends on when they started typing, which is not
 * the designed behavior (see the module's "Snapshot discipline" guardrail).
 */

export type RoutingRuleInput = {
  id?: string;
  match: "all" | "any";
  conditions: Condition[];
  setTrackId: TrackId | null;
  addTagIds: TagId[];
  enabled: boolean;
};

export type RoutingRuleIssue =
  | { kind: "field"; conditionIndex: number; fieldId: string }
  | { kind: "option"; conditionIndex: number; fieldId: string; value: string };

/**
 * The admin-facing read model: every rule (enabled or not), plus enough
 * dangling-reference detail for the panel to render Trap #4's badge and
 * "Fix rule" affordance. `getActiveRoutingRulesIn` remains the only reader
 * the submit pipeline uses — this is a second, admin-only view over the same
 * table, not a second submit-time evaluator.
 */
export type RoutingRuleRow = RoutingRule & {
  danglingConditions: RoutingRuleIssue[];
  danglingTagIds: TagId[];
  trackMissing: boolean;
};

type LiveFieldInfo = { id: string; label: string; fieldType: BuilderField["fieldType"]; optionIds: Set<string> };

/**
 * The only fields a routing rule may be sourced from.
 *
 * Routing runs at submit time against the abstract answers alone
 * (`submit.ts`'s `applyRouting` call), so a rule sourced from the participant
 * section can never be evaluated — and an unevaluable source is not inert:
 * `neq`/`not_in`/`empty` all read an absent answer as satisfied, and matching
 * is first-match-wins, so such a rule claims every submission and shadows the
 * rules below it.
 */
function routableFields(form: { sections: { key: string; fields: BuilderField[] }[] }): BuilderField[] {
  return form.sections.filter((section) => section.key !== "participant").flatMap((section) => section.fields);
}

function liveFieldIndex(fields: BuilderField[]): Map<string, LiveFieldInfo> {
  const map = new Map<string, LiveFieldInfo>();
  for (const field of fields) {
    map.set(field.id, { id: field.id, label: field.label, fieldType: field.fieldType, optionIds: new Set(field.options.map((option) => option.id)) });
  }
  return map;
}

function findDanglingConditions(conditions: readonly Condition[], fields: Map<string, LiveFieldInfo>): RoutingRuleIssue[] {
  const issues: RoutingRuleIssue[] = [];
  conditions.forEach((condition, conditionIndex) => {
    const field = fields.get(condition.sourceFieldId);
    if (!field) {
      issues.push({ kind: "field", conditionIndex, fieldId: condition.sourceFieldId });
      return;
    }
    if ((field.fieldType !== "dropdown" && field.fieldType !== "multiselect") || condition.value === undefined) return;
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    for (const value of values) {
      if (!field.optionIds.has(value)) issues.push({ kind: "option", conditionIndex, fieldId: condition.sourceFieldId, value });
    }
  });
  return issues;
}

function findDanglingTags(addTagIds: readonly string[], liveTagIds: Set<string>): string[] {
  return addTagIds.filter((id) => !liveTagIds.has(id));
}

function toRoutingRuleRow(
  row: typeof routingRules.$inferSelect,
  fields: Map<string, LiveFieldInfo>,
  liveTagIds: Set<string>,
  liveTrackIds: Set<string>,
): RoutingRuleRow {
  const conditions = z.array(conditionSchema).parse(row.conditions);
  const base = routingRuleSchema.parse({
    id: row.id,
    sortOrder: row.sortOrder,
    match: row.match,
    conditions,
    ...(row.setTrackId ? { setTrackId: row.setTrackId } : {}),
    addTagIds: row.addTagIds,
    enabled: row.enabled,
  });
  return {
    ...base,
    danglingConditions: findDanglingConditions(conditions, fields),
    danglingTagIds: findDanglingTags(row.addTagIds, liveTagIds).map((id) => id as TagId),
    // Defensive only: `set_track_id` carries `ON DELETE SET NULL`, so a live
    // row can never point at a deleted track. Kept for symmetry with the tag
    // check, which the schema does NOT enforce (array elements have no FK).
    trackMissing: row.setTrackId !== null && !liveTrackIds.has(row.setTrackId),
  };
}

function assertConditionsValid(conditions: readonly Condition[], fields: Map<string, LiveFieldInfo>): void {
  if (conditions.length < 1 || conditions.length > 5) throw new AppError("VALIDATION", "A rule needs between 1 and 5 conditions", { field: "conditions" });
  const issues = findDanglingConditions(conditions, fields);
  const [first] = issues;
  if (!first) return;
  const message = first.kind === "field"
    ? `Condition ${first.conditionIndex + 1} references a question that is not on this form.`
    : `Condition ${first.conditionIndex + 1} references an option that no longer exists.`;
  throw new AppError("VALIDATION", message, { field: `conditions.${first.conditionIndex}` });
}

/**
 * Every rule on the form, in sort order, with dangling references detected
 * against the form's *current* live fields/options and the event's current
 * tracks/tags. A previously-valid rule that a field/option/tag deletion made
 * dangling is soft-disabled right here — "auto-set enabled=false on the next
 * save" (Trap #4) — in the same statement that surfaces the badge, so the
 * organizer never has to separately re-save a rule just to stop it firing on
 * a reference that no longer exists. The `conditions` JSON is never touched:
 * nothing about *what the rule matched on* is silently dropped.
 *
 * `add_tag_ids` is the one exception, and it is forced by the schema, not a
 * design choice: `routing_rules_tag_scope_guard` (drizzle/0001) re-validates
 * the WHOLE array on every UPDATE, including one that never touches that
 * column — so a row already carrying a deleted tag id cannot be written at
 * all, not even to flip `enabled`, until the stale id is gone. Disabling
 * therefore also drops just the deleted tag ids from that row (never a live
 * one), which is what makes the row persistable again; the tag(s) that
 * triggered it are still reported back once, in `danglingTagIds`, for the
 * badge.
 */
export async function listRoutingRulesIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<RoutingRuleRow[]> {
  const [form, rows, trackRows, tagRows] = await Promise.all([
    getFormForBuilderIn(dbOrTx, eventId, formId),
    dbOrTx.select().from(routingRules)
      .where(and(eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)))
      .orderBy(asc(routingRules.sortOrder), asc(routingRules.id)),
    listTracksIn(dbOrTx, eventId),
    listTagsIn(dbOrTx, eventId),
  ]);
  const fields = liveFieldIndex(routableFields(form));
  const liveTagIds = new Set<string>(tagRows.map((tag) => tag.id));
  const liveTrackIds = new Set<string>(trackRows.map((track) => track.id));
  const mapped = rows.map((row) => toRoutingRuleRow(row, fields, liveTagIds, liveTrackIds));

  const toDisable = mapped.filter((rule) => rule.enabled && (rule.danglingConditions.length > 0 || rule.danglingTagIds.length > 0 || rule.trackMissing));
  if (toDisable.length === 0) return mapped;

  const now = new Date();
  const cleanedTagIdsById = new Map<string, RoutingRule["addTagIds"]>();
  for (const rule of toDisable) {
    const cleanedTagIds = rule.danglingTagIds.length > 0
      ? rule.addTagIds.filter((tagId) => !(rule.danglingTagIds as readonly string[]).includes(tagId))
      : rule.addTagIds;
    cleanedTagIdsById.set(rule.id, cleanedTagIds);
    await dbOrTx.update(routingRules)
      .set({ enabled: false, addTagIds: cleanedTagIds, updatedAt: now })
      .where(and(eq(routingRules.id, rule.id), eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)));
  }
  return mapped.map((rule) => cleanedTagIdsById.has(rule.id)
    ? { ...rule, enabled: false, addTagIds: cleanedTagIdsById.get(rule.id) ?? rule.addTagIds }
    : rule);
}

export function listRoutingRules(eventId: EventId, formId: FormId): Promise<RoutingRuleRow[]> {
  return listRoutingRulesIn(db, eventId, formId);
}

/**
 * Create (no `input.id`) or full-replace update (`input.id` set). Validates
 * every reference the *organizer just submitted* — a fresh mistake is a
 * VALIDATION error, not a soft-disable; soft-disable is reserved for a rule
 * that used to be valid and was invalidated by someone else's later delete
 * (see `listRoutingRulesIn`). New rules append at `max(sort_order)+1`.
 */
export async function saveRoutingRuleIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, input: RoutingRuleInput): Promise<RoutingRuleRow> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const liveFields = routableFields(form);
  const fields = liveFieldIndex(liveFields);
  assertConditionsValid(input.conditions, fields);

  const [trackRows, tagRows]: [TrackDTO[], Awaited<ReturnType<typeof listTagsIn>>] = await Promise.all([
    listTracksIn(dbOrTx, eventId),
    listTagsIn(dbOrTx, eventId),
  ]);
  if (input.setTrackId !== null && !trackRows.some((track) => track.id === input.setTrackId)) {
    throw new AppError("VALIDATION", "That track does not belong to this event.", { field: "setTrackId" });
  }
  const liveTagIds = new Set<string>(tagRows.map((tag) => tag.id));
  const unknownTag = input.addTagIds.find((tagId) => !liveTagIds.has(tagId));
  if (unknownTag) throw new AppError("VALIDATION", "That tag does not belong to this event.", { field: "addTagIds" });
  const liveTrackIds = new Set<string>(trackRows.map((track) => track.id));

  const now = new Date();
  const values = {
    match: input.match,
    conditions: input.conditions,
    setTrackId: input.setTrackId,
    addTagIds: input.addTagIds,
    enabled: input.enabled,
    updatedAt: now,
  };

  if (input.id) {
    const [updated] = await dbOrTx.update(routingRules).set(values)
      .where(and(eq(routingRules.id, input.id), eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND", "Routing rule not found");
    return toRoutingRuleRow(updated, fields, liveTagIds, liveTrackIds);
  }

  const [nextSortOrderRow] = await dbOrTx.select({ nextSortOrder: sql<number>`coalesce(max(${routingRules.sortOrder}) + 1, 0)` })
    .from(routingRules)
    .where(and(eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)));
  const [created] = await dbOrTx.insert(routingRules).values({
    eventId,
    formId,
    sortOrder: nextSortOrderRow?.nextSortOrder ?? 0,
    ...values,
    createdAt: now,
  }).returning();
  if (!created) throw new AppError("INTERNAL", "Routing rule was not created");
  return toRoutingRuleRow(created, fields, liveTagIds, liveTrackIds);
}

export function saveRoutingRule(eventId: EventId, formId: FormId, input: RoutingRuleInput): Promise<RoutingRuleRow> {
  return saveRoutingRuleIn(db, eventId, formId, input);
}

export async function deleteRoutingRuleIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, ruleId: string): Promise<void> {
  const deleted = await dbOrTx.delete(routingRules)
    .where(and(eq(routingRules.id, ruleId), eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)))
    .returning();
  if (deleted.length === 0) throw new AppError("NOT_FOUND", "Routing rule not found");
}

export function deleteRoutingRule(eventId: EventId, formId: FormId, ruleId: string): Promise<void> {
  return deleteRoutingRuleIn(db, eventId, formId, ruleId);
}

/** Whole-list renumber, one statement — the same pattern as M12's field reorder. */
export async function reorderRoutingRulesIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, orderedIds: string[]): Promise<void> {
  const existing = await dbOrTx.select({ id: routingRules.id }).from(routingRules)
    .where(and(eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)));
  const expected = new Set(existing.map((row) => row.id));
  if (orderedIds.length !== expected.size || new Set(orderedIds).size !== expected.size || orderedIds.some((id) => !expected.has(id))) {
    throw new AppError("VALIDATION", "Reorder must contain every routing rule on this form exactly once");
  }
  if (orderedIds.length === 0) return;
  const now = new Date();
  const values = orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`);
  await dbOrTx.execute(sql`
    UPDATE routing_rules AS rule
    SET sort_order = ordered.sort_order, updated_at = ${now}
    FROM (VALUES ${sql.join(values, sql`, `)}) AS ordered(id, sort_order)
    WHERE rule.id = ordered.id AND rule.event_id = ${eventId} AND rule.form_id = ${formId}
  `);
}

export function reorderRoutingRules(eventId: EventId, formId: FormId, orderedIds: string[]): Promise<void> {
  return reorderRoutingRulesIn(db, eventId, formId, orderedIds);
}
