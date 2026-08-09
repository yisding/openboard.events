import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts, sessionFormats, submissionParticipants, submissions, tracks } from "@/db/schema";
import { PORTAL_STATUS_LABEL, type ContactId, type EventId, type SubmissionStatus } from "@/shared/contracts";

/**
 * The speaker's own view of their submissions.
 *
 * Every query here is scoped by `(eventId, contactId)` together and joins through
 * `submission_participants`, so a speaker sees a submission only because they are
 * on it — not because they guessed its id. That join *is* the authorization.
 *
 * Statuses are collapsed **before they leave the server**. `accept_queue` and
 * `decline_queue` are internal review state: a speaker who reads them in a
 * response learns their likely decision days before the organizer sends it, and
 * hiding them only in the UI leaves them in the JSON. The collapse uses
 * `PORTAL_STATUS_LABEL` from the frozen contracts — the one table that owns this
 * mapping — rather than a second copy written here.
 */
/**
 * What a speaker is allowed to see: never a queue state.
 *
 * Written as a literal union rather than derived from `PORTAL_STATUS_LABEL`,
 * whose `Record<SubmissionStatus, string>` annotation would widen this to
 * `string` and let `"accept_queue"` typecheck as a portal status. The contract
 * table is still the only mapping — `portal-status.test.ts` asserts every
 * SubmissionStatus lands inside this union, so a contract change fails CI here
 * rather than leaking.
 */
export const PORTAL_STATUSES = ["Draft", "Pending", "Accepted", "Declined", "Withdrawn"] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export type PortalSubmissionRow = {
  submissionId: string;
  code: number;
  title: string;
  status: PortalStatus;
  isPrimary: boolean;
  formId: string | null;
  /** The organizer's vocabulary, resolved here so a card never shows a raw id. */
  trackName: string | null;
  formatName: string | null;
  trackColor: string | null;
  submittedAt: string | null;
  updatedAt: string;
};

export type PortalParticipant = {
  contactId: string;
  name: string;
  email: string;
  isPrimary: boolean;
};

export type PortalSubmissionDetail = PortalSubmissionRow & {
  descriptionHtml: string | null;
  participants: PortalParticipant[];
};

export function portalStatus(status: SubmissionStatus): PortalStatus {
  return PORTAL_STATUS_LABEL[status] as PortalStatus;
}

function displayName(first: string, last: string, email: string): string {
  const name = `${first} ${last}`.trim();
  return name.length > 0 ? name : email;
}

export async function listMySubmissionsIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<PortalSubmissionRow[]> {
  const rows = await dbOrTx
    .select({
      submissionId: submissions.id,
      code: submissions.code,
      title: submissions.title,
      status: submissions.status,
      isPrimary: submissionParticipants.isPrimary,
      formId: submissions.formId,
      trackName: tracks.name,
      trackColor: tracks.color,
      formatName: sessionFormats.name,
      submittedAt: submissions.submittedAt,
      updatedAt: submissions.updatedAt,
    })
    .from(submissions)
    .innerJoin(
      submissionParticipants,
      and(
        eq(submissionParticipants.submissionId, submissions.id),
        eq(submissionParticipants.eventId, submissions.eventId),
      ),
    )
    .leftJoin(tracks, eq(tracks.id, submissions.trackId))
    .leftJoin(sessionFormats, eq(sessionFormats.id, submissions.formatId))
    .where(and(eq(submissions.eventId, eventId), eq(submissionParticipants.contactId, contactId)))
    // Submitted first and newest first; drafts have no submitted_at and belong at
    // the end, not ahead of real submissions because they were touched recently.
    .orderBy(sql`${submissions.submittedAt} DESC NULLS LAST`, desc(submissions.updatedAt));

  return rows.map((row) => ({
    submissionId: row.submissionId,
    code: row.code,
    title: row.title,
    status: portalStatus(row.status),
    isPrimary: row.isPrimary,
    formId: row.formId,
    trackName: row.trackName,
    trackColor: row.trackColor,
    formatName: row.formatName,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Null rather than an error when the contact is not on the submission: a speaker
 * probing ids must not be able to tell "exists but not yours" from "does not
 * exist".
 */
export async function getMySubmissionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  submissionId: string,
): Promise<PortalSubmissionDetail | null> {
  const [row] = await dbOrTx
    .select({
      submissionId: submissions.id,
      code: submissions.code,
      title: submissions.title,
      status: submissions.status,
      isPrimary: submissionParticipants.isPrimary,
      formId: submissions.formId,
      trackName: tracks.name,
      trackColor: tracks.color,
      formatName: sessionFormats.name,
      submittedAt: submissions.submittedAt,
      updatedAt: submissions.updatedAt,
      descriptionHtml: submissions.descriptionHtml,
    })
    .from(submissions)
    .innerJoin(
      submissionParticipants,
      and(
        eq(submissionParticipants.submissionId, submissions.id),
        eq(submissionParticipants.eventId, submissions.eventId),
      ),
    )
    .leftJoin(tracks, eq(tracks.id, submissions.trackId))
    .leftJoin(sessionFormats, eq(sessionFormats.id, submissions.formatId))
    .where(and(
      eq(submissions.eventId, eventId),
      eq(submissions.id, submissionId),
      eq(submissionParticipants.contactId, contactId),
    ))
    .limit(1);
  if (!row) return null;

  // Co-speakers are listed because the speaker already knows who they submitted
  // with; nothing beyond name and email is exposed.
  const participants = await dbOrTx
    .select({
      contactId: submissionParticipants.contactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      isPrimary: submissionParticipants.isPrimary,
    })
    .from(submissionParticipants)
    .innerJoin(contacts, and(eq(contacts.id, submissionParticipants.contactId), eq(contacts.eventId, submissionParticipants.eventId)))
    .where(and(eq(submissionParticipants.eventId, eventId), eq(submissionParticipants.submissionId, submissionId)))
    .orderBy(desc(submissionParticipants.isPrimary), asc(submissionParticipants.sortOrder));

  return {
    submissionId: row.submissionId,
    code: row.code,
    title: row.title,
    status: portalStatus(row.status),
    isPrimary: row.isPrimary,
    formId: row.formId,
    trackName: row.trackName,
    trackColor: row.trackColor,
    formatName: row.formatName,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    descriptionHtml: row.descriptionHtml,
    participants: participants.map((participant) => ({
      contactId: participant.contactId,
      name: displayName(participant.firstName, participant.lastName, participant.email),
      email: participant.email,
      isPrimary: participant.isPrimary,
    })),
  };
}

/** The count the Home dashboard's My Submissions widget shows. */
export async function countMySubmissionsIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<number> {
  const [row] = await dbOrTx
    .select({ count: sql<number>`count(*)::int` })
    .from(submissionParticipants)
    .where(and(eq(submissionParticipants.eventId, eventId), eq(submissionParticipants.contactId, contactId)));
  return row?.count ?? 0;
}

/**
 * The public signatures the barrel exports. The `*In` variants above take the
 * handle so the PGlite suite can prove the isolation rules against real SQL —
 * the pattern `features/auth` already uses.
 */
export function listMySubmissions(eventId: EventId, contactId: ContactId): Promise<PortalSubmissionRow[]> {
  return listMySubmissionsIn(db, eventId, contactId);
}

export function getMySubmission(eventId: EventId, contactId: ContactId, submissionId: string): Promise<PortalSubmissionDetail | null> {
  return getMySubmissionIn(db, eventId, contactId, submissionId);
}

export function countMySubmissions(eventId: EventId, contactId: ContactId): Promise<number> {
  return countMySubmissionsIn(db, eventId, contactId);
}
