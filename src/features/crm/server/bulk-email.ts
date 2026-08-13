import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { organizationContactLinks } from "@/db/schema";
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

export async function composeCrmBulkEmailIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: ComposeCrmBulkEmailInput): Promise<ComposeCrmBulkEmailResult> {
  const links = await latestEventLinksIn(dbOrTx, organizationId, input.organizationContactIds);
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

  const byEvent = new Map<string, { contactId: string; organizationContactId: string }[]>();
  for (const organizationContactId of input.organizationContactIds) {
    const link = links.get(organizationContactId);
    if (!link) { errors.push({ organizationContactId, reason: "Not linked to any event yet — push this contact into an event first" }); continue; }
    const bucket = byEvent.get(link.eventId) ?? [];
    bucket.push({ contactId: link.contactId, organizationContactId });
    byEvent.set(link.eventId, bucket);
  }

  let queued = 0;
  let alreadyQueued = 0;
  let skipped = 0;
  for (const [eventId, linkedContacts] of byEvent) {
    const contactIds = linkedContacts.map((link) => contactIdSchema.parse(link.contactId));
    const idempotencyKeys = new Map(linkedContacts.map((link) => [
      link.contactId,
      idem.crmBulk(organizationId, organizationContactIdSchema.parse(link.organizationContactId), input.sendId),
    ]));
    const result = await composeBulkSpeakerEmailIn(dbOrTx, eventIdSchema.parse(eventId), {
      mode: "send", contactIds, subject: input.subject, bodyHtml: input.bodyHtml,
      sendId: input.sendId,
      idempotencyKeys,
    });
    queued += result.queued;
    alreadyQueued += result.alreadyQueued;
    skipped += result.skipped;
    for (const error of result.errors) errors.push({ organizationContactId: findOrganizationContactId(links, error.contactId) ?? error.contactId, reason: error.reason });
  }

  return composeCrmBulkEmailResultSchema.parse({ queued, alreadyQueued, skipped, errors, preview: null });
}

function findOrganizationContactId(links: Map<string, { eventId: string; contactId: string }>, contactId: string): string | undefined {
  for (const [organizationContactId, link] of links) if (link.contactId === contactId) return organizationContactId;
  return undefined;
}

export const composeCrmBulkEmail = (organizationId: OrganizationId, input: ComposeCrmBulkEmailInput): Promise<ComposeCrmBulkEmailResult> =>
  composeCrmBulkEmailIn(db, organizationId, input);
