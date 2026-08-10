import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { communicationLogs, contacts, contactSuppressions } from "@/db/schema";
import { type ContactId, type EventId, type SuppressionReason } from "@/shared/contracts";
import { suppressionRowSchema, type SuppressionRow } from "../schemas";

export type { SuppressionRow } from "../schemas";
export { suppressionRowSchema } from "../schemas";

/**
 * Resend bounce/complaint webhook target (PLAN roadmap P3-EMAIL). A hard
 * bounce or spam complaint means the address is no longer safe to mail —
 * this is provider-driven suppression, distinct from `contacts.unsubscribed_at`
 * (the contact's own opt-out, which only withholds non-essential mail; see
 * `isTransactionalTemplate`). `buildContext` (./context.ts) LEFT JOINs
 * `contact_suppressions` and reads it fleet-wide, before the transactional
 * exemption is even checked, so a suppressed address never receives another
 * email of any kind.
 *
 * `contact_suppressions` is a dedicated table rather than columns on
 * `contacts` — see the schema/migration comments for why: `contacts` writes
 * go through `getOrCreateContact`/`updateContactFields`, both of which use an
 * unqualified `.returning()`/insert (every declared column), so new columns
 * there break every PGlite fixture across every feature that touches a
 * contact and has not also loaded this migration. Written as a direct
 * upsert here, not through those two helpers, for the same reason
 * `unsubscribe.ts`'s `unsubscribeFromRemindersIn` writes `contacts` directly:
 * this is a system-driven state flip, not a user-editable profile patch.
 * Nothing here opens a `withTx` path (resolution #4); both statements are
 * independently safe to retry, and a webhook redelivery (Resend/Svix retries
 * on non-2xx) is idempotent either way.
 */
export async function recordSuppressionIn(
  dbOrTx: DbOrTx,
  args: { providerMessageId: string; reason: SuppressionReason },
): Promise<{ eventId: EventId; contactId: ContactId } | null> {
  const [log] = await dbOrTx.select({
    id: communicationLogs.id,
    eventId: communicationLogs.eventId,
    contactId: communicationLogs.contactId,
  }).from(communicationLogs).where(eq(communicationLogs.providerMessageId, args.providerMessageId)).limit(1);
  if (!log) return null;

  // Best-effort audit trail on the log row itself: only flips a `sent` row,
  // never a `queued`/`failed`/`skipped` one (an id collision or reused test
  // fixture must not corrupt an unrelated row's status).
  await dbOrTx.update(communicationLogs)
    .set({ status: args.reason === "bounce" ? "bounced" : "complained" })
    .where(and(eq(communicationLogs.id, log.id), eq(communicationLogs.status, "sent")));

  await dbOrTx.insert(contactSuppressions)
    .values({ contactId: log.contactId, eventId: log.eventId, reason: args.reason })
    .onConflictDoUpdate({ target: contactSuppressions.contactId, set: { reason: args.reason, suppressedAt: sql`now()` } });
  return { eventId: log.eventId as EventId, contactId: log.contactId as ContactId };
}

export const recordSuppression = (args: { providerMessageId: string; reason: SuppressionReason }): Promise<{ eventId: EventId; contactId: ContactId } | null> =>
  recordSuppressionIn(db, args);

/**
 * M46 — suppression list admin UI. Every currently-suppressed contact for
 * the event, newest first: who, why (`reason` — bounce or complaint, the
 * only two `recordSuppressionIn` ever writes), and when. This is a read
 * model over `recordSuppressionIn`'s own table; nothing here writes.
 */
export async function listSuppressionsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<SuppressionRow[]> {
  const rows = await dbOrTx.select({
    contactId: contactSuppressions.contactId,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    reason: contactSuppressions.reason,
    suppressedAt: contactSuppressions.suppressedAt,
  }).from(contactSuppressions)
    .innerJoin(contacts, and(eq(contacts.id, contactSuppressions.contactId), eq(contacts.eventId, contactSuppressions.eventId)))
    .where(eq(contactSuppressions.eventId, eventId))
    .orderBy(desc(contactSuppressions.suppressedAt));
  return rows.map((row) => suppressionRowSchema.parse({
    contactId: row.contactId,
    email: row.email,
    name: `${row.firstName} ${row.lastName}`.trim() || row.email,
    reason: row.reason,
    suppressedAt: row.suppressedAt.toISOString(),
  }));
}

export function listSuppressions(eventId: EventId): Promise<SuppressionRow[]> {
  return listSuppressionsIn(db, eventId);
}

/**
 * M46 — the un-suppress this table's own migration comment named as a later
 * phase ("no unsuppress path today"): an organizer reviewed a bounce/
 * complaint entry and judged it stale (typo since fixed, complaint from
 * before a preference change) and wants future sends to resume. Deletes the
 * row outright — presence is the only state this table tracks, so removing
 * the row *is* the whole un-suppress operation; there is nothing to toggle
 * back to. Deliberately leaves `communication_logs` alone: the historical
 * `bounced`/`complained` status on the message that triggered this stays as
 * the audit record of what actually happened, and `contacts.unsubscribed_at`
 * (a separate, contact-owned preference) is untouched either way. Not one of
 * the audited `withTx` functions (resolution #4): a single-statement DELETE
 * needs no transaction.
 */
export async function removeSuppressionIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<boolean> {
  const [deleted] = await dbOrTx.delete(contactSuppressions)
    .where(and(eq(contactSuppressions.contactId, contactId), eq(contactSuppressions.eventId, eventId)))
    .returning();
  return Boolean(deleted);
}

export function removeSuppression(eventId: EventId, contactId: ContactId): Promise<boolean> {
  return removeSuppressionIn(db, eventId, contactId);
}
