import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contactUnavailability, contacts, fileAssets, fileRequests, fileUploads, speakerLogisticsFields, speakerLogisticsValues, users } from "@/db/schema";
import type {
  ContactId,
  EventId,
  SpeakerLogisticsFieldDTO,
  SpeakerLogisticsValueDTO,
  SpeakerUnavailability,
  SpeakerUploadDTO,
  SpeakerWorkflowStatus,
} from "@/shared/contracts";
import { logisticsFieldIdSchema, unavailabilityIdSchema } from "@/shared/contracts";

// M51 — standalone speaker roster operations. Reads only; writes live in
// `speaker-roster-mutations.ts`.

export async function listLogisticsFieldsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<SpeakerLogisticsFieldDTO[]> {
  const rows = await dbOrTx.select({
    id: speakerLogisticsFields.id,
    key: speakerLogisticsFields.key,
    label: speakerLogisticsFields.label,
    fieldType: speakerLogisticsFields.fieldType,
    options: speakerLogisticsFields.options,
    sortOrder: speakerLogisticsFields.sortOrder,
  }).from(speakerLogisticsFields).where(eq(speakerLogisticsFields.eventId, eventId))
    .orderBy(asc(speakerLogisticsFields.sortOrder), asc(speakerLogisticsFields.createdAt));
  return rows.map((row) => ({ ...row, id: logisticsFieldIdSchema.parse(row.id) }));
}

export function listLogisticsFields(eventId: EventId): Promise<SpeakerLogisticsFieldDTO[]> {
  return listLogisticsFieldsIn(db, eventId);
}

export async function listSpeakerLogisticsValuesIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<SpeakerLogisticsValueDTO[]> {
  const rows = await dbOrTx.select({ fieldId: speakerLogisticsValues.fieldId, value: speakerLogisticsValues.value })
    .from(speakerLogisticsValues)
    .where(and(eq(speakerLogisticsValues.eventId, eventId), eq(speakerLogisticsValues.contactId, contactId)));
  return rows.map((row) => ({ fieldId: logisticsFieldIdSchema.parse(row.fieldId), value: row.value }));
}

export function listSpeakerLogisticsValues(eventId: EventId, contactId: ContactId): Promise<SpeakerLogisticsValueDTO[]> {
  return listSpeakerLogisticsValuesIn(db, eventId, contactId);
}

/**
 * The M54 read contract (work order §"Contract and data additions"): every
 * declared blackout for the given contacts, in ascending start order. Rows
 * are stored UTC already (the column type guarantees it) — M54 applies the
 * event timezone only at the edges it renders, exactly as this module's own
 * editor does.
 */
export async function listSpeakerUnavailabilityIn(dbOrTx: DbOrTx, eventId: EventId, contactIds: ContactId[]): Promise<SpeakerUnavailability[]> {
  if (contactIds.length === 0) return [];
  const rows = await dbOrTx.select({
    id: contactUnavailability.id,
    contactId: contactUnavailability.contactId,
    startsAt: contactUnavailability.startsAt,
    endsAt: contactUnavailability.endsAt,
    reason: contactUnavailability.reason,
  }).from(contactUnavailability)
    .where(and(eq(contactUnavailability.eventId, eventId), inArray(contactUnavailability.contactId, contactIds)))
    .orderBy(asc(contactUnavailability.startsAt));
  return rows.map((row) => ({
    id: unavailabilityIdSchema.parse(row.id),
    contactId: row.contactId as ContactId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
  }));
}

export function listSpeakerUnavailability(eventId: EventId, contactIds: ContactId[]): Promise<SpeakerUnavailability[]> {
  return listSpeakerUnavailabilityIn(db, eventId, contactIds);
}

type UploadRow = {
  fileId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  requestTitle: string;
  uploaderUserName: string | null;
  uploaderContactFirstName: string | null;
  uploaderContactLastName: string | null;
  createdAt: Date;
};

/**
 * Every file this contact has uploaded against a task's file request, for
 * the organizer's "uploaded-asset visibility" panel (work order step 5).
 * Deliberately scoped by (eventId, contactId) together — the same discipline
 * every other speaker-detail read in this feature uses — so a contact id
 * from another event can never surface a file here. Download/view goes
 * through the existing `/api/uploads/[fileId]/download-url` route
 * (`getDownloadUrl` re-checks event scope on its own), never a new,
 * possibly-wider, path.
 */
export async function listSpeakerUploadsIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<SpeakerUploadDTO[]> {
  const rows = await dbOrTx.select({
    fileId: fileUploads.fileAssetId,
    filename: fileAssets.filename,
    mime: fileAssets.mime,
    sizeBytes: fileAssets.sizeBytes,
    requestTitle: fileRequests.title,
    uploaderUserName: users.name,
    uploaderContactFirstName: contacts.firstName,
    uploaderContactLastName: contacts.lastName,
    createdAt: fileUploads.createdAt,
  }).from(fileUploads)
    .innerJoin(fileAssets, and(eq(fileAssets.id, fileUploads.fileAssetId), eq(fileAssets.eventId, fileUploads.eventId)))
    .innerJoin(fileRequests, and(eq(fileRequests.id, fileUploads.fileRequestId), eq(fileRequests.eventId, fileUploads.eventId)))
    .leftJoin(users, eq(users.id, fileAssets.uploadedByUserId))
    .leftJoin(contacts, and(eq(contacts.id, fileAssets.uploadedByContactId), eq(contacts.eventId, fileAssets.eventId)))
    .where(and(eq(fileUploads.eventId, eventId), eq(fileUploads.contactId, contactId), eq(fileUploads.isLatest, true)))
    .orderBy(asc(fileUploads.createdAt));
  return (rows as UploadRow[]).map((row) => ({
    fileId: row.fileId,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    requestTitle: row.requestTitle,
    uploaderLabel: row.uploaderUserName?.trim()
      || `${row.uploaderContactFirstName ?? ""} ${row.uploaderContactLastName ?? ""}`.trim()
      || "Speaker",
    createdAt: row.createdAt.toISOString(),
  }));
}

export function listSpeakerUploads(eventId: EventId, contactId: ContactId): Promise<SpeakerUploadDTO[]> {
  return listSpeakerUploadsIn(db, eventId, contactId);
}

export type SpeakerRosterExtras = {
  workflowStatus: SpeakerWorkflowStatus;
  fields: SpeakerLogisticsFieldDTO[];
  values: SpeakerLogisticsValueDTO[];
  unavailability: SpeakerUnavailability[];
  uploads: SpeakerUploadDTO[];
};

/**
 * Everything this module's speaker editor panel needs beyond the base
 * `SpeakerDetailDTO` (M27), fetched as one composed read so the editor's
 * route makes one call instead of four. Returns `null` for a contact id not
 * on this event, same (eventId, contactId)-scoped-together discipline as
 * every other speaker read.
 */
export async function getSpeakerRosterExtrasIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<SpeakerRosterExtras | null> {
  const [contact] = await dbOrTx.select({ workflowStatus: contacts.workflowStatus }).from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId))).limit(1);
  if (!contact) return null;
  const [fields, values, unavailability, uploads] = await Promise.all([
    listLogisticsFieldsIn(dbOrTx, eventId),
    listSpeakerLogisticsValuesIn(dbOrTx, eventId, contactId),
    listSpeakerUnavailabilityIn(dbOrTx, eventId, [contactId]),
    listSpeakerUploadsIn(dbOrTx, eventId, contactId),
  ]);
  return { workflowStatus: contact.workflowStatus, fields, values, unavailability, uploads };
}

export function getSpeakerRosterExtras(eventId: EventId, contactId: ContactId): Promise<SpeakerRosterExtras | null> {
  return getSpeakerRosterExtrasIn(db, eventId, contactId);
}
