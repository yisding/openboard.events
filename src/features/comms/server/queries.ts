import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { communicationLogs, contacts } from "@/db/schema";
import { commLogRowSchema, type CommLogRow, type CommStatus, type ContactId, type EventId, type TemplateKey } from "@/shared/contracts";

export type CommLogFilters = {
  contactId?: ContactId;
  templateKey?: TemplateKey;
  status?: CommStatus;
  limit?: number;
};

export async function listLogIn(dbOrTx: DbOrTx, eventId: EventId, filters: CommLogFilters = {}): Promise<CommLogRow[]> {
  const predicates = [eq(communicationLogs.eventId, eventId)];
  if (filters.contactId) predicates.push(eq(communicationLogs.contactId, filters.contactId));
  if (filters.templateKey) predicates.push(eq(communicationLogs.templateKey, filters.templateKey));
  if (filters.status) predicates.push(eq(communicationLogs.status, filters.status));
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const rows = await dbOrTx.select({
    id: communicationLogs.id,
    contactId: communicationLogs.contactId,
    recipientEmail: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    templateKey: communicationLogs.templateKey,
    status: communicationLogs.status,
    subjectRendered: communicationLogs.subjectRendered,
    providerMessageId: communicationLogs.providerMessageId,
    error: communicationLogs.error,
    icsUid: communicationLogs.icsUid,
    submissionId: communicationLogs.submissionId,
    sessionId: communicationLogs.sessionId,
    taskId: communicationLogs.taskId,
    createdAt: communicationLogs.createdAt,
    sentAt: communicationLogs.sentAt,
  }).from(communicationLogs).innerJoin(contacts, and(eq(contacts.id, communicationLogs.contactId), eq(contacts.eventId, communicationLogs.eventId)))
    .where(and(...predicates)).orderBy(desc(communicationLogs.createdAt)).limit(limit);
  return rows.map((row) => commLogRowSchema.parse({
    ...row,
    recipientName: `${row.firstName} ${row.lastName}`.trim() || row.recipientEmail,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  }));
}

export async function listLog(eventId: EventId, filters: CommLogFilters = {}): Promise<CommLogRow[]> {
  return listLogIn(db, eventId, filters);
}
