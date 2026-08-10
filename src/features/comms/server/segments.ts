import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts, contactSuppressions } from "@/db/schema";
import {
  resolvedSpeakerSegmentSchema,
  type EventId,
  type ResolvedSpeakerSegment,
  type SpeakerSegmentFilter,
} from "@/shared/contracts";

// This is the segment's own ceiling, not composeBulkSpeakerEmailInputSchema's
// (that one caps contactIds at 200, a browser DataTable-selection limit —
// see its own comment in shared/contracts/speaker-roster.ts). A resolved
// segment above 200 is sent as multiple compose calls; BulkSendTab's
// use-bulk-send.ts does that batching.
const MAX_RECIPIENTS = 2_000;
const PREVIEW_SAMPLE = 50;

/**
 * M46 — resolves a `SpeakerSegmentFilter` ("the simple filter" the roadmap
 * names) into the `contactIds` array M51's existing `composeBulkSpeakerEmailIn`
 * already accepts unchanged. Read-only: this never writes, never enqueues,
 * and is not one of the audited `withTx` functions.
 *
 * Suppressed/unsubscribed contacts are excluded from `contactIds` here —
 * matching, not duplicating, the same two checks `composeBulkSpeakerEmailIn`
 * re-runs at send time (a contact could flip state between preview and
 * send; that recheck is still the authority) — purely so the *preview*
 * numbers an organizer sees before sending are not misleadingly high.
 */
export async function resolveSpeakerSegmentIn(dbOrTx: DbOrTx, eventId: EventId, filter: SpeakerSegmentFilter): Promise<ResolvedSpeakerSegment> {
  const predicates = [eq(contacts.eventId, eventId)];
  if (filter.workflowStatus && filter.workflowStatus.length > 0) predicates.push(inArray(contacts.workflowStatus, filter.workflowStatus));
  if (filter.confirmationStatus && filter.confirmationStatus.length > 0) predicates.push(inArray(contacts.confirmationStatus, filter.confirmationStatus));

  const matched = await dbOrTx.select({
    contactId: contacts.id,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    unsubscribedAt: contacts.unsubscribedAt,
    suppressedAt: contactSuppressions.suppressedAt,
  }).from(contacts)
    .leftJoin(contactSuppressions, eq(contactSuppressions.contactId, contacts.id))
    .where(and(...predicates))
    .orderBy(asc(contacts.email));

  let excludedSuppressedCount = 0;
  let excludedUnsubscribedCount = 0;
  const eligible: typeof matched = [];
  for (const row of matched) {
    if (row.suppressedAt) { excludedSuppressedCount += 1; continue; }
    if (row.unsubscribedAt) { excludedUnsubscribedCount += 1; continue; }
    eligible.push(row);
  }

  const capped = eligible.length > MAX_RECIPIENTS;
  const chosen = capped ? eligible.slice(0, MAX_RECIPIENTS) : eligible;

  return resolvedSpeakerSegmentSchema.parse({
    matchedCount: matched.length,
    contactIds: chosen.map((row) => row.contactId),
    capped,
    excludedSuppressedCount,
    excludedUnsubscribedCount,
    preview: chosen.slice(0, PREVIEW_SAMPLE).map((row) => ({
      contactId: row.contactId,
      email: row.email,
      name: `${row.firstName} ${row.lastName}`.trim() || row.email,
    })),
  });
}

export function resolveSpeakerSegment(eventId: EventId, filter: SpeakerSegmentFilter): Promise<ResolvedSpeakerSegment> {
  return resolveSpeakerSegmentIn(db, eventId, filter);
}
