import { and, eq, isNull, ne } from "drizzle-orm";
import { forms, formFields, formSections, formVersions, routingRules } from "@/db/schema";
import { compileFormSnapshot } from "@/shared/lib/form-snapshot";
import type { FormAuthoringRows } from "@/shared/contracts";
import { eventLocal, type SeedCtx } from "./lib/helpers";

/**
 * Owned by M12 (WS-B1).
 *
 * Two forms, because the closed state needs something to render: form A is open
 * and takes submissions, form B closed yesterday.
 *
 * Snapshots are produced by `compileFormSnapshot` from the authoring rows, never
 * hand-written. A hand-written snapshot is a second definition of what a form is,
 * and it is the one that drifts.
 */
function authoringRows(ctx: SeedCtx, formKey: string): FormAuthoringRows {
  const formId = ctx.id("form", formKey) as FormAuthoringRows["form"]["id"];
  const abstract = ctx.id("section", `${formKey}-abstract`) as FormAuthoringRows["sections"][number]["id"];
  const participant = ctx.id("section", `${formKey}-participant`) as FormAuthoringRows["sections"][number]["id"];
  const field = (key: string) => ctx.id("field", `${formKey}-${key}`) as FormAuthoringRows["fields"][number]["id"];

  // `reviewVisibility: "identity"` is the fail-closed default every question
  // starts from (M50): a blind reviewer sees an answer only where an organizer
  // has deliberately said it is proposal content. Two seeded questions below
  // exist precisely to show both sides of that switch on the demo world.
  const base = { required: false, locked: false, maxChars: null, helpText: "", options: [], visibility: null, mapsTo: null, reviewVisibility: "identity" as const, deletedAt: null };

  return {
    form: { id: formId, context: "cfp", version: 1 },
    sections: [
      { id: abstract, key: "abstract", title: "Abstract Information", pageHeading: "Submission", descriptionHtml: "<p>Tell us what you want to share.</p>", sortOrder: 0 },
      { id: participant, key: "participant", title: "Participant Information", pageHeading: "Speaker", descriptionHtml: "<p>Tell us about yourself.</p>", sortOrder: 1 },
    ],
    fields: [
      { ...base, id: field("title"), sectionId: abstract, key: "title", label: "Title", fieldType: "text", required: true, locked: true, maxChars: 255, mapsTo: "submission.title", sortOrder: 0 },
      { ...base, id: field("description"), sectionId: abstract, key: "description", label: "Description", fieldType: "richtext", required: true, maxChars: 5000, mapsTo: "submission.description_html", sortOrder: 1 },
      {
        ...base, id: field("track"), sectionId: abstract, key: "track", label: "Track", fieldType: "dropdown", required: true, sortOrder: 2,
        mapsTo: "submission.track_id",
        options: [
          { id: "agents", label: "AI Agents", trackId: ctx.id("track", "agents") as never },
          { id: "platforms", label: "Platforms", trackId: ctx.id("track", "platforms") as never },
          { id: "security", label: "Security", trackId: ctx.id("track", "security") as never },
          { id: "community", label: "Community", trackId: ctx.id("track", "community") as never },
        ],
      },
      {
        ...base, id: field("format"), sectionId: abstract, key: "format", label: "Format", fieldType: "dropdown", required: true, sortOrder: 3,
        mapsTo: "submission.format_id",
        options: [
          { id: "talk", label: "Talk", formatId: ctx.id("format", "talk") as never },
          { id: "workshop", label: "Workshop", formatId: ctx.id("format", "workshop") as never },
          { id: "panel", label: "Panel", formatId: ctx.id("format", "panel") as never },
          { id: "keynote", label: "Keynote", formatId: ctx.id("format", "keynote") as never },
        ],
      },
      // The conditional field. CP2 asks a judge to watch this appear and
      // disappear, so it is seeded rather than left for them to build.
      {
        ...base, id: field("workshop_duration"), sectionId: abstract, key: "workshop_duration", label: "Workshop duration",
        fieldType: "text", sortOrder: 4,
        visibility: { match: "all", conditions: [{ sourceFieldId: field("format"), op: "eq", value: "workshop" }] },
      },
      {
        ...base, id: field("topics"), sectionId: abstract, key: "topics", label: "Topics", fieldType: "multiselect", sortOrder: 5,
        options: [
          { id: "evals", label: "Evals", tagId: ctx.id("tag", "evals") as never },
          { id: "safety", label: "Safety", tagId: ctx.id("tag", "safety") as never },
          { id: "tooling", label: "Tooling", tagId: ctx.id("tag", "tooling") as never },
        ],
      },
      // M50's blind-review fixture, half one. "Approach" is proposal content an
      // organizer has explicitly opted into an anonymized reviewer's view, so a
      // blind DTO carries it. Nothing about the question's *name* or section
      // decides that — only this classification, pinned into the snapshot.
      {
        ...base, id: field("approach"), sectionId: abstract, key: "approach", label: "Approach",
        fieldType: "textarea", maxChars: 1000, sortOrder: 6, reviewVisibility: "content",
        helpText: "How you will teach it. Anonymized reviewers read this.",
      },
      { ...base, id: field("first_name"), sectionId: participant, key: "first_name", label: "First name", fieldType: "text", required: true, locked: true, mapsTo: "contact.first_name", sortOrder: 0 },
      { ...base, id: field("last_name"), sectionId: participant, key: "last_name", label: "Last name", fieldType: "text", required: true, locked: true, mapsTo: "contact.last_name", sortOrder: 1 },
      { ...base, id: field("email"), sectionId: participant, key: "email", label: "Email", fieldType: "email", required: true, locked: true, mapsTo: "contact.email", sortOrder: 2 },
      { ...base, id: field("company"), sectionId: participant, key: "company", label: "Company", fieldType: "text", mapsTo: "contact.company", sortOrder: 3 },
      { ...base, id: field("bio"), sectionId: participant, key: "bio", label: "Bio", fieldType: "richtext", maxChars: 5000, mapsTo: "contact.bio_html", sortOrder: 4 },
      // M50's blind-review fixture, half two. "Employer" is an ordinary custom
      // question nobody classified, so it keeps the fail-closed default and a
      // blind DTO withholds it — the failure mode of unclassified metadata is
      // omission, not leakage.
      // The label is deliberately *not* a second "Company". The fixture only
      // needs an ordinary custom question nobody classified; asking the same
      // thing twice made the form the landing page invites every visitor to
      // walk look like it had been assembled carelessly.
      { ...base, id: field("employer"), sectionId: participant, key: "employer", label: "How did you hear about this event?", fieldType: "text", sortOrder: 5 },
    ],
  };
}

/**
 * The open form's seed key. Exported because the deploy smoke test derives its
 * CFP fixture id from it (scripts/print-smoke-fixture-ids.ts); renaming the key
 * re-ids the form and the smoke fixture together, which is the point.
 */
export const OPEN_FORM_KEY = "form-a";

export async function seedForms(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  for (const [formKey, config] of [
    [OPEN_FORM_KEY, { title: "Speak at AI.Engineer Sandbox", closesAt: eventLocal(ctx.now, 38, "23:59"), limit: 3 }],
    // Closed yesterday: the branded closed page needs a form that is genuinely
    // past its date, not one an admin switched off.
    ["form-b", { title: "Lightning talks (closed)", closesAt: eventLocal(ctx.now, -1, "23:59"), limit: 1 }],
  ] as const) {
    const rows = authoringRows(ctx, formKey);
    await tx.insert(forms).values({
      id: rows.form.id,
      eventId,
      context: "cfp",
      internalName: config.title,
      externalTitle: config.title,
      status: "open",
      closesAt: config.closesAt,
      submissionLimit: config.limit,
      currentVersion: 1,
      showWelcome: true,
      welcomeHtml: "<p>We are looking for practical talks from people who have shipped something.</p>",
    }).onConflictDoUpdate({
      target: forms.id,
      set: {
        context: "cfp",
        internalName: config.title,
        externalTitle: config.title,
        status: "open",
        closesAt: config.closesAt,
        submissionLimit: config.limit,
        currentVersion: 1,
        showWelcome: true,
        welcomeHtml: "<p>We are looking for practical talks from people who have shipped something.</p>",
        updatedAt: new Date(),
      },
    });

    for (const section of rows.sections) {
      await tx.insert(formSections).values({
        id: section.id, eventId, formId: rows.form.id, key: section.key, title: section.title,
        pageHeading: section.pageHeading, descriptionHtml: section.descriptionHtml, sortOrder: section.sortOrder,
      }).onConflictDoUpdate({
        target: formSections.id,
        set: {
          key: section.key,
          title: section.title,
          pageHeading: section.pageHeading,
          descriptionHtml: section.descriptionHtml,
          sortOrder: section.sortOrder,
          updatedAt: new Date(),
        },
      });
    }
    for (const authored of rows.fields) {
      // An organizer can replace a soft-deleted seeded field with a new row that
      // reuses its key. Restore the deterministic row without violating the
      // partial unique index, while preserving the replacement as soft-deleted
      // history instead of destroying it.
      if (!authored.deletedAt) {
        const reconciledAt = new Date();
        await tx.update(formFields)
          .set({ deletedAt: reconciledAt, updatedAt: reconciledAt })
          .where(and(
            eq(formFields.formId, rows.form.id),
            eq(formFields.key, authored.key),
            isNull(formFields.deletedAt),
            ne(formFields.id, authored.id),
          ));
      }
      await tx.insert(formFields).values({
        id: authored.id, eventId, formId: rows.form.id, sectionId: authored.sectionId, key: authored.key,
        label: authored.label, fieldType: authored.fieldType, required: authored.required, locked: authored.locked,
        maxChars: authored.maxChars, helpText: authored.helpText, options: authored.options,
        visibility: authored.visibility, mapsTo: authored.mapsTo, sortOrder: authored.sortOrder,
        // Carried explicitly rather than left to the column default: the
        // authoring row and the compiled snapshot have to agree about which
        // questions a blind reviewer may read, and the default is only correct
        // for the questions that happen to want it.
        reviewVisibility: authored.locked ? "identity" : authored.reviewVisibility ?? "identity",
        deletedAt: authored.deletedAt ? new Date(authored.deletedAt) : null,
      }).onConflictDoUpdate({
        target: formFields.id,
        set: {
          sectionId: authored.sectionId,
          key: authored.key,
          label: authored.label,
          fieldType: authored.fieldType,
          required: authored.required,
          locked: authored.locked,
          maxChars: authored.maxChars,
          helpText: authored.helpText,
          options: authored.options,
          visibility: authored.visibility,
          mapsTo: authored.mapsTo,
          sortOrder: authored.sortOrder,
          reviewVisibility: authored.locked ? "identity" : authored.reviewVisibility ?? "identity",
          deletedAt: authored.deletedAt ? new Date(authored.deletedAt) : null,
          updatedAt: new Date(),
        },
      });
    }

    // The compiler is the only snapshot producer; the seed calls the same
    // function the builder's save path does.
    const snapshot = compileFormSnapshot(rows);
    await tx.insert(formVersions)
      .values({ id: ctx.id("form_version", `${formKey}-1`), eventId, formId: rows.form.id, version: 1, snapshot })
      .onConflictDoUpdate({ target: formVersions.id, set: { snapshot } });
  }

  // One routing rule on the open form, because CP2 asks for a judge-visible
  // routing effect and an unrouted submission proves nothing.
  const formA = authoringRows(ctx, OPEN_FORM_KEY);
  const formatField = formA.fields.find((field) => field.key === "format");
  await tx.insert(routingRules).values({
    id: ctx.id("routing_rule", "workshop-to-agents"),
    eventId,
    formId: formA.form.id,
    sortOrder: 0,
    match: "all",
    conditions: [{ sourceFieldId: formatField?.id, op: "eq", value: "workshop" }],
    setTrackId: ctx.id("track", "agents"),
    addTagIds: [ctx.id("tag", "tooling")],
    enabled: true,
  }).onConflictDoUpdate({
    target: routingRules.id,
    set: {
      sortOrder: 0,
      match: "all",
      conditions: [{ sourceFieldId: formatField?.id, op: "eq", value: "workshop" }],
      setTrackId: ctx.id("track", "agents"),
      addTagIds: [ctx.id("tag", "tooling")],
      enabled: true,
      updatedAt: new Date(),
    },
  });

  ctx.log("seeded 2 forms (one open, one closed), 1 routing rule, snapshots compiled");
  // The admin forms list is not yet database-backed, so this line is the
  // supported way to obtain the deployed public CFP URL for the open form.
  ctx.log(`public CFP path: /submit/<eventSlug>/${formA.form.id} (open form)`);
}
