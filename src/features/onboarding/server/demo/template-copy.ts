import { and, asc, eq, inArray, isNull, not, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, withTx, type DbOrTx } from "@/db/client";
import { eventMembers, events, forms, formFields, formSections, rooms, sessionFormats, tags, tracks } from "@/db/schema";
import { compileAndPublishIn, createFormIn } from "@/features/forms";
import { recordOrganizationAuditEventIn } from "@/features/organizations";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
import { AppError } from "@/shared/lib/errors";
import {
  fieldIdSchema,
  formIdSchema,
  formOptionSchema,
  mapsToTargetSchema,
  reviewVisibilitySchema,
  visibilityRuleSchema,
  type Condition,
  type EventId,
  type FieldId,
  type FieldType,
  type FormatId,
  type OrganizationId,
  type TagId,
  type TrackId,
  type UserId,
  type VisibilityRule,
} from "@/shared/contracts";
import { stableUuid } from "@/shared/server/stable-uuid";
import { demoEventId } from "./ids";
import { demoFormId, type DemoTransaction } from "./phases/context";

/**
 * "Start from my demo's setup" (design §5.4) — the payoff for the tour's
 * whole argument that the organizer already built something. Deliberately the
 * smallest slice that earns that line: vocabulary names/colours/durations, and
 * the one form's structure a chapter of the tour was actually spent on. A
 * future contributor cannot widen this by accident — `template-copy.test.ts`
 * pins the constant to exactly this list, and asserts a full run inserts zero
 * rows into `contacts` / `submissions` / `sessions` / `portal_tasks` /
 * `communication_logs`. This is a scaffold copy, never a contact importer.
 */
export const DEMO_SCAFFOLD_TABLES = ["tracks", "rooms", "session_formats", "tags", "forms"] as const;
export type DemoScaffoldTable = (typeof DEMO_SCAFFOLD_TABLES)[number];

type VocabRow = { id: string; name: string };
type FormOption = z.infer<typeof formOptionSchema>;

/** Old (demo-event) vocabulary id → new (real-event) vocabulary id, by name. */
type VocabRemap = {
  tracks: ReadonlyMap<string, TrackId>;
  formats: ReadonlyMap<string, FormatId>;
  tags: ReadonlyMap<string, TagId>;
};

function remapById<Id extends string>(oldRows: readonly VocabRow[], newRows: readonly VocabRow[]): ReadonlyMap<string, Id> {
  const newIdByName = new Map(newRows.map((row) => [row.name, row.id as Id]));
  const remap = new Map<string, Id>();
  for (const old of oldRows) {
    const newId = newIdByName.get(old.name);
    if (newId) remap.set(old.id, newId);
  }
  return remap;
}

/**
 * Tracks, rooms, formats and tags — copied by **name**, the same convention
 * phase one's own upsert uses (design §2.4's vocab upsert), so a track named
 * the same as one of the new event's own platform defaults lands on that row
 * rather than raising a unique violation. `.returning()` off the upsert
 * itself is what gives back the new event's ids without a second read.
 */
async function copyVocabularyIn(dbOrTx: DbOrTx, sourceEventId: EventId, targetEventId: EventId): Promise<VocabRemap> {
  const [sourceTracks, sourceRooms, sourceFormats, sourceTags] = await Promise.all([
    dbOrTx.select({ id: tracks.id, name: tracks.name, color: tracks.color, description: tracks.description, sortOrder: tracks.sortOrder })
      .from(tracks).where(eq(tracks.eventId, sourceEventId)).orderBy(asc(tracks.sortOrder)),
    dbOrTx.select({ id: rooms.id, name: rooms.name, capacity: rooms.capacity, sortOrder: rooms.sortOrder })
      .from(rooms).where(eq(rooms.eventId, sourceEventId)).orderBy(asc(rooms.sortOrder)),
    dbOrTx.select({ id: sessionFormats.id, name: sessionFormats.name, defaultDurationMins: sessionFormats.defaultDurationMins, sortOrder: sessionFormats.sortOrder })
      .from(sessionFormats).where(eq(sessionFormats.eventId, sourceEventId)).orderBy(asc(sessionFormats.sortOrder)),
    dbOrTx.select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags).where(eq(tags.eventId, sourceEventId)).orderBy(asc(tags.name)),
  ]);

  // `.returning()` is called bare, not with a column picker: `dbOrTx` is the
  // `DbOrTx` union (plain pool vs. transaction), and the two members' insert
  // builders only agree on the zero-argument overload — the same reason
  // `deleteDemoEventIn` returns bare rows rather than a projected shape.
  const newTracks = sourceTracks.length === 0 ? [] : (await dbOrTx.insert(tracks).values(sourceTracks.map((row) => ({
    id: crypto.randomUUID(), eventId: targetEventId, name: row.name, color: row.color, description: row.description, sortOrder: row.sortOrder,
  }))).onConflictDoUpdate({
    target: [tracks.eventId, tracks.name],
    set: { color: sql`excluded.color`, description: sql`excluded.description`, sortOrder: sql`excluded.sort_order` },
  }).returning()).map((row) => ({ id: row.id, name: row.name }));

  if (sourceRooms.length > 0) {
    await dbOrTx.insert(rooms).values(sourceRooms.map((row) => ({
      id: crypto.randomUUID(), eventId: targetEventId, name: row.name, capacity: row.capacity, sortOrder: row.sortOrder,
    }))).onConflictDoUpdate({
      target: [rooms.eventId, rooms.name],
      set: { capacity: sql`excluded.capacity`, sortOrder: sql`excluded.sort_order` },
    });
  }

  const newFormats = sourceFormats.length === 0 ? [] : (await dbOrTx.insert(sessionFormats).values(sourceFormats.map((row) => ({
    id: crypto.randomUUID(), eventId: targetEventId, name: row.name, defaultDurationMins: row.defaultDurationMins, sortOrder: row.sortOrder,
  }))).onConflictDoUpdate({
    target: [sessionFormats.eventId, sessionFormats.name],
    set: { defaultDurationMins: sql`excluded.default_duration_mins`, sortOrder: sql`excluded.sort_order` },
  }).returning()).map((row) => ({ id: row.id, name: row.name }));

  const newTags = sourceTags.length === 0 ? [] : (await dbOrTx.insert(tags).values(sourceTags.map((row) => ({
    id: crypto.randomUUID(), eventId: targetEventId, name: row.name, color: row.color,
  }))).onConflictDoUpdate({
    target: [tags.eventId, tags.name],
    set: { color: sql`excluded.color` },
  }).returning()).map((row) => ({ id: row.id, name: row.name }));

  return {
    tracks: remapById<TrackId>(sourceTracks, newTracks),
    formats: remapById<FormatId>(sourceFormats, newFormats),
    tags: remapById<TagId>(sourceTags, newTags),
  };
}

/**
 * One dropdown/multiselect option, re-pointed at the new event's own
 * vocabulary row and given a fresh id derived from the new form — the same
 * `stableUuid(formId, …)` scheme `cfpAuthoringRows` already uses for its own
 * platform-default options, so a second copy attempt converges instead of
 * duplicating.
 */
function remapOptions(options: readonly FormOption[], newFormId: string, remap: VocabRemap): FormOption[] {
  return options.flatMap((option): FormOption[] => {
    const trackId = option.trackId ? remap.tracks.get(option.trackId) : undefined;
    const formatId = option.formatId ? remap.formats.get(option.formatId) : undefined;
    const tagId = option.tagId ? remap.tags.get(option.tagId) : undefined;
    // An option bound to vocabulary that did not survive the copy (should not
    // happen — vocabulary is copied first — but a field must never carry a
    // dangling reference) is dropped rather than left pointing at nothing.
    if (option.trackId && !trackId) return [];
    if (option.formatId && !formatId) return [];
    if (option.tagId && !tagId) return [];
    return [{
      id: stableUuid(newFormId, `option:${option.label}`),
      label: option.label,
      ...(trackId ? { trackId } : {}),
      ...(formatId ? { formatId } : {}),
      ...(tagId ? { tagId } : {}),
    }];
  });
}

type SourceField = {
  key: string;
  fieldType: FieldType;
  options: readonly FormOption[];
};

/**
 * A conditional visibility rule, re-pointed at the new field/option ids.
 * `demoFieldId`/the option's own `stableUuid(newFormId, …)` scheme are pure
 * functions of the field/option **key**, so the new condition can be computed
 * without caring whether the field it points at has been written yet.
 *
 * Every id in the rule has to be remapped or the condition dropped; there is
 * no middle option. A value left pointing at the *demo's* option id is a rule
 * that can never match on the copy, and the failure is silent — the dependent
 * question simply never appears on the organizer's brand-new form. Two shapes
 * used to slip through: an `in`/`not_in` array (the old code only remapped a
 * string value, so multi-option rules copied over verbatim), and a value naming
 * an option `remapOptions` had dropped for want of surviving vocabulary — an
 * organizer can delete a demo tag with nothing guarding it, and the option
 * bound to it does not survive the copy even though the source form still
 * carries it. Both are dropped now, and an emptied rule leaves the question
 * unconditional — visible, and therefore fixable, rather than missing.
 *
 * Which options survive is asked of `remapOptions` itself rather than restated
 * here. A second copy of "an option bound to vocabulary that did not survive is
 * dropped" would be a second answer to the question, and the two would drift —
 * exactly the drift that put the demo's own option ids on the copy in the first
 * place.
 *
 * Only an option-bearing source is remapped: `eq "yes"` against a text
 * question is the organizer's own words, and remapping or dropping it would
 * throw away a rule that copies across perfectly well.
 */
function remapVisibility(
  visibility: VisibilityRule | null,
  newFormId: string,
  fieldKeyById: ReadonlyMap<string, SourceField>,
  remap: VocabRemap,
): VisibilityRule | null {
  if (!visibility) return null;
  const conditions: Condition[] = visibility.conditions.flatMap((condition): Condition[] => {
    const source = fieldKeyById.get(condition.sourceFieldId);
    if (!source) return [];
    const sourceFieldId = fieldIdSchema.parse(stableUuid(newFormId, `field:${source.key}`));
    const optionSource = source.fieldType === "dropdown" || source.fieldType === "multiselect";
    if (!optionSource || condition.value === undefined) return [{ ...condition, sourceFieldId }];

    const copied = new Set(remapOptions(source.options, newFormId, remap).map((option) => option.id));
    const copiedOptionId = (value: string): string | null => {
      const option = source.options.find((candidate) => candidate.id === value);
      if (!option) return null;
      const id = stableUuid(newFormId, `option:${option.label}`);
      return copied.has(id) ? id : null;
    };
    if (!Array.isArray(condition.value)) {
      const value = copiedOptionId(condition.value);
      return value === null ? [] : [{ ...condition, sourceFieldId, value }];
    }
    // All or nothing: an `in` rule that kept only the options that survived
    // would quietly narrow what the organizer asked for.
    const value = condition.value.flatMap((entry) => copiedOptionId(entry) ?? []);
    return value.length === condition.value.length ? [{ ...condition, sourceFieldId, value }] : [];
  });
  return conditions.length > 0 ? { match: visibility.match, conditions } : null;
}

/**
 * The copied form's name, answering to the organizer's event rather than to
 * the demo conference.
 *
 * The name came over verbatim, so an organizer who ticked "Start from my
 * demo's setup" on a marketing event opened it to find a call for speakers
 * titled *Speak at AI Engineer World's Fair* — a conference they had never
 * heard of, on their own event, under a name they never chose. A scaffold copy
 * is structure; the demo conference's name is content.
 *
 * Only the provisioned name is rewritten, and only onto the same shape. An
 * organizer who renamed the form during the tour meant that name, and gets to
 * keep it — a substitution on the *event* name would not have caught this one
 * anyway, since the form is "Speak at AI Engineer World's Fair" while the
 * event carries a year ("… 2026").
 */
const DEMO_CFP_FORM_NAME = "Speak at AI Engineer World’s Fair";

export function scaffoldFormName(sourceName: string, targetEventName?: string): string {
  if (!targetEventName || sourceName !== DEMO_CFP_FORM_NAME) return sourceName;
  return `Speak at ${targetEventName}`;
}

/**
 * The demo's call-for-speakers form — fields, conditional rules and review
 * visibility — recompiled through `compileAndPublishIn` (which is
 * `compileFormSnapshot` under the hood, design §5.4) onto a brand-new form on
 * the real event. Silently a no-op if the demo was never provisioned far
 * enough to have a form: a scaffold copy is a bonus, never a blocker.
 */
async function copyPrimaryFormIn(dbOrTx: DbOrTx, sourceEventId: EventId, targetEventId: EventId, remap: VocabRemap): Promise<void> {
  const sourceFormId = demoFormId(sourceEventId, "cfp");
  const [sourceForm] = await dbOrTx.select({
    internalName: forms.internalName,
    kind: forms.kind,
    collectParticipants: forms.collectParticipants,
  }).from(forms).where(and(eq(forms.id, sourceFormId), eq(forms.eventId, sourceEventId))).limit(1);
  if (!sourceForm) return;
  const [targetEvent] = await dbOrTx.select({ name: events.name }).from(events)
    .where(eq(events.id, targetEventId)).limit(1);

  const sourceSections = await dbOrTx.select({ id: formSections.id, key: formSections.key })
    .from(formSections).where(and(eq(formSections.formId, sourceFormId), eq(formSections.eventId, sourceEventId)));
  const sourceSectionKeyById = new Map(sourceSections.map((section) => [section.id, section.key]));

  const sourceFieldRows = await dbOrTx.select({
    id: formFields.id,
    sectionId: formFields.sectionId,
    key: formFields.key,
    label: formFields.label,
    fieldType: formFields.fieldType,
    required: formFields.required,
    locked: formFields.locked,
    maxChars: formFields.maxChars,
    helpText: formFields.helpText,
    options: formFields.options,
    visibility: formFields.visibility,
    mapsTo: formFields.mapsTo,
    reviewVisibility: formFields.reviewVisibility,
    sortOrder: formFields.sortOrder,
  }).from(formFields)
    .where(and(eq(formFields.formId, sourceFormId), eq(formFields.eventId, sourceEventId), isNull(formFields.deletedAt)))
    .orderBy(asc(formFields.sortOrder));
  if (sourceFieldRows.length === 0) return;

  const parsedFields = sourceFieldRows.map((row) => ({
    ...row,
    options: formOptionSchema.array().parse(row.options ?? []),
    visibility: visibilityRuleSchema.nullable().parse(row.visibility ?? null),
    mapsTo: mapsToTargetSchema.nullable().parse(row.mapsTo),
    reviewVisibility: reviewVisibilitySchema.parse(row.reviewVisibility),
  }));
  const fieldByKey = new Map(parsedFields.map((field) => [field.id, { key: field.key, fieldType: field.fieldType, options: field.options } satisfies SourceField]));

  const newFormId = formIdSchema.parse(stableUuid(targetEventId, "scaffold:cfp"));
  await createFormIn(dbOrTx, targetEventId, {
    id: newFormId,
    internalName: scaffoldFormName(sourceForm.internalName, targetEvent?.name),
    kind: sourceForm.kind,
    collectParticipants: sourceForm.collectParticipants,
    context: "cfp",
  });

  const targetSections = await dbOrTx.select({ id: formSections.id, key: formSections.key })
    .from(formSections).where(and(eq(formSections.formId, newFormId), eq(formSections.eventId, targetEventId)));
  const targetSectionIdByKey = new Map(targetSections.map((section) => [section.key, section.id]));

  const rows = parsedFields.flatMap((field) => {
    const sectionKey = sourceSectionKeyById.get(field.sectionId);
    const sectionId = sectionKey ? targetSectionIdByKey.get(sectionKey) : undefined;
    // Every demo field's section key is one `createFormIn` always seeds
    // ("abstract" / "participant"); a miss here means the form's own
    // section structure changed underneath this copy, which is a defect in
    // the writer, not a reason to author a field with nowhere to live.
    if (!sectionId) return [];
    return [{
      id: fieldIdSchema.parse(stableUuid(newFormId, `field:${field.key}`)),
      eventId: targetEventId,
      formId: newFormId,
      sectionId,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      locked: field.locked,
      maxChars: field.maxChars,
      helpText: field.helpText,
      options: remapOptions(field.options, newFormId, remap),
      visibility: remapVisibility(field.visibility, newFormId, fieldByKey, remap),
      mapsTo: field.mapsTo,
      reviewVisibility: field.reviewVisibility,
      sortOrder: field.sortOrder,
      deletedAt: null,
    }];
  });
  if (rows.length === 0) return;

  const wantedIds: FieldId[] = rows.map((row) => row.id);
  await dbOrTx.delete(formFields).where(and(
    eq(formFields.eventId, targetEventId),
    eq(formFields.formId, newFormId),
    not(inArray(formFields.id, wantedIds)),
  ));
  await dbOrTx.insert(formFields).values(rows).onConflictDoUpdate({
    target: formFields.id,
    set: {
      sectionId: sql`excluded.section_id`,
      key: sql`excluded.key`,
      label: sql`excluded.label`,
      fieldType: sql`excluded.field_type`,
      required: sql`excluded.required`,
      locked: sql`excluded.locked`,
      maxChars: sql`excluded.max_chars`,
      helpText: sql`excluded.help_text`,
      options: sql`excluded.options`,
      visibility: sql`excluded.visibility`,
      mapsTo: sql`excluded.maps_to`,
      reviewVisibility: sql`excluded.review_visibility`,
      sortOrder: sql`excluded.sort_order`,
      deletedAt: null,
    },
  });

  const [current] = await dbOrTx.select({ currentVersion: forms.currentVersion })
    .from(forms).where(eq(forms.id, newFormId)).limit(1);
  // `createFormIn` leaves the skeleton at version 1; compile once, the same
  // "never mint a second version on replay" discipline phase three's own
  // `publishOnceIn` uses.
  if (current && current.currentVersion < 2) await compileAndPublishIn(dbOrTx, targetEventId, newFormId);
}

/**
 * "Start from my demo's setup" — the wizard's step 1 checkbox. Copies exactly
 * `DEMO_SCAFFOLD_TABLES`: the event's vocabulary and its one call-for-speakers
 * form, and nothing an organizer did with either during free play — this
 * function reads the demo's *live* rows, not the static seed dataset, so
 * whatever the organizer renamed, recoloured or re-asked travels with it.
 *
 * Never touches `sourceEventId` and writes only rows scoped to
 * `targetEventId`. Safe to call against a demo that was never provisioned (a
 * no-op) and safe to call twice (every id is a pure function of
 * `targetEventId`, so a retry converges rather than duplicating).
 */
export async function copyDemoScaffoldIn(dbOrTx: DbOrTx, sourceEventId: EventId, targetEventId: EventId): Promise<void> {
  const remap = await copyVocabularyIn(dbOrTx, sourceEventId, targetEventId);
  await copyPrimaryFormIn(dbOrTx, sourceEventId, targetEventId, remap);
}

/**
 * The HTTP-reachable half: resolve the organization's one demo event, refuse
 * to copy from or onto anything that is not exactly what it claims to be, and
 * record the milestone that actually matters (design §5.4) — `real_event_
 * after_demo`, not `event_created`, because the event already recorded that
 * one when the wizard created it.
 *
 * Deliberately not itself part of `advanceDemoProvisioningIn`'s phase
 * machinery: this runs once, outside the demo's own ten-phase cursor, against
 * a target event that is not a demo at all.
 *
 * The route above is `organizationAuth()`, which reads `organization_members`
 * and nothing else — and this function takes its write target straight from
 * the request body. Organization membership is *not* event access anywhere
 * else in this codebase (`authorizeAdmin`, `setExplicitEventAccessIn`), and
 * `copyVocabularyIn` upserts on `(event_id, name)`, so without the check
 * below an organization organizer could overwrite the track colours, room
 * capacities and format durations of an event they cannot even open, and
 * publish a call-for-speakers form on it. The real caller always passes: the
 * wizard calls this immediately after `createEventIn`, which makes the
 * creating actor the new event's owner.
 */
/**
 * The event-scoped half of this endpoint's authorization, spelled the same way
 * `authorizeAdmin` spells it: `event_members`, and nothing else.
 */
async function requireTargetEventOrganizerIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  targetEventId: EventId,
): Promise<void> {
  const [membership] = await dbOrTx.select({ role: eventMembers.role })
    .from(eventMembers)
    .where(and(eq(eventMembers.userId, actorUserId), eq(eventMembers.eventId, targetEventId)))
    .limit(1);
  if (membership?.role !== "owner" && membership?.role !== "organizer") {
    throw new AppError("FORBIDDEN", "You do not have access to this event");
  }
}

export async function copyDemoScaffoldForActorIn(
  dbOrTx: DbOrTx,
  inTransaction: DemoTransaction,
  actorUserId: UserId,
  organizationId: OrganizationId,
  targetEventId: EventId,
): Promise<{ copied: boolean }> {
  const sourceEventId = demoEventId(organizationId);
  const [source, target] = await Promise.all([
    dbOrTx.select({ isDemo: events.isDemo }).from(events)
      .where(and(eq(events.id, sourceEventId), eq(events.organizationId, organizationId))).limit(1),
    dbOrTx.select({ isDemo: events.isDemo }).from(events)
      .where(and(eq(events.id, targetEventId), eq(events.organizationId, organizationId))).limit(1),
  ]);
  if (!source[0]?.isDemo) throw new AppError("NOT_FOUND", "This organization has no demo event to copy from");
  const targetEvent = target[0];
  if (!targetEvent) throw new AppError("NOT_FOUND", "Event not found");
  if (targetEvent.isDemo) throw new AppError("VALIDATION", "Cannot copy a demo’s setup onto another demo event");
  await requireTargetEventOrganizerIn(dbOrTx, actorUserId, targetEventId);

  await inTransaction(async (tx) => {
    await copyDemoScaffoldIn(tx, sourceEventId, targetEventId);
    await tryRecordOrganizationOnboardingMilestoneIn(tx, organizationId, "real_event_after_demo", actorUserId);
    await recordOrganizationAuditEventIn(tx, organizationId, actorUserId, "demo.scaffold_copied", null, {
      sourceEventId,
      targetEventId,
    });
  });
  return { copied: true };
}

export const copyDemoScaffoldForActor = (
  actorUserId: UserId,
  organizationId: OrganizationId,
  targetEventId: EventId,
): Promise<{ copied: boolean }> => copyDemoScaffoldForActorIn(db, withTx, actorUserId, organizationId, targetEventId);
