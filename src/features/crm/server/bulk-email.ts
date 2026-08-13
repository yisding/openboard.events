import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { organizationContactLinks, organizationContacts, speakerBulkMessages } from "@/db/schema";
import { composeBulkSpeakerEmailIn } from "@/features/comms";
import {
  composeCrmBulkEmailResultSchema,
  contactIdSchema,
  eventIdSchema,
  idem,
  organizationContactIdSchema,
  type ComposeCrmBulkEmailInput,
  type ComposeCrmBulkEmailResult,
  type OrganizationId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * M55 — CRM bulk communication. Deliberately does not introduce a second
 * outbox path: every send is delegated, one event at a time, to M51's
 * `composeBulkSpeakerEmailIn` unchanged — the guardrail's "CRM never imports
 * a second sender." Fan-out: each organization contact resolves to the
 * event `contacts` row from its most recently created
 * `organization_contact_links` row (a cross-event segment naturally
 * contains contacts pushed into different events); contacts that resolve to
 * the same event are batched into one `composeBulkSpeakerEmailIn` call so
 * that function's own suppression/unsubscribe checks apply exactly as they
 * do for an event-scoped bulk send. CRM supplies an organization-contact
 * idempotency key so a retry remains stable even if the latest event link
 * changes after an ambiguous first response. An organization contact with no event link yet
 * cannot receive mail this way — it is reported back as an explicit error,
 * never silently dropped.
 */

async function latestEventLinksIn(dbOrTx: DbOrTx, organizationId: OrganizationId, organizationContactIds: readonly string[]) {
  if (organizationContactIds.length === 0) return new Map<string, { eventId: string; contactId: string }>();
  const rows = await dbOrTx.select({
    organizationContactId: organizationContactLinks.organizationContactId,
    eventId: organizationContactLinks.eventId,
    contactId: organizationContactLinks.contactId,
    createdAt: organizationContactLinks.createdAt,
  }).from(organizationContactLinks)
    .where(and(eq(organizationContactLinks.organizationId, organizationId), inArray(organizationContactLinks.organizationContactId, [...organizationContactIds])))
    .orderBy(desc(organizationContactLinks.createdAt));
  const byContact = new Map<string, { eventId: string; contactId: string }>();
  for (const row of rows) {
    // Rows are ordered newest-first; the first one seen per organization
    // contact is its latest link, and every later duplicate is skipped.
    if (!byContact.has(row.organizationContactId)) byContact.set(row.organizationContactId, { eventId: row.eventId, contactId: row.contactId });
  }
  return byContact;
}

/** Resolves every requested CRM identity through any later merge chain. */
async function canonicalOrganizationContactIdsIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  organizationContactIds: readonly string[],
): Promise<Map<string, string>> {
  const parentById = new Map<string, string | null>();
  const loaded = new Set<string>();
  let pending = [...new Set(organizationContactIds)];
  while (pending.length > 0) {
    const rows = await dbOrTx.select({
      id: organizationContacts.id,
      mergedIntoId: organizationContacts.mergedIntoId,
    }).from(organizationContacts).where(and(
      eq(organizationContacts.organizationId, organizationId),
      inArray(organizationContacts.id, pending),
    ));
    for (const id of pending) loaded.add(id);
    for (const row of rows) parentById.set(row.id, row.mergedIntoId);
    pending = [...new Set(rows.flatMap((row) => row.mergedIntoId ? [row.mergedIntoId] : []))]
      .filter((id) => !loaded.has(id));
  }

  const canonicalById = new Map<string, string>();
  for (const originId of organizationContactIds) {
    let currentId = originId;
    const seen = new Set<string>();
    while (!seen.has(currentId)) {
      seen.add(currentId);
      const parentId = parentById.get(currentId);
      if (!parentId) break;
      currentId = parentId;
    }
    canonicalById.set(originId, currentId);
  }
  return canonicalById;
}

function crmCampaignContactId(organizationId: OrganizationId, sendId: string, idempotencyKey: string): string | null {
  const prefix = `${organizationId}:crm_bulk:`;
  const suffix = `:${sendId}`;
  if (!idempotencyKey.startsWith(prefix) || !idempotencyKey.endsWith(suffix)) return null;
  const contactId = idempotencyKey.slice(prefix.length, -suffix.length);
  return organizationContactIdSchema.safeParse(contactId).success ? contactId : null;
}

export async function composeCrmBulkEmailIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: ComposeCrmBulkEmailInput): Promise<ComposeCrmBulkEmailResult> {
  let links = await latestEventLinksIn(dbOrTx, organizationId, input.organizationContactIds);
  // Loosely typed (not `ComposeCrmBulkEmailResult["errors"]`, whose
  // `organizationContactId` is already branded) because the fallback below
  // can only offer the plain-string id it has on hand when the reverse
  // lookup misses; `composeCrmBulkEmailResultSchema.parse` at the end
  // re-validates and brands every entry the same way every other DTO in
  // this module is built from a raw row.
  const errors: { organizationContactId: string; reason: string }[] = [];

  if (input.mode === "preview") {
    const previewId = input.previewOrganizationContactId ?? input.organizationContactIds[0];
    const link = previewId ? links.get(previewId) : undefined;
    if (!link) throw new AppError("NOT_FOUND", "Preview recipient has not been pushed into an event yet");
    const result = await composeBulkSpeakerEmailIn(dbOrTx, eventIdSchema.parse(link.eventId), {
      mode: "preview", contactIds: [contactIdSchema.parse(link.contactId)], subject: input.subject, bodyHtml: input.bodyHtml, previewContactId: contactIdSchema.parse(link.contactId),
    });
    return composeCrmBulkEmailResultSchema.parse({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview: result.preview });
  }

  // Read the whole logical campaign, not only keys derived from this HTTP
  // chunk. The browser sends at most 500 CRM ids per request, while aliases
  // that later merge can live in different chunks and must still converge.
  const campaignMessages = await dbOrTx.select({
    idempotencyKey: speakerBulkMessages.idempotencyKey,
    eventId: speakerBulkMessages.eventId,
    contactId: speakerBulkMessages.contactId,
  }).from(speakerBulkMessages).where(like(
    speakerBulkMessages.idempotencyKey,
    `${organizationId}:crm_bulk:%:${input.sendId}`,
  ));
  const campaignContactIds = campaignMessages.flatMap((message) => {
    const contactId = crmCampaignContactId(organizationId, input.sendId, message.idempotencyKey);
    return contactId ? [contactId] : [];
  });
  const canonicalContactIds = await canonicalOrganizationContactIdsIn(
    dbOrTx,
    organizationId,
    [...input.organizationContactIds, ...campaignContactIds],
  );
  const linkContactIds = [...new Set([
    ...input.organizationContactIds,
    ...canonicalContactIds.values(),
  ])];
  const originallyRequested = new Set<string>(input.organizationContactIds);
  if (linkContactIds.some((id) => !originallyRequested.has(id))) {
    links = await latestEventLinksIn(dbOrTx, organizationId, linkContactIds);
  }

  const idempotencyKeyByContact = new Map(input.organizationContactIds.map((organizationContactId) => [
    organizationContactId,
    idem.crmBulk(
      organizationId,
      organizationContactIdSchema.parse(canonicalContactIds.get(organizationContactId) ?? organizationContactId),
      input.sendId,
    ),
  ] as const));
  // A merge can move every current link off the losing organization contact
  // after its first request committed. Its durable message is therefore the
  // authoritative recovery destination and must be consulted before treating
  // the old CRM id as unlinked.
  const existingMessages = new Map(campaignMessages.map((message) => [message.idempotencyKey, message] as const));

  type Target = {
    organizationContactId: string;
    canonicalContactId: string;
    idempotencyKey: string;
    eventId: string | undefined;
    contactId: string | undefined;
    existing: boolean;
  };
  const committedByCanonicalContact = new Map<string, Target[]>();
  for (const message of campaignMessages) {
    const messageContactId = crmCampaignContactId(organizationId, input.sendId, message.idempotencyKey);
    if (!messageContactId) continue;
    const canonicalContactId = canonicalContactIds.get(messageContactId) ?? messageContactId;
    const bucket = committedByCanonicalContact.get(canonicalContactId) ?? [];
    bucket.push({
      organizationContactId: messageContactId,
      canonicalContactId,
      idempotencyKey: message.idempotencyKey,
      eventId: message.eventId,
      contactId: message.contactId,
      existing: true,
    });
    committedByCanonicalContact.set(canonicalContactId, bucket);
  }
  const byCanonicalContact = new Map<string, Target[]>();
  for (const organizationContactId of input.organizationContactIds) {
    const idempotencyKey = idempotencyKeyByContact.get(organizationContactId);
    if (!idempotencyKey) throw new AppError("INTERNAL", "Could not build the CRM email recovery key");
    const canonicalContactId = canonicalContactIds.get(organizationContactId) ?? organizationContactId;
    const link = links.get(canonicalContactId) ?? links.get(organizationContactId);
    const existing = existingMessages.get(idempotencyKey);
    const target = existing ?? link;
    const bucket = byCanonicalContact.get(canonicalContactId) ?? [];
    bucket.push({
      organizationContactId,
      canonicalContactId,
      idempotencyKey,
      eventId: target?.eventId,
      contactId: target?.contactId,
      existing: Boolean(existing),
    });
    byCanonicalContact.set(canonicalContactId, bucket);
  }

  let skipped = 0;
  const canonicalTargets: Target[] = [];
  for (const [canonicalContactId, candidates] of byCanonicalContact) {
    // If any identity in a newly-merged group already committed, that durable
    // message covers the canonical person. Recover every distinct committed
    // key, but never create another message for a fresh alias in that group.
    const committed = [...new Map(
      (committedByCanonicalContact.get(canonicalContactId) ?? [])
        .map((candidate) => [candidate.idempotencyKey, candidate] as const),
    ).values()];
    if (committed.length > 0) {
      canonicalTargets.push(...committed);
      skipped += Math.max(0, candidates.length - committed.length);
      continue;
    }
    const winner = candidates.find((candidate) => candidate.organizationContactId === canonicalContactId && candidate.eventId && candidate.contactId)
      ?? candidates.find((candidate) => candidate.eventId && candidate.contactId);
    if (!winner) {
      const representative = candidates.find((candidate) => candidate.organizationContactId === canonicalContactId) ?? candidates[0];
      if (representative) errors.push({
        organizationContactId: representative.organizationContactId,
        reason: "Not linked to any event yet — push this contact into an event first",
      });
      skipped += Math.max(0, candidates.length - 1);
      continue;
    }
    canonicalTargets.push(winner);
    skipped += candidates.length - 1;
  }

  // A defensive destination pass also covers legacy/inconsistent merge data:
  // when fresh identities converge on one event contact, enqueue only one;
  // if durable messages already exist there, recover those and skip fresh
  // aliases instead of creating a new idempotency key for the same person.
  const byDestination = new Map<string, Target[]>();
  for (const target of canonicalTargets) {
    if (!target.eventId || !target.contactId) continue;
    const destination = `${target.eventId}:${target.contactId}`;
    const bucket = byDestination.get(destination) ?? [];
    bucket.push(target);
    byDestination.set(destination, bucket);
  }

  const byEvent = new Map<string, { contactId: string; organizationContactId: string; idempotencyKey: string }[]>();
  for (const candidates of byDestination.values()) {
    const committed = candidates.filter((candidate) => candidate.existing);
    const winners = committed.length > 0 ? committed : candidates.slice(0, 1);
    skipped += candidates.length - winners.length;
    for (const target of winners) {
      if (!target.eventId || !target.contactId) continue;
      const bucket = byEvent.get(target.eventId) ?? [];
      bucket.push({
        contactId: target.contactId,
        organizationContactId: target.organizationContactId,
        idempotencyKey: target.idempotencyKey,
      });
      byEvent.set(target.eventId, bucket);
    }
  }

  let queued = 0;
  let alreadyQueued = 0;
  for (const [eventId, eventContacts] of byEvent) {
    // Multiple durable messages may already share a destination after a
    // merge. Recover each existing key in a separate pass because the speaker
    // composer keys its overrides by contact id.
    let remaining = eventContacts;
    while (remaining.length > 0) {
      const contactIdsInBatch = new Set<string>();
      const linkedContacts: typeof eventContacts = [];
      const next: typeof eventContacts = [];
      for (const link of remaining) {
        if (contactIdsInBatch.has(link.contactId)) next.push(link);
        else {
          contactIdsInBatch.add(link.contactId);
          linkedContacts.push(link);
        }
      }
      remaining = next;

      const contactIds = linkedContacts.map((link) => contactIdSchema.parse(link.contactId));
      const idempotencyKeys = new Map(linkedContacts.map((link) => [link.contactId, link.idempotencyKey]));
      const result = await composeBulkSpeakerEmailIn(dbOrTx, eventIdSchema.parse(eventId), {
        mode: "send", contactIds, subject: input.subject, bodyHtml: input.bodyHtml,
        sendId: input.sendId,
        idempotencyKeys,
      });
      queued += result.queued;
      alreadyQueued += result.alreadyQueued;
      skipped += result.skipped;
      for (const error of result.errors) {
        errors.push({
          organizationContactId: linkedContacts.find((link) => link.contactId === error.contactId)?.organizationContactId ?? error.contactId,
          reason: error.reason,
        });
      }
    }
  }

  return composeCrmBulkEmailResultSchema.parse({ queued, alreadyQueued, skipped, errors, preview: null });
}

export const composeCrmBulkEmail = (organizationId: OrganizationId, input: ComposeCrmBulkEmailInput): Promise<ComposeCrmBulkEmailResult> =>
  composeCrmBulkEmailIn(db, organizationId, input);
