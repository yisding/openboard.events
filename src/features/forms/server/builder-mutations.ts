import { and, asc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events, formFields, forms, formSections, formVersions, sessionFormats, tags, tracks } from "@/db/schema";
import {
  COMMITTED_FIELD_TYPES,
  fieldIdSchema,
  formIdSchema,
  formatIdSchema,
  sectionIdSchema,
  tagIdSchema,
  trackIdSchema,
  type EventId,
  type FormAuthoringRows,
  type FormContext,
  type FormId,
  type MapsToTarget,
  type TaskTarget,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { compileFormSnapshot } from "@/shared/lib/form-snapshot";
import { sanitize } from "@/shared/lib/sanitize";
import type { BuilderField, BuilderForm, BuilderStep, FieldPatch, FormPatch, SectionPatch } from "../builder-types";
import {
  assertMapsToMatchesTarget,
  assertNotLockedField,
  assertStructuralAllowed,
  assertUniqueFieldKey,
  assertUniqueMapsTo,
  fieldPatchIsStructural,
} from "./guards";
import { getFormForBuilderIn, hasNonDraftSubmissionsIn } from "./builder-queries";

type CreateFormInput = {
  internalName: string;
  kind: "abstract" | "session";
  collectParticipants: boolean;
  // M12-GENERALIZE: defaults to "cfp" so every pre-existing caller (the
  // organizer CFP builder's "+ Add" flow) is unaffected. M24's portal-form
  // create passes context="portal" and a `targetType` — the two travel
  // together, since a portal form's standard-field library (M24 §5) is
  // chosen by target type.
  context?: FormContext | undefined;
  targetType?: TaskTarget | null | undefined;
};
type CreateFieldInput = {
  sectionId: string;
  label: string;
  fieldType: (typeof COMMITTED_FIELD_TYPES)[number];
  mapsTo?: MapsToTarget | null | undefined;
  optionLabels?: string[] | undefined;
};

function fieldKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "question";
}

function isoDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError("VALIDATION", "Date must be a valid ISO timestamp");
  return parsed;
}

function authoringRows(form: BuilderForm, version: number): FormAuthoringRows {
  return {
    form: { id: form.id, context: form.context, version },
    sections: form.sections.map((section) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      pageHeading: section.pageHeading,
      descriptionHtml: section.descriptionHtml,
      sortOrder: section.sortOrder,
    })),
    fields: form.sections.flatMap((section) => section.fields.map((field) => ({
      id: field.id,
      sectionId: section.id,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      locked: field.locked,
      maxChars: field.maxChars,
      helpText: field.helpText,
      options: field.options,
      visibility: field.visibility,
      mapsTo: field.mapsTo,
      reviewVisibility: field.reviewVisibility,
      sortOrder: field.sortOrder,
      deletedAt: null,
    }))),
  };
}

function allFields(form: BuilderForm): BuilderField[] {
  return form.sections.flatMap((section) => section.fields);
}

function nextSnapshot(form: BuilderForm) {
  return compileFormSnapshot(authoringRows(form, form.currentVersion + 1));
}

async function touchFormIn(dbOrTx: DbOrTx, eventId: EventId, form: BuilderForm, expectedUpdatedAt: string, now: Date): Promise<void> {
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) throw new AppError("VALIDATION", "expectedUpdatedAt must be an ISO timestamp");
  const [updated] = await dbOrTx.update(forms)
    .set({ updatedAt: now, rowVersion: sql`${forms.rowVersion} + 1` })
    .where(and(eq(forms.id, form.id), eq(forms.eventId, eventId), eq(forms.updatedAt, expected)))
    .returning();
  if (!updated) throw new AppError("STALE_WRITE", "This form changed since you loaded it. Reload and try again.");
}

async function storeVersionIn(dbOrTx: DbOrTx, eventId: EventId, form: BuilderForm, snapshot: ReturnType<typeof nextSnapshot>): Promise<void> {
  await dbOrTx.insert(formVersions).values({ eventId, formId: form.id, version: snapshot.version, snapshot });
  await dbOrTx.update(forms).set({ currentVersion: snapshot.version })
    .where(and(eq(forms.id, form.id), eq(forms.eventId, eventId)));
}

export async function compileAndPublishIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<{ version: number }> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const snapshot = nextSnapshot(form);
  const now = new Date();
  await dbOrTx.insert(formVersions).values({ eventId, formId, version: snapshot.version, snapshot });
  await dbOrTx.update(forms).set({ currentVersion: snapshot.version, updatedAt: now })
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)));
  return { version: snapshot.version };
}

export function compileAndPublish(eventId: EventId, formId: FormId): Promise<{ version: number }> {
  return compileAndPublishIn(db, eventId, formId);
}

function cfpAuthoringRows(formId: FormId, trackRows: { id: string; name: string }[], formatRows: { id: string; name: string }[], tagRows: { id: string; name: string }[]): FormAuthoringRows {
  const abstractId = sectionIdSchema.parse(crypto.randomUUID());
  const participantId = sectionIdSchema.parse(crypto.randomUUID());
  type AuthoredOption = FormAuthoringRows["fields"][number]["options"][number];
  const option = (label: string, binding: Partial<Omit<AuthoredOption, "id" | "label">> = {}): AuthoredOption => ({ id: crypto.randomUUID(), label, ...binding });
  const base: Pick<FormAuthoringRows["fields"][number], "required" | "locked" | "maxChars" | "helpText" | "options" | "visibility" | "mapsTo" | "reviewVisibility" | "deletedAt"> = {
    required: false,
    locked: false,
    maxChars: null,
    helpText: "",
    options: [],
    visibility: null,
    mapsTo: null,
    // Every default question starts withheld from blind review; an organizer
    // opts the ones that are really about the proposal into `content`.
    reviewVisibility: "identity",
    deletedAt: null,
  };
  const authored = (sectionId: typeof abstractId, key: string, label: string, fieldType: FormAuthoringRows["fields"][number]["fieldType"], sortOrder: number, patch: Partial<FormAuthoringRows["fields"][number]> = {}): FormAuthoringRows["fields"][number] => ({
    ...base,
    id: fieldIdSchema.parse(crypto.randomUUID()),
    sectionId,
    key,
    label,
    fieldType,
    sortOrder,
    ...patch,
  });
  return {
    form: { id: formId, context: "cfp", version: 1 },
    sections: [
      { id: abstractId, key: "abstract", title: "Tell us about your submission", pageHeading: "Submission", descriptionHtml: "", sortOrder: 0 },
      { id: participantId, key: "participant", title: "Tell us about you", pageHeading: "Participant", descriptionHtml: "", sortOrder: 1 },
    ],
    fields: [
      authored(abstractId, "title", "Title", "text", 0, { required: true, locked: true, maxChars: 255, mapsTo: "submission.title" }),
      authored(abstractId, "description", "Description", "richtext", 1, { required: true, maxChars: 5000, mapsTo: "submission.description_html" }),
      authored(abstractId, "format", "Format", "dropdown", 2, { required: formatRows.length > 0, options: formatRows.map((row) => option(row.name, { formatId: formatIdSchema.parse(row.id) })), mapsTo: "submission.format_id" }),
      authored(abstractId, "tags", "Tags", "multiselect", 3, { options: tagRows.map((row) => option(row.name, { tagId: tagIdSchema.parse(row.id) })) }),
      authored(abstractId, "track", "Track", "dropdown", 4, { required: trackRows.length > 0, options: trackRows.map((row) => option(row.name, { trackId: trackIdSchema.parse(row.id) })), mapsTo: "submission.track_id" }),
      authored(abstractId, "level", "Level", "dropdown", 5, { options: [option("Beginner"), option("Intermediate"), option("Advanced")], mapsTo: "submission.level" }),
      authored(participantId, "first_name", "First Name", "text", 0, { required: true, locked: true, maxChars: 255, mapsTo: "contact.first_name" }),
      authored(participantId, "last_name", "Last Name", "text", 1, { required: true, locked: true, maxChars: 255, mapsTo: "contact.last_name" }),
      authored(participantId, "email", "Email", "email", 2, { required: true, locked: true, mapsTo: "contact.email" }),
      authored(participantId, "company", "Company", "text", 3, { maxChars: 255, mapsTo: "contact.company" }),
      authored(participantId, "job_title", "Job Title", "text", 4, { maxChars: 255, mapsTo: "contact.job_title" }),
      authored(participantId, "biography", "Biography", "richtext", 5, { maxChars: 5000, mapsTo: "contact.bio_html" }),
    ],
  };
}

// M24's builder adds fields from its own standard-field library after
// creation (plan/modules/M24-portal-form-builder.md §5) through the same
// field-CRUD mutations below (`createFieldIn`) — this module only owns the
// empty skeleton a portal form starts from, one section, zero fields.
function portalAuthoringRows(formId: FormId): FormAuthoringRows {
  const questionsId = sectionIdSchema.parse(crypto.randomUUID());
  return {
    form: { id: formId, context: "portal", version: 1 },
    sections: [
      { id: questionsId, key: "questions", title: "Questions", pageHeading: "Questions", descriptionHtml: "", sortOrder: 0 },
    ],
    fields: [],
  };
}

export async function createFormIn(dbOrTx: DbOrTx, eventId: EventId, input: CreateFormInput): Promise<BuilderForm> {
  const context: FormContext = input.context ?? "cfp";
  const targetType = context === "portal" ? input.targetType ?? null : null;
  if (context === "portal" && !targetType) throw new AppError("VALIDATION", "Portal forms must specify a target type");

  const [eventRows, trackRows, formatRows, tagRows] = await Promise.all([
    dbOrTx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1),
    context === "cfp" ? dbOrTx.select().from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sortOrder), asc(tracks.id)) : Promise.resolve([]),
    context === "cfp" ? dbOrTx.select().from(sessionFormats).where(eq(sessionFormats.eventId, eventId)).orderBy(asc(sessionFormats.sortOrder), asc(sessionFormats.id)) : Promise.resolve([]),
    context === "cfp" ? dbOrTx.select().from(tags).where(eq(tags.eventId, eventId)).orderBy(asc(tags.name), asc(tags.id)) : Promise.resolve([]),
  ]);
  // The relational query above is deliberately just an existence probe; avoid
  // leaving a half-created form when the caller supplies a foreign event id.
  if (!eventRows[0]) throw new AppError("NOT_FOUND", "Event not found");

  const formId = formIdSchema.parse(crypto.randomUUID());
  const rows: FormAuthoringRows = context === "cfp" ? cfpAuthoringRows(formId, trackRows, formatRows, tagRows) : portalAuthoringRows(formId);
  const snapshot = compileFormSnapshot(rows);
  const now = new Date();
  const internalName = input.internalName.trim();
  await dbOrTx.insert(forms).values({
    id: formId,
    eventId,
    context,
    internalName,
    externalTitle: internalName,
    pageHeading: "Welcome!",
    status: "draft",
    kind: input.kind,
    collectParticipants: input.collectParticipants,
    targetType,
    currentVersion: 1,
    participantRoles: [
      { role: "speaker", enabled: true, min: 1, max: null },
      { role: "co_speaker", enabled: false, min: null, max: null },
      { role: "moderator", enabled: false, min: null, max: null },
      { role: "panelist", enabled: false, min: null, max: null },
    ],
    createdAt: now,
    updatedAt: now,
  });
  await dbOrTx.insert(formSections).values(rows.sections.map((section) => ({ ...section, eventId, formId, descriptionHtml: section.descriptionHtml })));
  if (rows.fields.length > 0) {
    await dbOrTx.insert(formFields).values(rows.fields.map((field) => ({
      id: field.id,
      eventId,
      formId,
      sectionId: field.sectionId,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      locked: field.locked,
      maxChars: field.maxChars,
      helpText: field.helpText,
      options: field.options,
      visibility: field.visibility,
      mapsTo: field.mapsTo,
      reviewVisibility: field.reviewVisibility ?? "identity",
      sortOrder: field.sortOrder,
    })));
  }
  await dbOrTx.insert(formVersions).values({ eventId, formId, version: 1, snapshot });
  return getFormForBuilderIn(dbOrTx, eventId, formId, context);
}

export function createForm(eventId: EventId, input: CreateFormInput): Promise<BuilderForm> {
  return createFormIn(db, eventId, input);
}

export async function updateFormIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, patch: FormPatch, expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const structural = (patch.kind !== undefined && patch.kind !== form.kind)
    || (patch.collectParticipants !== undefined && patch.collectParticipants !== form.collectParticipants);
  assertStructuralAllowed(form.hasNonDraftSubmissions, structural);
  const cleaned: FormPatch = {
    ...patch,
    ...(patch.internalName !== undefined ? { internalName: patch.internalName.trim() } : {}),
    ...(patch.externalTitle !== undefined ? { externalTitle: patch.externalTitle.trim() } : {}),
    ...(patch.welcomeHtml !== undefined ? { welcomeHtml: sanitize(patch.welcomeHtml) } : {}),
    ...(patch.successHtml !== undefined ? { successHtml: sanitize(patch.successHtml) } : {}),
    ...(patch.confirmationBodyHtml !== undefined ? { confirmationBodyHtml: sanitize(patch.confirmationBodyHtml) } : {}),
  };
  const hypothetical = { ...form, ...cleaned } as BuilderForm;
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  await dbOrTx.update(forms).set({
    ...(cleaned.internalName !== undefined ? { internalName: cleaned.internalName } : {}),
    ...(cleaned.externalTitle !== undefined ? { externalTitle: cleaned.externalTitle } : {}),
    ...(cleaned.pageHeading !== undefined ? { pageHeading: cleaned.pageHeading } : {}),
    ...(cleaned.status !== undefined ? { status: cleaned.status } : {}),
    ...(cleaned.kind !== undefined ? { kind: cleaned.kind } : {}),
    ...(cleaned.collectParticipants !== undefined ? { collectParticipants: cleaned.collectParticipants } : {}),
    ...(cleaned.opensAt !== undefined ? { opensAt: isoDate(cleaned.opensAt) } : {}),
    ...(cleaned.closesAt !== undefined ? { closesAt: isoDate(cleaned.closesAt) } : {}),
    ...(cleaned.submissionLimit !== undefined ? { submissionLimit: cleaned.submissionLimit } : {}),
    ...(cleaned.showWelcome !== undefined ? { showWelcome: cleaned.showWelcome } : {}),
    ...(cleaned.welcomeHtml !== undefined ? { welcomeHtml: cleaned.welcomeHtml } : {}),
    ...(cleaned.successHtml !== undefined ? { successHtml: cleaned.successHtml } : {}),
    ...(cleaned.autoRedirectToPortal !== undefined ? { autoRedirectToPortal: cleaned.autoRedirectToPortal } : {}),
    ...(cleaned.participantRoles !== undefined ? { participantRoles: cleaned.participantRoles.map((role) => ({ ...role, min: null, max: null })) } : {}),
    ...(cleaned.sendConfirmation !== undefined ? { sendConfirmation: cleaned.sendConfirmation } : {}),
    ...(cleaned.confirmationSubject !== undefined ? { confirmationSubject: cleaned.confirmationSubject } : {}),
    ...(cleaned.confirmationBodyHtml !== undefined ? { confirmationBodyHtml: cleaned.confirmationBodyHtml } : {}),
  }).where(and(eq(forms.id, formId), eq(forms.eventId, eventId)));
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}

export async function saveFormStep(
  eventId: EventId,
  formId: FormId,
  _step: BuilderStep,
  patch: FormPatch,
  expectedUpdatedAt: string,
): Promise<{ version: number }> {
  const form = await updateFormIn(db, eventId, formId, patch, expectedUpdatedAt);
  return { version: form.currentVersion };
}

export async function updateSectionIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, sectionId: string, patch: SectionPatch, expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const section = form.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new AppError("NOT_FOUND", "Section not found");
  const cleaned = {
    ...patch,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.pageHeading !== undefined ? { pageHeading: patch.pageHeading.trim() } : {}),
    ...(patch.descriptionHtml !== undefined ? { descriptionHtml: sanitize(patch.descriptionHtml) } : {}),
  };
  const hypothetical = { ...form, sections: form.sections.map((candidate) => candidate.id === section.id ? { ...candidate, ...cleaned } : candidate) } as BuilderForm;
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  await dbOrTx.update(formSections).set({
    ...(cleaned.title !== undefined ? { title: cleaned.title } : {}),
    ...(cleaned.pageHeading !== undefined ? { pageHeading: cleaned.pageHeading } : {}),
    ...(cleaned.descriptionHtml !== undefined ? { descriptionHtml: cleaned.descriptionHtml } : {}),
    updatedAt: now,
  }).where(and(eq(formSections.id, section.id), eq(formSections.eventId, eventId), eq(formSections.formId, formId)));
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}

export async function createFieldIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, input: CreateFieldInput, expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  assertStructuralAllowed(form.hasNonDraftSubmissions, true);
  const section = form.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) throw new AppError("NOT_FOUND", "Section not found");
  let key = fieldKey(input.label);
  const fields = allFields(form);
  for (let suffix = 2; fields.some((field) => field.key === key); suffix += 1) key = `${fieldKey(input.label)}_${suffix}`;
  const field: BuilderField = {
    id: fieldIdSchema.parse(crypto.randomUUID()),
    sectionId: section.id,
    key,
    label: input.label.trim(),
    fieldType: input.fieldType,
    required: false,
    locked: false,
    maxChars: input.fieldType === "richtext" ? 5000 : ["text", "textarea"].includes(input.fieldType) ? 500 : null,
    helpText: "",
    options: ["dropdown", "multiselect"].includes(input.fieldType)
      ? [{ id: crypto.randomUUID(), label: "Option 1" }, { id: crypto.randomUUID(), label: "Option 2" }]
      : [],
    visibility: null,
    mapsTo: null,
    reviewVisibility: "identity",
    sortOrder: section.fields.length,
  };
  const nextMapsTo = input.mapsTo ?? null;
  assertUniqueMapsTo(fields, field.id, nextMapsTo);
  assertMapsToMatchesTarget(form.targetType, nextMapsTo);
  field.mapsTo = nextMapsTo;
  if (["dropdown", "multiselect"].includes(field.fieldType)
    && (input.optionLabels !== undefined || nextMapsTo === "submission.track_id" || nextMapsTo === "submission.format_id")) {
    field.options = await reconcileOptions(
      dbOrTx,
      eventId,
      field,
      input.optionLabels ?? field.options.map((entry) => entry.label),
      nextMapsTo,
      field.fieldType,
    );
  }
  const hypothetical = { ...form, sections: form.sections.map((candidate) => candidate.id === section.id ? { ...candidate, fields: [...candidate.fields, field] } : candidate) };
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  await dbOrTx.insert(formFields).values({ ...field, eventId, formId, fieldType: field.fieldType, options: field.options, visibility: field.visibility, mapsTo: field.mapsTo, reviewVisibility: field.reviewVisibility });
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}

function reconcileFreeformOptions(field: BuilderField, labels: string[]): BuilderField["options"] {
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  const unused = [...field.options];
  return clean.map((label) => {
    const exact = unused.findIndex((option) => option.label === label);
    const picked = exact >= 0 ? unused.splice(exact, 1)[0] : unused.shift();
    return picked ? { ...picked, label } : { id: crypto.randomUUID(), label };
  });
}

async function reconcileOptions(
  dbOrTx: DbOrTx,
  eventId: EventId,
  field: BuilderField,
  labels: string[],
  mapsTo: BuilderField["mapsTo"],
  fieldType: BuilderField["fieldType"],
): Promise<BuilderField["options"]> {
  if (mapsTo !== "submission.track_id" && mapsTo !== "submission.format_id") {
    return reconcileFreeformOptions(field, labels);
  }
  if (fieldType !== "dropdown") {
    throw new AppError("VALIDATION", `${mapsTo} must use a dropdown field`);
  }

  const vocabulary = mapsTo === "submission.track_id"
    ? await dbOrTx.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId))
    : await dbOrTx.select({ id: sessionFormats.id, name: sessionFormats.name }).from(sessionFormats).where(eq(sessionFormats.eventId, eventId));
  const byLabel = new Map(vocabulary.map((row) => [row.name.trim().toLocaleLowerCase(), row]));
  const seenBindings = new Set<string>();

  return labels.map((label) => label.trim()).filter(Boolean).map((label) => {
    const row = byLabel.get(label.toLocaleLowerCase());
    if (!row) {
      const kind = mapsTo === "submission.track_id" ? "track" : "session format";
      throw new AppError("VALIDATION", `“${label}” is not an event ${kind}. Choose an existing ${kind} before saving.`);
    }
    if (seenBindings.has(row.id)) {
      throw new AppError("VALIDATION", `Each mapped option must reference a different ${mapsTo === "submission.track_id" ? "track" : "session format"}.`);
    }
    seenBindings.add(row.id);
    const existing = field.options.find((option) => mapsTo === "submission.track_id" ? option.trackId === row.id : option.formatId === row.id)
      ?? field.options.find((option) => option.label.trim().toLocaleLowerCase() === row.name.trim().toLocaleLowerCase());
    return mapsTo === "submission.track_id"
      ? { id: existing?.id ?? crypto.randomUUID(), label: row.name, trackId: trackIdSchema.parse(row.id) }
      : { id: existing?.id ?? crypto.randomUUID(), label: row.name, formatId: formatIdSchema.parse(row.id) };
  });
}

export async function updateFieldIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, fieldId: string, patch: FieldPatch, expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const fields = allFields(form);
  const field = fields.find((candidate) => candidate.id === fieldId);
  if (!field) throw new AppError("NOT_FOUND", "Field not found");
  assertNotLockedField(field, patch);
  assertStructuralAllowed(form.hasNonDraftSubmissions, fieldPatchIsStructural(field, patch));
  const nextKey = patch.key === undefined ? field.key : fieldKey(patch.key);
  const nextMapsTo = patch.mapsTo === undefined ? field.mapsTo : patch.mapsTo;
  assertUniqueFieldKey(fields, field.id, nextKey);
  assertUniqueMapsTo(fields, field.id, nextMapsTo);
  assertMapsToMatchesTarget(form.targetType, nextMapsTo);
  const nextType = patch.fieldType ?? field.fieldType;
  const isOptions = nextType === "dropdown" || nextType === "multiselect";
  const acceptsMaxChars = nextType === "text" || nextType === "textarea" || nextType === "richtext";
  const nextOptions = isOptions && (patch.optionLabels !== undefined || nextMapsTo === "submission.track_id" || nextMapsTo === "submission.format_id")
    ? await reconcileOptions(dbOrTx, eventId, field, patch.optionLabels ?? field.options.map((option) => option.label), nextMapsTo, nextType)
    : isOptions ? field.options : [];
  const updated: BuilderField = {
    ...field,
    key: nextKey,
    label: patch.label?.trim() ?? field.label,
    fieldType: patch.fieldType ?? field.fieldType,
    required: patch.required ?? field.required,
    maxChars: acceptsMaxChars ? (patch.maxChars === undefined ? field.maxChars : patch.maxChars) : null,
    helpText: patch.helpText ?? field.helpText,
    visibility: patch.visibility === undefined ? field.visibility : patch.visibility,
    mapsTo: nextMapsTo,
    // A locked contact field can never be opted into a blind reviewer's view,
    // whatever the request says.
    reviewVisibility: field.locked ? "identity" : patch.reviewVisibility ?? field.reviewVisibility,
    options: nextOptions,
  };
  const hypothetical = {
    ...form,
    sections: form.sections.map((section) => ({ ...section, fields: section.fields.map((candidate) => candidate.id === field.id ? updated : candidate) })),
  };
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  await dbOrTx.update(formFields).set({
    label: updated.label,
    key: updated.key,
    fieldType: updated.fieldType,
    required: updated.required,
    maxChars: updated.maxChars,
    helpText: updated.helpText,
    options: updated.options,
    visibility: updated.visibility,
    reviewVisibility: updated.reviewVisibility,
    mapsTo: updated.mapsTo,
    updatedAt: now,
  }).where(and(eq(formFields.id, field.id), eq(formFields.eventId, eventId), eq(formFields.formId, formId)));
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}

export async function deleteFieldIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, fieldId: string, expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const field = allFields(form).find((candidate) => candidate.id === fieldId);
  if (!field) throw new AppError("NOT_FOUND", "Field not found");
  assertNotLockedField(field, { delete: true });
  assertStructuralAllowed(form.hasNonDraftSubmissions, true);
  const hypothetical = { ...form, sections: form.sections.map((section) => ({ ...section, fields: section.fields.filter((candidate) => candidate.id !== field.id) })) };
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  await dbOrTx.update(formFields).set({ deletedAt: now, updatedAt: now })
    .where(and(eq(formFields.id, field.id), eq(formFields.eventId, eventId), eq(formFields.formId, formId)));
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}

// M24-GENERALIZE: "Duplicate" and "Delete" (plan/modules/M24-portal-form-builder.md
// §7) were the two form-level mutations the CFP builder's own route surface
// never exposed — the reference product's admin has both, but no code path
// here ever built them. They are generic across `context`, so they belong
// next to every other form-level mutation in this file rather than as a
// portal-only parallel path (guardrail: "resist building a parallel
// portal-only form-save path" — the whole point of the shared engine).

/**
 * Settings-and-structure-only copy: same context, target type, kind,
 * participant config, and every live section/field with fresh ids — but a
 * new draft (`status='draft'`, `currentVersion=1`, own `row_version`, no
 * submissions, no routing rules, no form_versions history). "Settings only"
 * because it never carries over the submissions/analytics/audit trail that
 * make the source form what it is today, just the shape an organizer would
 * want to iterate on next.
 */
export async function duplicateFormIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<BuilderForm> {
  const source = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const newFormId = formIdSchema.parse(crypto.randomUUID());
  const sectionIdMap = new Map<string, ReturnType<typeof sectionIdSchema.parse>>();
  const sections: FormAuthoringRows["sections"] = source.sections.map((section) => {
    const id = sectionIdSchema.parse(crypto.randomUUID());
    sectionIdMap.set(section.id, id);
    return { id, key: section.key, title: section.title, pageHeading: section.pageHeading, descriptionHtml: section.descriptionHtml, sortOrder: section.sortOrder };
  });
  const fields: FormAuthoringRows["fields"] = source.sections.flatMap((section) => section.fields.map((field) => ({
    id: fieldIdSchema.parse(crypto.randomUUID()),
    sectionId: sectionIdMap.get(section.id) ?? section.id,
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    locked: field.locked,
    maxChars: field.maxChars,
    helpText: field.helpText,
    options: field.options,
    visibility: field.visibility,
    mapsTo: field.mapsTo,
    reviewVisibility: field.reviewVisibility,
    sortOrder: field.sortOrder,
    deletedAt: null,
  })));
  const rows: FormAuthoringRows = { form: { id: newFormId, context: source.context, version: 1 }, sections, fields };
  const snapshot = compileFormSnapshot(rows);
  const now = new Date();
  await dbOrTx.insert(forms).values({
    id: newFormId,
    eventId,
    context: source.context,
    internalName: `${source.internalName} (Copy)`,
    externalTitle: source.externalTitle,
    pageHeading: source.pageHeading,
    status: "draft",
    kind: source.kind,
    collectParticipants: source.collectParticipants,
    targetType: source.targetType,
    showWelcome: source.showWelcome,
    welcomeHtml: source.welcomeHtml,
    successHtml: source.successHtml,
    autoRedirectToPortal: source.autoRedirectToPortal,
    participantRoles: source.participantRoles.map((role) => ({ ...role, min: null, max: null })),
    sendConfirmation: source.sendConfirmation,
    confirmationSubject: source.confirmationSubject,
    confirmationBodyHtml: source.confirmationBodyHtml,
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await dbOrTx.insert(formSections).values(sections.map((section) => ({ ...section, eventId, formId: newFormId })));
  if (fields.length > 0) {
    await dbOrTx.insert(formFields).values(fields.map((field) => ({
      id: field.id,
      eventId,
      formId: newFormId,
      sectionId: field.sectionId,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      locked: field.locked,
      maxChars: field.maxChars,
      helpText: field.helpText,
      options: field.options,
      visibility: field.visibility,
      mapsTo: field.mapsTo,
      reviewVisibility: field.reviewVisibility ?? "identity",
      sortOrder: field.sortOrder,
    })));
  }
  await dbOrTx.insert(formVersions).values({ eventId, formId: newFormId, version: 1, snapshot });
  return getFormForBuilderIn(dbOrTx, eventId, newFormId);
}

export function duplicateForm(eventId: EventId, formId: FormId): Promise<BuilderForm> {
  return duplicateFormIn(db, eventId, formId);
}

/**
 * RESTRICT (`portal_tasks.form_id` → `forms.id` ON DELETE RESTRICT) is the
 * backstop; this precheck turns that constraint violation into the same
 * organizer-facing copy M23 already shows for a referenced file request
 * (`features/portal/tasks-admin/server/mutations.ts#deleteFileRequestIn`) —
 * the two call sites live in different modules' owned files so the string
 * can't be a single shared import without crossing that boundary, but the
 * wording is kept identical on purpose (M24 §7: "shared error code, not a
 * duplicated copy of the string" — same `CONFLICT` code, same UX copy).
 *
 * Two further prechecks, added alongside the task-reference one above:
 *
 * - `form_responses.form_id` → `forms.id` is ON DELETE CASCADE (unlike the
 *   RESTRICT `portal_tasks` FK), so nothing at the database layer stops a
 *   delete from silently wiping every portal response ever collected against
 *   this form — a task getting deleted or reverted to Manual (both reachable
 *   from M23's tasks-admin UI) is enough to clear the RESTRICT above while
 *   leaving responses behind. This is checked explicitly rather than relying
 *   on a constraint, because CASCADE never raises anything to catch.
 * - CFP forms have no `portal_tasks`/`form_responses` row at all but can
 *   still carry live `submissions` — this route is generic across context
 *   (reachable via `DELETE /api/internal/forms/[formId]` for a `cfp` form
 *   just as much as a `portal` one), so it needs the same
 *   hasNonDraftSubmissions check `updateFormIn`'s structural-edit guard
 *   already applies, or a CFP form with real submissions could be deleted
 *   out from under them.
 *
 * Both reuse the `CONFLICT` code the task-reference precheck already uses —
 * "can't delete this, something depends on it" is one organizer-facing
 * category, not three.
 */
export async function deleteFormIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<void> {
  const inUse = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM portal_tasks WHERE event_id = ${eventId} AND form_id = ${formId}
  `);
  if (Number((inUse.rows ?? [])[0]?.n ?? 0) > 0) {
    throw new AppError("CONFLICT", "This form/file request is used by a task. Revert the task to Manual first.");
  }
  if (await hasNonDraftSubmissionsIn(dbOrTx, eventId, formId)) {
    throw new AppError("CONFLICT", "This form has submissions and cannot be deleted. Duplicate it if you need a fresh copy to edit.");
  }
  const hasResponses = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM form_responses WHERE event_id = ${eventId} AND form_id = ${formId}
  `);
  if (Number((hasResponses.rows ?? [])[0]?.n ?? 0) > 0) {
    throw new AppError("CONFLICT", "This form has collected responses and cannot be deleted.");
  }
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM forms WHERE id = ${formId} AND event_id = ${eventId} RETURNING id
  `);
  if ((result.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Form not found");
}

export function deleteForm(eventId: EventId, formId: FormId): Promise<void> {
  return deleteFormIn(db, eventId, formId);
}

export async function reorderFieldsIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId, sectionId: string, orderedFieldIds: string[], expectedUpdatedAt: string): Promise<BuilderForm> {
  const form = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const section = form.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new AppError("NOT_FOUND", "Section not found");
  const expected = new Set(section.fields.map((field) => field.id));
  if (orderedFieldIds.length !== expected.size || new Set(orderedFieldIds).size !== expected.size || orderedFieldIds.some((id) => !expected.has(id as never))) {
    throw new AppError("VALIDATION", "Reorder must contain every live field in the section exactly once");
  }
  const byId = new Map(section.fields.map((field) => [field.id, field]));
  const reordered = orderedFieldIds.map((id, sortOrder) => {
    const field = byId.get(id as never);
    if (!field) throw new AppError("VALIDATION", "Reorder contains an unknown field");
    return { ...field, sortOrder };
  });
  const hypothetical = { ...form, sections: form.sections.map((candidate) => candidate.id === section.id ? { ...candidate, fields: reordered } : candidate) };
  const snapshot = nextSnapshot(hypothetical);
  const now = new Date();
  await touchFormIn(dbOrTx, eventId, form, expectedUpdatedAt, now);
  const values = orderedFieldIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`);
  await dbOrTx.execute(sql`
    UPDATE form_fields AS field
    SET sort_order = ordered.sort_order, updated_at = ${now}
    FROM (VALUES ${sql.join(values, sql`, `)}) AS ordered(id, sort_order)
    WHERE field.id = ordered.id AND field.event_id = ${eventId} AND field.form_id = ${formId} AND field.section_id = ${section.id}
  `);
  await storeVersionIn(dbOrTx, eventId, form, snapshot);
  return getFormForBuilderIn(dbOrTx, eventId, formId);
}
