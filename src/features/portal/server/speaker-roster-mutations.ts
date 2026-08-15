import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts, speakerLogisticsFields, speakerLogisticsValues } from "@/db/schema";
import {
  logisticsFieldIdSchema,
  SPEAKER_CSV_FIELDS,
  unavailabilityIdSchema,
  type ContactId,
  type CreateLogisticsFieldInput,
  type CreateSpeakerInput,
  type EventId,
  type ImportSpeakersCsvInput,
  type ImportSpeakersCsvResult,
  type SpeakerCsvField,
  type SpeakerCsvRowOutcome,
  type SpeakerLogisticsFieldDTO,
  type SpeakerUnavailability,
  type UnavailabilityIntervalInput,
  type UpdateSpeakerProfileInput,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getOrCreateContact, updateContactFields, type ContactPatch } from "@/features/event-contacts";
import { parseCsv, readSpeakerCsvRows } from "./speaker-csv";


function contactPatchFrom(input: CreateSpeakerInput | UpdateSpeakerProfileInput): ContactPatch {
  const patch: ContactPatch = {};
  if (input.firstName !== undefined) patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
  if (input.jobTitle !== undefined) patch.jobTitle = input.jobTitle || null;
  if (input.company !== undefined) patch.company = input.company || null;
  if (input.linkedinUrl !== undefined) patch.linkedinUrl = input.linkedinUrl || null;
  if (input.twitterUrl !== undefined) patch.twitterUrl = input.twitterUrl || null;
  if ("facebookUrl" in input && input.facebookUrl !== undefined) patch.facebookUrl = input.facebookUrl || null;
  if (input.websiteUrl !== undefined) patch.websiteUrl = input.websiteUrl || null;
  if (input.workflowStatus !== undefined) patch.workflowStatus = input.workflowStatus;
  return patch;
}

/** Manual "Add speaker" (work order step 2). Idempotent on email like every
 * other contact entry point (resolution #13's normalized identity guardrail)
 * — a second create against an email already on file updates that contact's
 * fields rather than erroring, matching CSV import's own upsert semantics. */
export async function createSpeakerIn(dbOrTx: DbOrTx, eventId: EventId, input: CreateSpeakerInput): Promise<ContactId> {
  const contactId = await getOrCreateContact(dbOrTx, eventId, input.email);
  const patch = contactPatchFrom(input);
  if (Object.keys(patch).length > 0) await updateContactFields(dbOrTx, eventId, contactId, patch);
  return contactId;
}

export function createSpeaker(eventId: EventId, input: CreateSpeakerInput): Promise<ContactId> {
  return createSpeakerIn(db, eventId, input);
}

/**
 * Full organizer edit (work order step 2): identity/profile fields through
 * `updateContactFields` as one field-scoped write, plus zero or more
 * per-contact logistics-field values as a second, independent multi-row
 * upsert. Neither is one of the eight `withTx`-audited functions.
 */
export async function updateSpeakerProfileIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId, input: UpdateSpeakerProfileInput): Promise<void> {
  const patch = contactPatchFrom(input);
  if (Object.keys(patch).length > 0) await updateContactFields(dbOrTx, eventId, contactId, patch);

  const entries = Object.entries(input.logisticsValues ?? {});
  if (entries.length === 0) return;
  const fieldIds = entries.map(([fieldId]) => logisticsFieldIdSchema.parse(fieldId));
  const known = await dbOrTx.select({ id: speakerLogisticsFields.id }).from(speakerLogisticsFields)
    .where(and(eq(speakerLogisticsFields.eventId, eventId), inArray(speakerLogisticsFields.id, fieldIds)));
  const knownIds = new Set(known.map((row) => row.id));
  // Reject the whole batch on one bad id rather than silently writing the
  // rest — a stale field picker (deleted between page load and save) must
  // not leave the caller believing every value it sent was saved.
  const unknown = fieldIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) throw new AppError("VALIDATION", "One of these logistics fields no longer exists on this event");

  await dbOrTx.insert(speakerLogisticsValues).values(entries.map(([fieldId, value]) => ({
    eventId,
    fieldId: logisticsFieldIdSchema.parse(fieldId),
    contactId,
    value,
    updatedAt: new Date(),
  }))).onConflictDoUpdate({
    target: [speakerLogisticsValues.fieldId, speakerLogisticsValues.contactId],
    set: { value: sql`excluded.value`, updatedAt: sql`now()` },
  });
}

export function updateSpeakerProfile(eventId: EventId, contactId: ContactId, input: UpdateSpeakerProfileInput): Promise<void> {
  return updateSpeakerProfileIn(db, eventId, contactId, input);
}

export async function createLogisticsFieldIn(dbOrTx: DbOrTx, eventId: EventId, input: CreateLogisticsFieldInput): Promise<SpeakerLogisticsFieldDTO> {
  const [nextRow] = await dbOrTx.select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
    .from(speakerLogisticsFields).where(eq(speakerLogisticsFields.eventId, eventId));
  const [inserted] = await dbOrTx.insert(speakerLogisticsFields).values({
    eventId,
    key: input.key,
    label: input.label,
    fieldType: input.fieldType,
    options: input.fieldType === "select" ? input.options : [],
    sortOrder: nextRow?.next ?? 0,
  }).onConflictDoNothing({ target: [speakerLogisticsFields.eventId, speakerLogisticsFields.key] }).returning();
  if (!inserted) throw new AppError("CONFLICT", "A logistics field with that key already exists on this event", { field: "key" });
  return {
    id: logisticsFieldIdSchema.parse(inserted.id),
    key: inserted.key,
    label: inserted.label,
    fieldType: inserted.fieldType,
    options: inserted.options,
    sortOrder: inserted.sortOrder,
  };
}

export function createLogisticsField(eventId: EventId, input: CreateLogisticsFieldInput): Promise<SpeakerLogisticsFieldDTO> {
  return createLogisticsFieldIn(db, eventId, input);
}

export async function deleteLogisticsFieldIn(dbOrTx: DbOrTx, eventId: EventId, fieldId: string): Promise<void> {
  await dbOrTx.delete(speakerLogisticsFields).where(and(eq(speakerLogisticsFields.eventId, eventId), eq(speakerLogisticsFields.id, fieldId)));
}

export function deleteLogisticsField(eventId: EventId, fieldId: string): Promise<void> {
  return deleteLogisticsFieldIn(db, eventId, fieldId);
}

// --- Unavailability ----------------------------------------------------

function timestamptzArraySql(values: readonly string[]): SQL {
  if (values.length === 0) return sql`'{}'::timestamptz[]`;
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}::timestamptz`), sql`, `)}]`;
}
function nullableTextArraySql(values: readonly (string | null)[]): SQL {
  if (values.length === 0) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(values.map((value) => value === null ? sql`NULL::text` : sql`${value}::text`), sql`, `)}]`;
}

type UnavailabilityRow = { id: string; contact_id: string; starts_at: Date | string; ends_at: Date | string; reason: string | null };

/**
 * Full-set replace, one guarded CTE (work order): delete every existing
 * interval for this contact, then insert the whole new set, in the same
 * statement. A single SQL statement is atomic on its own — there is no
 * window in which a reader sees zero or a half-written set, and no ninth
 * `withTx` is needed to get that guarantee. Timestamps arrive already as UTC
 * ISO strings (the editor converts from the event timezone before calling
 * this); the column type stores UTC regardless.
 */
export async function replaceSpeakerUnavailabilityIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  intervals: UnavailabilityIntervalInput[],
): Promise<SpeakerUnavailability[]> {
  const starts = intervals.map((interval) => interval.startsAt);
  const ends = intervals.map((interval) => interval.endsAt);
  const reasons = intervals.map((interval) => interval.reason ?? null);
  const result = await dbOrTx.execute<UnavailabilityRow>(sql`
    WITH deleted AS (
      DELETE FROM contact_unavailability WHERE event_id = ${eventId} AND contact_id = ${contactId}
    ), inserted AS (
      INSERT INTO contact_unavailability (event_id, contact_id, starts_at, ends_at, reason)
      SELECT ${eventId}, ${contactId}, x.starts_at, x.ends_at, x.reason
      FROM unnest(${timestamptzArraySql(starts)}, ${timestamptzArraySql(ends)}, ${nullableTextArraySql(reasons)})
        AS x(starts_at, ends_at, reason)
      RETURNING id, contact_id, starts_at, ends_at, reason
    )
    SELECT * FROM inserted ORDER BY starts_at
  `);
  return (result.rows ?? []).map((row) => ({
    id: unavailabilityIdSchema.parse(row.id),
    contactId: row.contact_id as ContactId,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    reason: row.reason,
  }));
}

export function replaceSpeakerUnavailability(eventId: EventId, contactId: ContactId, intervals: UnavailabilityIntervalInput[]): Promise<SpeakerUnavailability[]> {
  return replaceSpeakerUnavailabilityIn(db, eventId, contactId, intervals);
}

// --- CSV import ----------------------------------------------------------

type ContactSnapshot = Partial<Record<SpeakerCsvField, string | null>>;

/** Only the fields the CSV row actually carries AND the contact's current
 * value is empty for — this is the "never overwrite a non-empty field
 * silently" guardrail, computed identically at preview and at commit. */
function proposedPatch(values: Partial<Record<SpeakerCsvField, string>>, current: ContactSnapshot): { patch: ContactPatch; changedFields: SpeakerCsvField[] } {
  const patch: ContactPatch = {};
  const changedFields: SpeakerCsvField[] = [];
  for (const field of SPEAKER_CSV_FIELDS) {
    const incoming = values[field];
    if (!incoming) continue;
    const existingValue = current[field];
    if (existingValue && existingValue.trim() !== "") continue;
    (patch as Record<SpeakerCsvField, string>)[field] = incoming;
    changedFields.push(field);
  }
  return { patch, changedFields };
}

/**
 * Preview and commit share one pass over the parsed rows so the two can never
 * disagree about which fields would change (work order guardrail: "the
 * preview names every proposed change"). Commit re-reads each contact's
 * current fields immediately before writing it — never the batch snapshot
 * taken for the whole file — so a retried commit (the AC's "valid rows are
 * committed exactly once on retry") only ever writes a field that is *still*
 * empty, and never overwrites a value another edit filled in between the
 * preview and the click.
 */
export async function importSpeakersCsvIn(dbOrTx: DbOrTx, eventId: EventId, input: ImportSpeakersCsvInput): Promise<ImportSpeakersCsvResult> {
  const table = parseCsv(input.csvText);
  const parsed = readSpeakerCsvRows(table, input.mapping);

  const seen = new Set<string>();
  const classified = parsed.map((row) => {
    if (row.error || !row.email) return { ...row, duplicate: false };
    if (seen.has(row.email)) return { ...row, duplicate: true };
    seen.add(row.email);
    return { ...row, duplicate: false };
  });

  const candidateEmails = [...new Set(classified.filter((row) => row.email && !row.error && !row.duplicate).map((row) => row.email as string))];
  const existingRows = candidateEmails.length > 0
    ? await dbOrTx.select({
      email: contacts.email,
      firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, company: contacts.company,
      linkedinUrl: contacts.linkedinUrl, twitterUrl: contacts.twitterUrl, websiteUrl: contacts.websiteUrl,
    }).from(contacts).where(and(eq(contacts.eventId, eventId), inArray(contacts.email, candidateEmails)))
    : [];
  const byEmail = new Map(existingRows.map((row) => [row.email, row as ContactSnapshot]));

  const outcomes: SpeakerCsvRowOutcome[] = classified.map((row) => {
    if (row.error) return { rowNumber: row.rowNumber, email: row.email, status: "error", changedFields: [], error: row.error, contactId: null };
    if (row.duplicate) {
      return { rowNumber: row.rowNumber, email: row.email, status: "duplicate_in_file", changedFields: [], error: "Duplicate email — only the first occurrence in this file is imported", contactId: null };
    }
    const current = byEmail.get(row.email as string) ?? {};
    const { changedFields } = proposedPatch(row.values, current);
    return { rowNumber: row.rowNumber, email: row.email, status: "ok", changedFields, error: null, contactId: null };
  });

  if (input.mode === "preview") {
    const valid = outcomes.filter((row) => row.status === "ok").length;
    return { rows: outcomes, valid, invalid: outcomes.length - valid, committed: 0 };
  }

  let committed = 0;
  const committedOutcomes: SpeakerCsvRowOutcome[] = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    const row = classified[index];
    if (!outcome || outcome.status !== "ok" || !outcome.email || !row) { if (outcome) committedOutcomes.push(outcome); continue; }
    const contactId = await getOrCreateContact(dbOrTx, eventId, outcome.email);
    const [fresh] = await dbOrTx.select({
      firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, company: contacts.company,
      linkedinUrl: contacts.linkedinUrl, twitterUrl: contacts.twitterUrl, websiteUrl: contacts.websiteUrl,
    }).from(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId))).limit(1);
    const { patch, changedFields } = proposedPatch(row.values, fresh ?? {});
    if (changedFields.length > 0) await updateContactFields(dbOrTx, eventId, contactId, patch);
    committed += 1;
    committedOutcomes.push({ ...outcome, changedFields, contactId });
  }
  const valid = outcomes.filter((row) => row.status === "ok").length;
  return { rows: committedOutcomes, valid, invalid: outcomes.length - valid, committed };
}

export function importSpeakersCsv(eventId: EventId, input: ImportSpeakersCsvInput): Promise<ImportSpeakersCsvResult> {
  return importSpeakersCsvIn(db, eventId, input);
}
