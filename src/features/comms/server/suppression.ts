import { and, desc, eq, sql, type SQL } from "drizzle-orm";
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
 * `contact_suppressions` before the transactional exemption is even checked,
 * so a suppressed contact never receives another email of any kind. "Fleet-
 * wide" is delivered by the write below, which suppresses every `contacts`
 * row sharing the address rather than only the one the bounced message
 * happened to name — see the comment on that statement.
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

  // A hard bounce or a spam complaint is a fact about the *mailbox*, not about
  // one event's row for it. `contacts` is per-event, so the same human is a
  // different `contacts.id` in every event they speak at — suppressing only
  // the row the message happened to be addressed to left every sibling row
  // mailable, and the docstring's "never receives another email of any kind"
  // was true only inside one event. Since the fleet shares a single sending
  // domain, that is also the shape that costs reputation: the provider already
  // told us the address is undeliverable, or its owner already reported us.
  //
  // Fanning out at write time rather than reading address-wide keeps every
  // consumer intact: each event's suppression list shows its own row, and
  // `removeSuppressionIn` stays the event-scoped correction it is today —
  // an address-wide read would have left an organizer un-suppressing their
  // own row and still watching mail be skipped, with nothing in their UI to
  // explain it. The residual gap is a contact created in some other event
  // *after* the bounce; nothing exists yet to suppress at that point.
  //
  // Plain equality, no `lower()`: `contacts.email` carries a
  // `CHECK (email = lower(btrim(email)))` since 0000_init, so the stored form
  // is already canonical and normalizing here would only cost the comparison
  // its index eligibility. The scan is per bounce webhook, not per send.
  const suppressed = await suppressAddressIn(
    dbOrTx,
    sql`(SELECT email FROM contacts WHERE id = ${log.contactId})`,
    args.reason,
  );
  if (suppressed === 0) {
    // No `contacts` row resolved — only reachable if the log's contact vanished
    // between the two reads. Keep the original row suppressed regardless.
    await dbOrTx.insert(contactSuppressions)
      .values([{ contactId: log.contactId, eventId: log.eventId, reason: args.reason }])
      .onConflictDoUpdate({ target: contactSuppressions.contactId, set: { reason: args.reason, suppressedAt: sql`now()` } });
  }
  return { eventId: log.eventId as EventId, contactId: log.contactId as ContactId };
}

/**
 * Suppress every `contacts` row holding an address, and answer how many.
 *
 * The address is passed as SQL so a caller can hand over either a literal or a
 * subquery. Extracted because the platform outbox needs the same fan-out: its
 * bounces used to stop at `admin_auth_email_outbox.status` and never reach
 * `contact_suppressions`, so the comms dispatcher — which has no ageing window
 * at all — kept mailing an address the provider had already confirmed
 * undeliverable, and the organizer's Suppressions tab showed nothing to explain
 * it. The two outboxes provably address the same mailboxes: a reviewer
 * invitation goes out through the platform one, and `ensureReviewerContact`
 * materialises a `contacts` row from that same `users.email`.
 */
export async function suppressAddressIn(
  dbOrTx: DbOrTx,
  email: SQL,
  reason: SuppressionReason,
): Promise<number> {
  const holders = await dbOrTx.select({ id: contacts.id, eventId: contacts.eventId })
    .from(contacts)
    .where(sql`${contacts.email} = ${email}`);
  if (holders.length === 0) return 0;
  await dbOrTx.insert(contactSuppressions)
    .values(holders.map((holder) => ({ contactId: holder.id, eventId: holder.eventId, reason })))
    .onConflictDoUpdate({ target: contactSuppressions.contactId, set: { reason, suppressedAt: sql`now()` } });
  return holders.length;
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

/** Address-keyed suppression for a caller outside this module's own outbox. */
export const suppressAddress = (email: string, reason: SuppressionReason): Promise<number> =>
  suppressAddressIn(db, sql`${email}`, reason);
