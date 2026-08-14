import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx, TxDb } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { userContactLinks } from "@/db/schema";
import {
  contactIdSchema,
  type ContactId,
  type EventId,
  type UserId,
} from "@/shared/contracts";
import { getOrCreateContact } from "./contacts";

export type UserContactLinkSource = "invitation" | "reminder" | "operator";

export type UserContactResolution =
  | { status: "linked"; contactId: ContactId }
  | { status: "unlinked"; candidateContactId: ContactId | null }
  | { status: "ambiguous"; candidateContactIds: ContactId[] };

type CandidateRow = {
  contact_id: string;
  linked_user_id: string | null;
};

/**
 * Resolve the relationship without treating an email match as identity.
 *
 * A durable link wins. Without one, canonical event-email and existing CRM
 * links are candidate evidence only: one unclaimed candidate is still
 * `unlinked`, while multiple candidates or a candidate owned by another user
 * are `ambiguous`. Writers must make the relationship explicit before a
 * cross-identity consumer uses it.
 */
export async function resolveUserContactIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  userId: UserId,
): Promise<UserContactResolution> {
  const [stable] = await dbOrTx.select({ contactId: userContactLinks.contactId })
    .from(userContactLinks)
    .where(and(eq(userContactLinks.eventId, eventId), eq(userContactLinks.userId, userId)))
    .limit(1);
  if (stable) {
    return { status: "linked", contactId: contactIdSchema.parse(stable.contactId) };
  }

  const result = await dbOrTx.execute<CandidateRow>(sql`
    WITH identity AS (
      SELECT account.email, event.organization_id
      FROM users account
      JOIN event_members membership
        ON membership.user_id = account.id AND membership.event_id = ${eventId}
      JOIN events event ON event.id = membership.event_id
      WHERE account.id = ${userId}
    ), candidates AS (
      SELECT contact.id AS contact_id
      FROM identity
      JOIN contacts contact
        ON contact.event_id = ${eventId} AND contact.email = identity.email
      UNION
      SELECT link.contact_id
      FROM identity
      JOIN organization_contacts organization_contact
        ON organization_contact.organization_id = identity.organization_id
       AND organization_contact.email = identity.email
       AND organization_contact.merged_into_id IS NULL
      JOIN organization_contact_links link
        ON link.organization_id = identity.organization_id
       AND link.organization_contact_id = organization_contact.id
       AND link.event_id = ${eventId}
    )
    SELECT candidate.contact_id, occupied.user_id AS linked_user_id
    FROM candidates candidate
    LEFT JOIN user_contact_links occupied
      ON occupied.event_id = ${eventId} AND occupied.contact_id = candidate.contact_id
    ORDER BY candidate.contact_id
  `);
  const candidates = rowsOf<CandidateRow>(result);
  const candidateContactIds = candidates.map((row) => contactIdSchema.parse(row.contact_id));
  if (candidates.length > 1 || candidates.some((row) => row.linked_user_id !== null)) {
    return { status: "ambiguous", candidateContactIds };
  }
  return {
    status: "unlinked",
    candidateContactId: candidateContactIds[0] ?? null,
  };
}

/**
 * Make one explicit relationship, or return the ambiguity that prevented it.
 * Candidate discovery happens before contact creation so an existing CRM link
 * wins without duplicating an event identity. Conflict-safe insert + final
 * resolution make concurrent provisioning deterministic.
 */
export async function linkUserContactIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  userId: UserId,
  source: UserContactLinkSource,
): Promise<UserContactResolution> {
  const resolution = await resolveUserContactIn(dbOrTx, eventId, userId);
  if (resolution.status !== "unlinked") return resolution;

  let contactId = resolution.candidateContactId;
  if (!contactId) {
    const account = await dbOrTx.execute<{ email: string }>(sql`
      SELECT account.email
      FROM users account
      JOIN event_members membership
        ON membership.user_id = account.id AND membership.event_id = ${eventId}
      WHERE account.id = ${userId}
    `);
    const [row] = rowsOf<{ email: string }>(account);
    if (!row) return resolution;
    contactId = await getOrCreateContact(dbOrTx as TxDb, eventId, row.email);
  }

  await dbOrTx.insert(userContactLinks)
    .values({ userId, eventId, contactId, source })
    .onConflictDoNothing();
  return resolveUserContactIn(dbOrTx, eventId, userId);
}
