import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import {
  contacts,
  organizationContactActivity,
  organizationContactCustomFields,
  organizationContactLinks,
  organizationContactNotes,
  organizationContactPipeline,
  organizationContactPipelineHistory,
  organizationContactSegments,
  organizationContactTagLinks,
  organizationContactTags,
  organizationContacts,
  users,
} from "@/db/schema";
import { getEventOrganizationIn } from "@/features/organizations";
import { getOrCreateContact, updateContactFields, type ContactPatch } from "@/features/portal/index.contacts";
import {
  crmCustomFieldDtoSchema,
  crmNoteDtoSchema,
  crmPipelineEntryDtoSchema,
  crmSegmentDtoSchema,
  crmTagDtoSchema,
  organizationContactIdSchema,
  pushOrganizationContactToEventResultSchema,
  type CrmActivityKind,
  type CreateCrmCustomFieldInput,
  type CreateCrmNoteInput,
  type CreateCrmPipelineEntryInput,
  type CreateCrmSegmentInput,
  type CreateCrmTagInput,
  type CreateOrganizationContactInput,
  type CrmCustomFieldDTO,
  type CrmNoteDTO,
  type CrmPipelineEntryDTO,
  type CrmPipelineId,
  type CrmSegmentDTO,
  type CrmTagDTO,
  type CrmTagId,
  type EventId,
  type OrganizationContactId,
  type OrganizationId,
  type PushOrganizationContactToEventResult,
  type SetCrmContactTagsInput,
  type TransitionCrmPipelineInput,
  type UpdateOrganizationContactInput,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { sanitize } from "@/shared/lib/sanitize";
import { getOrganizationContactIn } from "./queries";

/**
 * M55 — organization-level speaker CRM writes. None of these is one of the
 * audited `withTx` functions (PLAN resolution #4): each is a small number of
 * guarded single-statement writes over the plain `neon-http` handle, the
 * same discipline M51's roster mutations use — except
 * `mergeOrganizationContactsIn`, which lives in `./merge.ts` and *is* the
 * 10th function added to the audit list this run.
 *
 * `pushOrganizationContactToEventIn` is this module's one exception to
 * "never a second contacts writer": it calls the two owning helpers
 * (`getOrCreateContact`/`updateContactFields`, resolution #13) exactly the
 * way M51's `createSpeakerIn` does — never a direct `INSERT`/`UPDATE` on
 * `contacts`.
 */

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return causeCode === "23505";
}

// `getOrCreateContact` types its parameter as `TxDb` because its other
// callers are audited transactional writers; every M51/M55 single-statement
// caller casts through this same idiom (see `speaker-bulk.ts`'s
// `asOutboxWriter` and `admin-speakers-mutations.ts`) rather than opening a
// real transaction for what is, on `neon-http`, one guarded statement.
function asContactWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

async function recordActivityIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  organizationContactId: OrganizationContactId,
  kind: CrmActivityKind,
  actorUserId?: UserId | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await dbOrTx.insert(organizationContactActivity).values({
    organizationId, organizationContactId, kind, actorUserId: actorUserId ?? null, metadata: metadata ?? {},
  });
}

async function assertContactInOrgIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId): Promise<void> {
  const [row] = await dbOrTx.select({ id: organizationContacts.id, mergedIntoId: organizationContacts.mergedIntoId })
    .from(organizationContacts)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, id)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Contact not found");
  if (row.mergedIntoId) throw new AppError("CONFLICT", "This contact was merged into another one; use the primary contact instead", { mergedIntoId: row.mergedIntoId });
}

// --- Contacts ---------------------------------------------------------------

async function insertOrganizationContactIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateOrganizationContactInput): Promise<OrganizationContactId> {
  let row: typeof organizationContacts.$inferSelect | undefined;
  try {
    [row] = await dbOrTx.insert(organizationContacts).values({
      organizationId,
      // Normalized defensively here (not only by the route's zod schema,
      // which already lowercases/trims) — the same "the writer never trusts
      // the caller" discipline `getOrCreateContact` applies, and it is what
      // keeps `organization_contacts_email_check` satisfied for every
      // caller, including PGlite tests that call this function directly.
      email: input.email.trim().toLowerCase(),
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      company: input.company || null,
      jobTitle: input.jobTitle || null,
      linkedinUrl: input.linkedinUrl || null,
      twitterUrl: input.twitterUrl || null,
      websiteUrl: input.websiteUrl || null,
      source: "manual",
    }).returning();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "A contact with this email already exists in this organization.", { field: "email" });
    throw error;
  }
  if (!row) throw new AppError("INTERNAL", "Contact insert did not return a row");
  return organizationContactIdSchema.parse(row.id);
}

export async function createOrganizationContactIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateOrganizationContactInput): Promise<OrganizationContactId> {
  const id = await insertOrganizationContactIn(dbOrTx, organizationId, input);
  await recordActivityIn(dbOrTx, organizationId, id, "created", null, { source: "manual" });
  return id;
}

/**
 * Manual creation runs on the nontransactional neon-http handle: its contact
 * insert commits before the activity write starts. Keep that committed identity
 * authoritative even if the contextual activity trail cannot be recorded.
 * Transactional callers must use `createOrganizationContactIn`, where an
 * activity failure rejects the transaction instead of being swallowed.
 */
export async function createOrganizationContactWithPostCommitActivityIn(
  database: typeof db,
  organizationId: OrganizationId,
  input: CreateOrganizationContactInput,
): Promise<OrganizationContactId> {
  const id = await insertOrganizationContactIn(database, organizationId, input);
  try {
    await recordActivityIn(database, organizationId, id, "created", null, { source: "manual" });
  } catch (error) {
    log({
      level: "warn",
      msg: "crm.contact_created_activity_failed",
      requestId: id,
      feature: "crm",
      code: error instanceof Error ? error.message : String(error),
    });
  }
  return id;
}
export const createOrganizationContact = (organizationId: OrganizationId, input: CreateOrganizationContactInput): Promise<OrganizationContactId> =>
  createOrganizationContactWithPostCommitActivityIn(db, organizationId, input);

export async function updateOrganizationContactIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId, input: UpdateOrganizationContactInput): Promise<void> {
  const current = await getOrganizationContactIn(dbOrTx, organizationId, id);
  if (!current) throw new AppError("NOT_FOUND", "Contact not found");
  if (current.mergedIntoId) throw new AppError("CONFLICT", "This contact was merged into another one; use the primary contact instead", { mergedIntoId: current.mergedIntoId });

  const patch: Partial<typeof organizationContacts.$inferInsert> = { updatedAt: new Date() };
  const changed: string[] = [];
  if (input.firstName !== undefined) { patch.firstName = input.firstName; changed.push("firstName"); }
  if (input.lastName !== undefined) { patch.lastName = input.lastName; changed.push("lastName"); }
  if (input.company !== undefined) { patch.company = input.company || null; changed.push("company"); }
  if (input.jobTitle !== undefined) { patch.jobTitle = input.jobTitle || null; changed.push("jobTitle"); }
  if (input.linkedinUrl !== undefined) { patch.linkedinUrl = input.linkedinUrl || null; changed.push("linkedinUrl"); }
  if (input.twitterUrl !== undefined) { patch.twitterUrl = input.twitterUrl || null; changed.push("twitterUrl"); }
  if (input.websiteUrl !== undefined) { patch.websiteUrl = input.websiteUrl || null; changed.push("websiteUrl"); }
  if (input.customFields) {
    patch.customFields = { ...current.customFields, ...input.customFields };
    changed.push("customFields");
  }
  if (changed.length === 0) return;

  const [updated] = await dbOrTx.update(organizationContacts).set(patch)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, id)))
    .returning();
  if (!updated) throw new AppError("NOT_FOUND", "Contact not found");
  await recordActivityIn(dbOrTx, organizationId, id, "field_changed", null, { fields: changed });
}
export const updateOrganizationContact = (organizationId: OrganizationId, id: OrganizationContactId, input: UpdateOrganizationContactInput): Promise<void> =>
  updateOrganizationContactIn(db, organizationId, id, input);

// --- Tags --------------------------------------------------------------------

export async function createCrmTagIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateCrmTagInput): Promise<CrmTagDTO> {
  try {
    const [row] = await dbOrTx.insert(organizationContactTags).values({ organizationId, name: input.name, color: input.color }).returning();
    if (!row) throw new AppError("INTERNAL", "Tag insert did not return a row");
    return crmTagDtoSchema.parse({ id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.toISOString() });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "A tag with this name already exists.", { field: "name" });
    throw error;
  }
}
export const createCrmTag = (organizationId: OrganizationId, input: CreateCrmTagInput): Promise<CrmTagDTO> => createCrmTagIn(db, organizationId, input);

/** Full-set replace, same "add/edit/remove in one save" shape as M51's
 * `replaceSpeakerUnavailabilityIn`, over two guarded statements rather than
 * one CTE (tag membership is much lower-stakes than a blackout interval). */
export async function setCrmContactTagsIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId, input: SetCrmContactTagsInput): Promise<void> {
  await assertContactInOrgIn(dbOrTx, organizationId, id);
  const wantedIds = input.tagIds;
  if (wantedIds.length > 0) {
    const known = await dbOrTx.select({ id: organizationContactTags.id }).from(organizationContactTags)
      .where(and(eq(organizationContactTags.organizationId, organizationId), inArray(organizationContactTags.id, wantedIds)));
    if (known.length !== wantedIds.length) throw new AppError("VALIDATION", "One of these tags no longer exists");
  }
  const before = await dbOrTx.select({ tagId: organizationContactTagLinks.tagId }).from(organizationContactTagLinks)
    .where(eq(organizationContactTagLinks.organizationContactId, id));
  const beforeSet = new Set(before.map((row) => row.tagId));
  const wantedSet = new Set<string>(wantedIds);
  const toAdd = wantedIds.filter((tagId) => !beforeSet.has(tagId));
  const toRemove = [...beforeSet].filter((tagId) => !wantedSet.has(tagId)) as CrmTagId[];

  if (toRemove.length > 0) {
    await dbOrTx.delete(organizationContactTagLinks)
      .where(and(eq(organizationContactTagLinks.organizationContactId, id), inArray(organizationContactTagLinks.tagId, toRemove)));
  }
  if (toAdd.length > 0) {
    await dbOrTx.insert(organizationContactTagLinks)
      .values(toAdd.map((tagId) => ({ organizationId, organizationContactId: id, tagId })))
      .onConflictDoNothing({ target: [organizationContactTagLinks.organizationContactId, organizationContactTagLinks.tagId] });
  }
  if (toAdd.length > 0) await recordActivityIn(dbOrTx, organizationId, id, "tag_added", null, { tagIds: toAdd });
  if (toRemove.length > 0) await recordActivityIn(dbOrTx, organizationId, id, "tag_removed", null, { tagIds: toRemove });
}
export const setCrmContactTags = (organizationId: OrganizationId, id: OrganizationContactId, input: SetCrmContactTagsInput): Promise<void> =>
  setCrmContactTagsIn(db, organizationId, id, input);

// --- Custom fields -------------------------------------------------------

export async function createCrmCustomFieldIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateCrmCustomFieldInput): Promise<CrmCustomFieldDTO> {
  try {
    const [row] = await dbOrTx.insert(organizationContactCustomFields).values({
      organizationId, key: input.key, label: input.label, fieldType: input.fieldType, options: input.options,
    }).returning();
    if (!row) throw new AppError("INTERNAL", "Custom field insert did not return a row");
    return crmCustomFieldDtoSchema.parse({ id: row.id, key: row.key, label: row.label, fieldType: row.fieldType, options: row.options, sortOrder: row.sortOrder });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "A custom field with this key already exists.", { field: "key" });
    throw error;
  }
}
export const createCrmCustomField = (organizationId: OrganizationId, input: CreateCrmCustomFieldInput): Promise<CrmCustomFieldDTO> =>
  createCrmCustomFieldIn(db, organizationId, input);

// --- Notes -----------------------------------------------------------------

export async function createCrmNoteIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId, input: CreateCrmNoteInput, actorUserId: UserId | null): Promise<CrmNoteDTO> {
  await assertContactInOrgIn(dbOrTx, organizationId, id);
  const [inserted] = await dbOrTx.insert(organizationContactNotes).values({
    id: input.noteId,
    organizationId,
    organizationContactId: id,
    authorUserId: actorUserId,
    bodyHtml: sanitize(input.bodyHtml),
  }).onConflictDoNothing().returning();

  const [note] = await dbOrTx.select({
    id: organizationContactNotes.id,
    bodyHtml: organizationContactNotes.bodyHtml,
    authorUserId: organizationContactNotes.authorUserId,
    authorName: users.name,
    createdAt: organizationContactNotes.createdAt,
  }).from(organizationContactNotes)
    .leftJoin(users, eq(users.id, organizationContactNotes.authorUserId))
    .where(and(
      eq(organizationContactNotes.id, input.noteId),
      eq(organizationContactNotes.organizationId, organizationId),
      eq(organizationContactNotes.organizationContactId, id),
    ))
    .limit(1);
  if (!note) throw new AppError("CONFLICT", "That note request ID is already in use");

  if (inserted) await recordActivityIn(dbOrTx, organizationId, id, "note_added", actorUserId, { noteId: note.id });
  return crmNoteDtoSchema.parse({ ...note, createdAt: note.createdAt.toISOString() });
}
export const createCrmNote = (organizationId: OrganizationId, id: OrganizationContactId, input: CreateCrmNoteInput, actorUserId: UserId | null): Promise<CrmNoteDTO> =>
  createCrmNoteIn(db, organizationId, id, input, actorUserId);

// --- Segments ----------------------------------------------------------------

export async function createCrmSegmentIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateCrmSegmentInput, actorUserId: UserId | null): Promise<CrmSegmentDTO> {
  try {
    const [row] = await dbOrTx.insert(organizationContactSegments).values({
      organizationId, name: input.name, filter: input.filter, createdByUserId: actorUserId,
    }).returning();
    if (!row) throw new AppError("INTERNAL", "Segment insert did not return a row");
    return crmSegmentDtoSchema.parse({ id: row.id, name: row.name, filter: row.filter, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "A segment with this name already exists.", { field: "name" });
    throw error;
  }
}
export const createCrmSegment = (organizationId: OrganizationId, input: CreateCrmSegmentInput, actorUserId: UserId | null): Promise<CrmSegmentDTO> =>
  createCrmSegmentIn(db, organizationId, input, actorUserId);

// --- Push into an event (reuses M51's contact writers) ---------------------

/**
 * AC: "Push an existing organization contact into a new event; M51 shows
 * the speaker without duplicating the organization identity." Idempotent on
 * both halves: `getOrCreateContact` never creates a second event contact for
 * the same (event, email), and the link insert below is `onConflictDoNothing`
 * on `(event_id, contact_id)`, so pushing the same pair twice changes
 * nothing the second time.
 */
export async function pushOrganizationContactToEventIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId, eventId: EventId): Promise<PushOrganizationContactToEventResult> {
  const orgContact = await getOrganizationContactIn(dbOrTx, organizationId, id);
  if (!orgContact) throw new AppError("NOT_FOUND", "Contact not found");
  if (orgContact.mergedIntoId) throw new AppError("CONFLICT", "This contact was merged into another one; use the primary contact instead", { mergedIntoId: orgContact.mergedIntoId });

  const eventOrgId = await getEventOrganizationIn(dbOrTx, eventId);
  if (eventOrgId !== organizationId) throw new AppError("NOT_FOUND", "Event not found in this organization");

  const existingContact = await dbOrTx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.email, orgContact.email))).limit(1);
  const contactId = await getOrCreateContact(asContactWriter(dbOrTx), eventId, orgContact.email);
  const created = existingContact.length === 0;

  if (created) {
    const seed: ContactPatch = {};
    if (orgContact.firstName) seed.firstName = orgContact.firstName;
    if (orgContact.lastName) seed.lastName = orgContact.lastName;
    if (orgContact.company) seed.company = orgContact.company;
    if (orgContact.jobTitle) seed.jobTitle = orgContact.jobTitle;
    if (orgContact.linkedinUrl) seed.linkedinUrl = orgContact.linkedinUrl;
    if (orgContact.twitterUrl) seed.twitterUrl = orgContact.twitterUrl;
    if (orgContact.websiteUrl) seed.websiteUrl = orgContact.websiteUrl;
    if (Object.keys(seed).length > 0) await updateContactFields(dbOrTx, eventId, contactId, seed);
  }

  const [linkRow] = await dbOrTx.insert(organizationContactLinks)
    .values({ organizationId, organizationContactId: id, eventId, contactId })
    .onConflictDoNothing({ target: [organizationContactLinks.eventId, organizationContactLinks.contactId] })
    .returning();
  const alreadyLinked = !linkRow;

  if (!alreadyLinked) await recordActivityIn(dbOrTx, organizationId, id, "event_linked", null, { eventId });

  return pushOrganizationContactToEventResultSchema.parse({ contactId, created, alreadyLinked });
}
export const pushOrganizationContactToEvent = (organizationId: OrganizationId, id: OrganizationContactId, eventId: EventId): Promise<PushOrganizationContactToEventResult> =>
  pushOrganizationContactToEventIn(db, organizationId, id, eventId);

// --- Sourcing pipeline -------------------------------------------------------

export async function createCrmPipelineEntryIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: CreateCrmPipelineEntryInput): Promise<CrmPipelineEntryDTO> {
  await assertContactInOrgIn(dbOrTx, organizationId, input.organizationContactId);
  if (input.targetEventId) {
    const eventOrgId = await getEventOrganizationIn(dbOrTx, input.targetEventId);
    if (eventOrgId !== organizationId) throw new AppError("VALIDATION", "Target event does not belong to this organization");
  }
  const [row] = await dbOrTx.insert(organizationContactPipeline).values({
    organizationId, organizationContactId: input.organizationContactId, targetEventId: input.targetEventId ?? null, notes: input.notes ?? null,
  }).returning();
  if (!row) throw new AppError("INTERNAL", "Pipeline insert did not return a row");
  await dbOrTx.insert(organizationContactPipelineHistory).values({ organizationId, pipelineId: row.id, fromStage: null, toStage: "open" });
  await recordActivityIn(dbOrTx, organizationId, input.organizationContactId, "pipeline_created", null, { pipelineId: row.id, targetEventId: input.targetEventId ?? null });
  return crmPipelineEntryDtoSchema.parse({
    id: row.id, organizationContactId: row.organizationContactId, targetEventId: row.targetEventId, stage: row.stage,
    notes: row.notes, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}
export const createCrmPipelineEntry = (organizationId: OrganizationId, input: CreateCrmPipelineEntryInput): Promise<CrmPipelineEntryDTO> =>
  createCrmPipelineEntryIn(db, organizationId, input);

/** AC: "Move a prospect through open/won/lost states and verify timestamped
 * history." Guarded `UPDATE … WHERE stage <> $newStage` so a repeat call
 * (double-click, retry) is a no-op rather than a spurious history row — the
 * `from_stage IS DISTINCT FROM to_stage` CHECK on the history table backs
 * this at the schema level too. */
export async function transitionCrmPipelineIn(dbOrTx: DbOrTx, organizationId: OrganizationId, pipelineId: CrmPipelineId, input: TransitionCrmPipelineInput, actorUserId: UserId | null): Promise<CrmPipelineEntryDTO> {
  const [current] = await dbOrTx.select().from(organizationContactPipeline)
    .where(and(eq(organizationContactPipeline.organizationId, organizationId), eq(organizationContactPipeline.id, pipelineId))).limit(1);
  if (!current) throw new AppError("NOT_FOUND", "Pipeline entry not found");
  if (current.stage === input.stage) {
    return crmPipelineEntryDtoSchema.parse({
      id: current.id, organizationContactId: current.organizationContactId, targetEventId: current.targetEventId, stage: current.stage,
      notes: current.notes, createdAt: current.createdAt.toISOString(), updatedAt: current.updatedAt.toISOString(),
    });
  }
  const [updated] = await dbOrTx.update(organizationContactPipeline).set({ stage: input.stage, updatedAt: new Date() })
    .where(and(eq(organizationContactPipeline.id, pipelineId), eq(organizationContactPipeline.organizationId, organizationId), eq(organizationContactPipeline.stage, current.stage)))
    .returning();
  if (!updated) throw new AppError("CONFLICT", "This pipeline entry changed under you; reload and try again");
  await dbOrTx.insert(organizationContactPipelineHistory).values({
    organizationId, pipelineId, fromStage: current.stage, toStage: input.stage, actorUserId: actorUserId ?? null,
  });
  await recordActivityIn(dbOrTx, organizationId, organizationContactIdSchema.parse(updated.organizationContactId), "pipeline_stage_changed", actorUserId, { pipelineId, from: current.stage, to: input.stage });
  return crmPipelineEntryDtoSchema.parse({
    id: updated.id, organizationContactId: updated.organizationContactId, targetEventId: updated.targetEventId, stage: updated.stage,
    notes: updated.notes, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(),
  });
}
export const transitionCrmPipeline = (organizationId: OrganizationId, pipelineId: CrmPipelineId, input: TransitionCrmPipelineInput, actorUserId: UserId | null): Promise<CrmPipelineEntryDTO> =>
  transitionCrmPipelineIn(db, organizationId, pipelineId, input, actorUserId);
