import { and, eq, inArray, not, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { formFields, formSections, forms, routingRules } from "@/db/schema";
import { compileAndPublishIn, createFormIn, saveRoutingRuleIn } from "@/features/forms";
import { AppError } from "@/shared/lib/errors";
import type { Condition, EventId, FieldId, FormId, TagId } from "@/shared/contracts";
import { FORMATS, FORMS, ROUTING_RULES, TAGS, TRACKS, type DemoForm, type DemoFormField } from "../dataset";
import { demoFieldId, demoFormId, demoOptionId, readDemoVocabIn, type DemoVocabIndex, type PhaseCtx } from "./context";

/**
 * Phase 3 — the call for speakers, and the lightning round that already closed.
 *
 * The shape of this phase is dictated by one number in the script: Chapter 2
 * ends with the player pressing Publish and reading *"Version 3."* So the
 * provisioner must leave the CFP at version 2 and not one higher. Every builder
 * writer in `@/features/forms` compiles a new immutable snapshot on every call
 * — that is exactly what they are for — so authoring eleven questions through
 * `createFieldIn`/`updateFieldIn` would hand the organizer a form at version
 * fourteen before they had touched it, and would make this phase's replay write
 * eleven more versions on top.
 *
 * So: `createFormIn` writes the form, its two sections and version 1; the
 * question set is reconciled directly against `form_fields`; and one
 * `compileAndPublishIn` turns the result into version 2. Two versions, always,
 * however many times this phase runs.
 *
 * Everything else here goes through the public writers — `saveRoutingRuleIn`
 * validates the rule's conditions against live fields and its tags against the
 * event's own vocabulary, which is worth a round trip.
 */
export async function runFormsPhase(ctx: PhaseCtx): Promise<void> {
  const vocab = await readDemoVocabIn(ctx.dbOrTx, ctx.eventId);
  for (const form of FORMS) {
    await provisionFormIn(ctx, form, vocab);
  }
}

async function provisionFormIn(ctx: PhaseCtx, form: DemoForm, vocab: DemoVocabIndex): Promise<void> {
  const { dbOrTx, eventId, dates, now } = ctx;
  const formId = demoFormId(eventId, form.key);

  await createFormIn(dbOrTx, eventId, {
    id: formId,
    internalName: form.internalName,
    kind: "abstract",
    collectParticipants: true,
    context: "cfp",
  });

  await reconcileFieldsIn(dbOrTx, eventId, form, vocab, now);

  const window = form.key === "cfp" ? dates.forms.cfp : dates.forms.expoLightning;
  await dbOrTx.update(forms).set({
    externalTitle: form.externalTitle,
    pageHeading: form.pageHeading,
    status: form.status,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    submissionLimit: form.submissionLimit,
    showWelcome: true,
    welcomeHtml: form.welcomeHtml,
    updatedAt: now,
  }).where(and(eq(forms.id, formId), eq(forms.eventId, eventId)));

  await provisionRoutingRulesIn(ctx, form, formId, vocab);
  await publishOnceIn(dbOrTx, eventId, formId);
}

/**
 * The question set, reconciled to exactly what the dataset describes.
 *
 * `createFormIn` seeds a CFP form with the platform's twelve standard questions
 * — a sensible default for an organizer starting from nothing, and the wrong
 * set for a conference whose CFP is the thing being demonstrated. The four the
 * demo does not want are removed by id before the eleven it does want are
 * written, because `form_fields` carries a unique index on `(form_id, key)` for
 * live rows and the default `title` would otherwise collide with the demo's.
 *
 * Deleting rather than soft-deleting is safe *here specifically*: this runs
 * before any submission exists, so no answer, snapshot in flight or pinned
 * version references the rows being dropped. The delete is scoped to "not one
 * of the ids this phase is about to write", which makes a second run a no-op.
 */
async function reconcileFieldsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  form: DemoForm,
  vocab: DemoVocabIndex,
  now: Date,
): Promise<void> {
  const formId = demoFormId(eventId, form.key);
  const sections = await dbOrTx.select({ id: formSections.id, key: formSections.key })
    .from(formSections)
    .where(and(eq(formSections.eventId, eventId), eq(formSections.formId, formId)));
  const sectionIdByKey = new Map(sections.map((section) => [section.key, section.id]));

  const perSectionOrder = new Map<string, number>();
  type FieldRow = typeof formFields.$inferInsert;
  const rows: FieldRow[] = form.fields.map((field): FieldRow => {
    const sectionId = sectionIdByKey.get(field.sectionKey);
    if (!sectionId) throw new AppError("INTERNAL", "The demo form is missing one of its sections");
    const sortOrder = perSectionOrder.get(field.sectionKey) ?? 0;
    perSectionOrder.set(field.sectionKey, sortOrder + 1);
    return {
      id: demoFieldId(eventId, form.key, field.key),
      eventId,
      formId,
      sectionId,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required ?? false,
      locked: field.locked ?? false,
      maxChars: field.maxChars ?? null,
      helpText: "",
      options: optionsFor(eventId, form, field, vocab),
      visibility: visibilityFor(eventId, form, field),
      mapsTo: field.mapsTo ?? null,
      reviewVisibility: field.reviewVisibility ?? "identity",
      sortOrder,
      deletedAt: null,
    };
  });

  const wantedIds: FieldId[] = form.fields.map((field) => demoFieldId(eventId, form.key, field.key));
  await dbOrTx.delete(formFields).where(and(
    eq(formFields.eventId, eventId),
    eq(formFields.formId, formId),
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
      options: sql`excluded.options`,
      visibility: sql`excluded.visibility`,
      mapsTo: sql`excluded.maps_to`,
      reviewVisibility: sql`excluded.review_visibility`,
      sortOrder: sql`excluded.sort_order`,
      deletedAt: null,
      updatedAt: now,
    },
  });
}

type AuthoredOption = { id: string; label: string; trackId?: string; formatId?: string; tagId?: string };

/**
 * A dropdown's options, bound to the event's own vocabulary rather than
 * hand-authored labels, so the CFP always offers exactly the tracks, formats
 * and tags the event actually has — and so an answer, a routing rule and a
 * conditional visibility rule can all name the same option id.
 */
function optionsFor(eventId: EventId, form: DemoForm, field: DemoFormField, vocab: DemoVocabIndex): AuthoredOption[] {
  const option = (optionKey: string, label: string, binding: Omit<AuthoredOption, "id" | "label">): AuthoredOption => ({
    id: demoOptionId(eventId, form.key, field.key, optionKey),
    label,
    ...binding,
  });
  switch (field.optionSource) {
    case "track":
      return TRACKS.flatMap((track) => {
        const trackId = vocab.tracks.get(track.key);
        return trackId ? [option(track.key, track.name, { trackId })] : [];
      });
    case "format":
      return FORMATS.flatMap((format) => {
        const formatId = vocab.formats.get(format.key);
        return formatId ? [option(format.key, format.name, { formatId })] : [];
      });
    case "tag":
      return TAGS.flatMap((tag) => {
        const tagId = vocab.tags.get(tag.key);
        return tagId ? [option(tag.key, tag.name, { tagId })] : [];
      });
    default:
      return [];
  }
}

/**
 * The one conditional question: "Workshop duration" appears only once the
 * proposal's format is answered "Workshop". Chapter 2's payoff is watching it
 * appear in the real preview, which is why the rule points at the format
 * dropdown's *option id* rather than at a label a rename would break.
 */
function visibilityFor(eventId: EventId, form: DemoForm, field: DemoFormField) {
  if (!field.visibility) return null;
  const condition: Condition = {
    sourceFieldId: demoFieldId(eventId, form.key, field.visibility.sourceFieldKey),
    op: field.visibility.op,
    value: demoOptionId(eventId, form.key, field.visibility.sourceFieldKey, field.visibility.value),
  };
  return { match: "all" as const, conditions: [condition] };
}

/**
 * The Security-track routing rule, created once.
 *
 * `saveRoutingRuleIn` mints its own id when none is supplied and raises
 * `NOT_FOUND` when given one that does not exist yet, so neither call shape is
 * idempotent on its own. Probing for an existing rule first is: a re-run finds
 * the rule this phase already made and leaves it — including any edit the
 * organizer has since made to it.
 */
async function provisionRoutingRulesIn(ctx: PhaseCtx, form: DemoForm, formId: FormId, vocab: DemoVocabIndex): Promise<void> {
  const { dbOrTx, eventId } = ctx;
  const wanted = ROUTING_RULES.filter((rule) => rule.formKey === form.key);
  if (wanted.length === 0) return;

  const [existing] = await dbOrTx.select({ id: routingRules.id })
    .from(routingRules)
    .where(and(eq(routingRules.eventId, eventId), eq(routingRules.formId, formId)))
    .limit(1);
  if (existing) return;

  for (const rule of wanted) {
    const trackFieldId: FieldId = demoFieldId(eventId, form.key, "track");
    const addTagIds = rule.addTagKeys.flatMap((key) => {
      const tagId = vocab.tags.get(key);
      return tagId ? [tagId satisfies TagId] : [];
    });
    if (addTagIds.length === 0) continue;
    await saveRoutingRuleIn(dbOrTx, eventId, formId, {
      match: "all",
      conditions: [{
        sourceFieldId: trackFieldId,
        op: "eq",
        value: demoOptionId(eventId, form.key, "track", rule.matchTrackKey),
      }],
      setTrackId: null,
      addTagIds,
      enabled: true,
    });
  }
}

/**
 * One compile, ever.
 *
 * `compileAndPublishIn` always writes `currentVersion + 1`, so calling it on a
 * replay would keep minting versions. Version 1 is the skeleton `createFormIn`
 * wrote; version 2 is this dataset. Anything at or beyond 2 has already been
 * compiled — by this phase, or by the organizer, whose version this must never
 * step on.
 */
async function publishOnceIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<void> {
  const [row] = await dbOrTx.select({ currentVersion: forms.currentVersion })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
    .limit(1);
  if (!row) throw new AppError("INTERNAL", "The demo form disappeared while it was being built");
  if (row.currentVersion >= 2) return;
  await compileAndPublishIn(dbOrTx, eventId, formId);
}
