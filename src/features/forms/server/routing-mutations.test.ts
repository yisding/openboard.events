import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { createFieldIn, createFormIn, deleteFieldIn, getFormForBuilderIn, updateFieldIn } from "@/features/forms";
import { applyRouting } from "@/shared/lib/conditions";
import { eventIdSchema, type Answers, type Condition, type FormId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import {
  deleteRoutingRuleIn,
  listRoutingRulesIn,
  reorderRoutingRulesIn,
  saveRoutingRuleIn,
  type RoutingRuleInput,
} from "./routing-mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("ad000000-0000-4000-8000-000000000002");

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("routing rules — visibility/routing UI's server half (M13b)", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let formId: FormId;
  let formatFieldId: string;
  let workshopOptionId: string;
  let trackId: string;
  let tagId: string;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Routing Conf','routing-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    const track = await pglite.query<{ id: string }>("INSERT INTO tracks(event_id,name,sort_order) VALUES($1,'AI Infrastructure',0) RETURNING id", [eventId]);
    trackId = required(track.rows[0], "track row").id;
    await pglite.query("INSERT INTO session_formats(event_id,name,sort_order) VALUES($1,'Workshop',0)", [eventId]);
    const tag = await pglite.query<{ id: string }>("INSERT INTO tags(event_id,name) VALUES($1,'Tooling') RETURNING id", [eventId]);
    tagId = required(tag.rows[0], "tag row").id;

    const form = await createFormIn(database, eventId, { internalName: "CFP", kind: "abstract", collectParticipants: true });
    formId = form.id;
    const formatField = required(form.sections.flatMap((section) => section.fields).find((field) => field.key === "format"), "format field");
    formatFieldId = formatField.id;
    workshopOptionId = required(formatField.options.find((option) => option.label === "Workshop"), "Workshop option").id;
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  function condition(overrides: Partial<Condition> = {}): Condition {
    const merged = { sourceFieldId: formatFieldId as Condition["sourceFieldId"], op: "eq", value: workshopOptionId, ...overrides } as Condition;
    if (merged.op === "answered" || merged.op === "empty") return { sourceFieldId: merged.sourceFieldId, op: merged.op };
    return merged;
  }

  function input(overrides: Partial<RoutingRuleInput> = {}): RoutingRuleInput {
    return {
      match: "all",
      conditions: [condition()],
      setTrackId: trackId as RoutingRuleInput["setTrackId"],
      addTagIds: [tagId as RoutingRuleInput["addTagIds"][number]],
      enabled: true,
      ...overrides,
    };
  }

  async function purgeAllRules() {
    const rows = await listRoutingRulesIn(database, eventId, formId);
    for (const rule of rows) await deleteRoutingRuleIn(database, eventId, formId, rule.id);
  }

  it("rejects a condition referencing a field that is not on this form", async () => {
    const bogus = await saveRoutingRuleIn(database, eventId, formId, input({
      conditions: [condition({ sourceFieldId: "00000000-0000-4000-8000-000000000000" as Condition["sourceFieldId"] })],
    })).catch((error: unknown) => error);
    expect(isAppError(bogus) && bogus.code).toBe("VALIDATION");
  });

  it("rejects a condition value that is not a live option on that field", async () => {
    const bogus = await saveRoutingRuleIn(database, eventId, formId, input({
      conditions: [condition({ value: "not-a-real-option-id" })],
    })).catch((error: unknown) => error);
    expect(isAppError(bogus) && bogus.code).toBe("VALIDATION");
  });

  it("rejects a track or tag that does not belong to this event", async () => {
    const badTrack = await saveRoutingRuleIn(database, eventId, formId, input({ setTrackId: "00000000-0000-4000-8000-000000000000" as RoutingRuleInput["setTrackId"] }))
      .catch((error: unknown) => error);
    expect(isAppError(badTrack) && badTrack.code).toBe("VALIDATION");

    const badTag = await saveRoutingRuleIn(database, eventId, formId, input({ addTagIds: ["00000000-0000-4000-8000-000000000000" as RoutingRuleInput["addTagIds"][number]] }))
      .catch((error: unknown) => error);
    expect(isAppError(badTag) && badTag.code).toBe("VALIDATION");
  });

  it("appends new rules at max(sort_order)+1, lists them in order, and renumbers the whole list on reorder", async () => {
    const first = await saveRoutingRuleIn(database, eventId, formId, input());
    expect(first.sortOrder).toBe(0);
    const second = await saveRoutingRuleIn(database, eventId, formId, input({ match: "any" }));
    expect(second.sortOrder).toBe(1);
    const third = await saveRoutingRuleIn(database, eventId, formId, input());
    expect(third.sortOrder).toBe(2);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    expect(rows.map((rule) => rule.id)).toEqual([first.id, second.id, third.id]);
    expect(rows.every((rule) => rule.enabled)).toBe(true);

    const reversed = [third.id, second.id, first.id];
    await reorderRoutingRulesIn(database, eventId, formId, reversed);
    const reordered = await listRoutingRulesIn(database, eventId, formId);
    expect(reordered.map((rule) => rule.id)).toEqual(reversed);
    expect(reordered.map((rule) => rule.sortOrder)).toEqual([0, 1, 2]);

    const badReorder = await reorderRoutingRulesIn(database, eventId, formId, reversed.slice(0, 1)).catch((error: unknown) => error);
    expect(isAppError(badReorder) && badReorder.code).toBe("VALIDATION");

    await purgeAllRules();
  });

  it("soft-disables a rule whose condition field was deleted, with a dangling badge surfaced on read", async () => {
    let form = await getFormForBuilderIn(database, eventId, formId);
    const disposableField = required(form.sections.flatMap((section) => section.fields).find((field) => field.key === "level"), "level field");
    const rule = await saveRoutingRuleIn(database, eventId, formId, input({ conditions: [condition({ sourceFieldId: disposableField.id as Condition["sourceFieldId"], op: "answered" })] }));
    expect(rule.enabled).toBe(true);

    form = await getFormForBuilderIn(database, eventId, formId);
    await deleteFieldIn(database, eventId, formId, disposableField.id, form.updatedAt);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    const reloaded = required(rows.find((candidate) => candidate.id === rule.id), "reloaded rule");
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.danglingConditions).toEqual([{ kind: "field", conditionIndex: 0, fieldId: disposableField.id }]);

    const persisted = await pglite.query<{ enabled: boolean }>("SELECT enabled FROM routing_rules WHERE id=$1", [rule.id]);
    expect(persisted.rows[0]?.enabled).toBe(false);

    await purgeAllRules();
  });

  it("soft-disables a rule whose condition value is a deleted option, while the field itself stays live", async () => {
    // A dedicated dropdown field, kept separate from `formatFieldId`/
    // `workshopOptionId` so later tests in this file that still reference
    // the Workshop option are unaffected by shrinking this field's options.
    let form = await getFormForBuilderIn(database, eventId, formId);
    const abstractSection = required(form.sections[0], "abstract section");
    form = await createFieldIn(database, eventId, formId, { sectionId: abstractSection.id, label: "Audience Level", fieldType: "dropdown" }, form.updatedAt);
    const disposableField = required(form.sections.flatMap((section) => section.fields).find((field) => field.label === "Audience Level"), "audience field");
    const firstOption = required(disposableField.options[0], "first option");
    const secondOption = required(disposableField.options[1], "second option");

    const rule = await saveRoutingRuleIn(database, eventId, formId, input({
      conditions: [condition({ sourceFieldId: disposableField.id as Condition["sourceFieldId"], value: secondOption.id })],
    }));
    expect(rule.enabled).toBe(true);

    // Shrink the field's options down to just the first — the field itself
    // (and the condition's `sourceFieldId`) remains live; only the option
    // the rule points at disappears. This is the catalog AC's literal
    // wording: "deleting a referenced option soft-disables its rule".
    form = await getFormForBuilderIn(database, eventId, formId);
    await updateFieldIn(database, eventId, formId, disposableField.id, { optionLabels: [firstOption.label] }, form.updatedAt);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    const reloaded = required(rows.find((candidate) => candidate.id === rule.id), "reloaded rule");
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.danglingConditions).toEqual([{ kind: "option", conditionIndex: 0, fieldId: disposableField.id, value: secondOption.id }]);

    const persisted = await pglite.query<{ enabled: boolean }>("SELECT enabled FROM routing_rules WHERE id=$1", [rule.id]);
    expect(persisted.rows[0]?.enabled).toBe(false);

    await purgeAllRules();
  });

  it("soft-disables a rule whose tag was deleted (no FK cleanup for array elements)", async () => {
    const disposableTag = await pglite.query<{ id: string }>("INSERT INTO tags(event_id,name) VALUES($1,'Disposable') RETURNING id", [eventId]);
    const disposableTagId = required(disposableTag.rows[0], "disposable tag").id;
    const rule = await saveRoutingRuleIn(database, eventId, formId, input({ addTagIds: [disposableTagId as RoutingRuleInput["addTagIds"][number]] }));
    expect(rule.enabled).toBe(true);

    await pglite.query("DELETE FROM tags WHERE id=$1", [disposableTagId]);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    const reloaded = required(rows.find((candidate) => candidate.id === rule.id), "reloaded rule");
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.danglingTagIds).toEqual([disposableTagId]);

    await purgeAllRules();
  });

  it("deleting a track a rule targets clears setTrackId (FK SET NULL) so applyRouting stamps nothing", async () => {
    const disposableTrack = await pglite.query<{ id: string }>("INSERT INTO tracks(event_id,name,sort_order) VALUES($1,'Disposable Track',9) RETURNING id", [eventId]);
    const disposableTrackId = required(disposableTrack.rows[0], "disposable track").id;
    const rule = await saveRoutingRuleIn(database, eventId, formId, input({ setTrackId: disposableTrackId as RoutingRuleInput["setTrackId"], addTagIds: [] }));

    await pglite.query("DELETE FROM tracks WHERE id=$1", [disposableTrackId]);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    const reloaded = required(rows.find((candidate) => candidate.id === rule.id), "reloaded rule");
    expect(reloaded.setTrackId).toBeUndefined();

    const answers: Answers = { [formatFieldId as Condition["sourceFieldId"]]: { t: "opt", v: workshopOptionId } };
    const result = applyRouting([reloaded], answers);
    expect(result.trackId).toBeNull();

    await purgeAllRules();
  });

  it("feeds the frozen M13a evaluator end to end: first match wins, stamping the seeded track and tag", async () => {
    const catchAll = await saveRoutingRuleIn(database, eventId, formId, input({ conditions: [condition({ op: "answered" })], setTrackId: null, addTagIds: [] }));
    const specific = await saveRoutingRuleIn(database, eventId, formId, input());
    await reorderRoutingRulesIn(database, eventId, formId, [specific.id, catchAll.id]);

    const rows = await listRoutingRulesIn(database, eventId, formId);
    const answers: Answers = { [formatFieldId as Condition["sourceFieldId"]]: { t: "opt", v: workshopOptionId } };
    const result = applyRouting(rows, answers);
    expect(result.trackId).toBe(trackId);
    expect(result.tagIds).toEqual([tagId]);
    expect(result.matchedRuleId).toBe(specific.id);

    await purgeAllRules();
  });

  it("routing edits are allowed even once the form has non-draft submissions (routing is not structure)", async () => {
    await pglite.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,title) VALUES($1,$2,1,101,'pending','Locked-form probe')", [eventId, formId]);
    const form = await getFormForBuilderIn(database, eventId, formId);
    expect(form.hasNonDraftSubmissions).toBe(true);
    const rule = await saveRoutingRuleIn(database, eventId, formId, input());
    expect(rule.enabled).toBe(true);
    await purgeAllRules();
  });

  it("404s deleting a routing rule that does not exist", async () => {
    const missing = await deleteRoutingRuleIn(database, eventId, formId, "00000000-0000-4000-8000-000000000000").catch((error: unknown) => error);
    expect(isAppError(missing) && missing.code).toBe("NOT_FOUND");
  });
});
