import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  calendarInvites,
  communicationLogs,
  contactSuppressions,
  fileComments,
  portalSessions,
  portalTokens,
  sessionSpeakers,
  sessions,
  speakerBulkMessages,
  submissionAnswers,
  submissionParticipants,
} from "@/db/schema";
import { getSpeakerDetailIn, getSpeakerRosterExtrasIn, type SpeakerDetailDTO, type SpeakerRosterExtras } from "@/features/portal";
import type { ContactId, EventId } from "@/shared/contracts";

/**
 * M47 — the contact half of "contact/org data export (JSON bundle per
 * contact and per organization)". This is a read composition, not a new
 * subsystem: `getSpeakerDetailIn` (M27) already assembles the contact
 * profile, their submissions and portal tasks in one call, and
 * `getSpeakerRosterExtrasIn` (M51) already assembles their logistics
 * answers, blackout windows and uploaded-file metadata. Everything neither
 * of those already reads — the actual submitted answer content, comms sent
 * to them (including the rendered body, before retention redacts it),
 * calendar invites, personalized bulk-email copies, file-slot comments,
 * suppression status, and portal auth metadata (never the token/OTP hashes
 * themselves — those are not "their data", they are how the system
 * authenticates them) — is read directly here.
 *
 * Every query below is (eventId, contactId)-scoped together, the same
 * discipline every other speaker read in this codebase uses (R4).
 */
export type ContactDataExport = {
  eventId: EventId;
  contactId: ContactId;
  exportedAt: string;
  profile: SpeakerDetailDTO["contact"];
  submissions: SpeakerDetailDTO["submissions"];
  submissionAnswers: Array<{ submissionId: string; fieldId: string; value: unknown }>;
  tasks: SpeakerDetailDTO["tasks"];
  roster: SpeakerRosterExtras;
  sessionsSpeaking: Array<{ sessionId: string; title: string; role: string }>;
  communications: Array<{
    id: string;
    templateKey: string;
    status: string;
    subject: string | null;
    bodyHtml: string | null;
    sentAt: string | null;
    createdAt: string;
  }>;
  calendarInvites: Array<{ sessionId: string; icsUid: string; lastMethod: string; lastSentAt: string | null }>;
  bulkMessages: Array<{ subject: string; bodyHtml: string; createdAt: string }>;
  fileComments: Array<{ id: string; body: string; authorRole: string; createdAt: string }>;
  portalTokens: Array<{ purpose: string; createdAt: string; expiresAt: string; consumedAt: string | null }>;
  portalSessions: Array<{ createdAt: string; expiresAt: string; impersonated: boolean }>;
  emailSuppressed: boolean;
};

export async function exportContactDataIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<ContactDataExport | null> {
  const [detail, roster] = await Promise.all([
    getSpeakerDetailIn(dbOrTx, eventId, contactId),
    getSpeakerRosterExtrasIn(dbOrTx, eventId, contactId),
  ]);
  if (!detail || !roster) return null;

  const [answers, speaking, comms, invites, bulk, comments, tokens, portalSessionRows, suppression] = await Promise.all([
    dbOrTx.select({ submissionId: submissionAnswers.submissionId, fieldId: submissionAnswers.fieldId, value: submissionAnswers.value })
      .from(submissionAnswers)
      .innerJoin(submissionParticipants, eq(submissionParticipants.id, submissionAnswers.participantId))
      .where(and(eq(submissionAnswers.eventId, eventId), eq(submissionParticipants.contactId, contactId))),
    dbOrTx.select({ sessionId: sessionSpeakers.sessionId, title: sessions.title, role: sessionSpeakers.role })
      .from(sessionSpeakers)
      .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
      .where(and(eq(sessionSpeakers.eventId, eventId), eq(sessionSpeakers.contactId, contactId))),
    dbOrTx.select({
      id: communicationLogs.id,
      templateKey: communicationLogs.templateKey,
      status: communicationLogs.status,
      subject: communicationLogs.subjectRendered,
      bodyHtml: communicationLogs.bodyRenderedHtml,
      sentAt: communicationLogs.sentAt,
      createdAt: communicationLogs.createdAt,
    }).from(communicationLogs)
      .where(and(eq(communicationLogs.eventId, eventId), eq(communicationLogs.contactId, contactId)))
      .orderBy(desc(communicationLogs.createdAt)),
    dbOrTx.select({
      sessionId: calendarInvites.sessionId,
      icsUid: calendarInvites.icsUid,
      lastMethod: calendarInvites.lastMethod,
      lastSentAt: calendarInvites.lastSentAt,
    }).from(calendarInvites)
      .where(and(eq(calendarInvites.eventId, eventId), eq(calendarInvites.contactId, contactId))),
    dbOrTx.select({ subject: speakerBulkMessages.subject, bodyHtml: speakerBulkMessages.bodyHtml, createdAt: speakerBulkMessages.createdAt })
      .from(speakerBulkMessages)
      .where(and(eq(speakerBulkMessages.eventId, eventId), eq(speakerBulkMessages.contactId, contactId))),
    dbOrTx.select({ id: fileComments.id, body: fileComments.body, authorRole: fileComments.authorRole, createdAt: fileComments.createdAt })
      .from(fileComments)
      .where(and(eq(fileComments.eventId, eventId), eq(fileComments.contactId, contactId))),
    dbOrTx.select({
      purpose: portalTokens.purpose,
      createdAt: portalTokens.createdAt,
      expiresAt: portalTokens.expiresAt,
      consumedAt: portalTokens.consumedAt,
    }).from(portalTokens)
      .where(and(eq(portalTokens.eventId, eventId), eq(portalTokens.contactId, contactId))),
    dbOrTx.select({
      createdAt: portalSessions.createdAt,
      expiresAt: portalSessions.expiresAt,
      impersonatedByUserId: portalSessions.impersonatedByUserId,
    }).from(portalSessions)
      .where(and(eq(portalSessions.eventId, eventId), eq(portalSessions.contactId, contactId))),
    dbOrTx.select({ reason: contactSuppressions.reason }).from(contactSuppressions).where(eq(contactSuppressions.contactId, contactId)).limit(1),
  ]);

  return {
    eventId,
    contactId,
    exportedAt: new Date().toISOString(),
    profile: detail.contact,
    submissions: detail.submissions,
    submissionAnswers: answers,
    tasks: detail.tasks,
    roster,
    sessionsSpeaking: speaking,
    communications: comms.map((row) => ({
      ...row,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    calendarInvites: invites.map((row) => ({ ...row, lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null })),
    bulkMessages: bulk.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    fileComments: comments.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    portalTokens: tokens.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
    })),
    portalSessions: portalSessionRows.map((row) => ({
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      impersonated: row.impersonatedByUserId !== null,
    })),
    emailSuppressed: suppression.length > 0,
  };
}

export function exportContactData(eventId: EventId, contactId: ContactId): Promise<ContactDataExport | null> {
  return exportContactDataIn(db, eventId, contactId);
}
