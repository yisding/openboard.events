import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import { contacts, contactSuppressions, events, speakerBulkMessages } from "@/db/schema";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  type ComposeBulkSpeakerEmailInput,
  type ComposeBulkSpeakerEmailResult,
  type ContactId,
  type EventId,
  type TemplateVars,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { sanitize } from "@/shared/lib/sanitize";
import { formatInZone } from "@/shared/lib/time";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { renderTemplateContent, validateTemplateBody } from "./render";

/**
 * M51 — personalized bulk speaker email. `enqueueEmail` is typed against
 * `TxDb` because its other callers are the audited transactional writers;
 * this compose action is a per-recipient loop of single-statement inserts,
 * not a transaction, and must not become a ninth `withTx` path (resolution
 * #4) — the same cast M50's reviewer provisioning and M36's reminder scan
 * already use.
 */
function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

type RecipientRow = {
  contactId: string;
  email: string;
  firstName: string;
  lastName: string;
  unsubscribedAt: Date | null;
  suppressedAt: Date | null;
};

type ComposeBulkSpeakerEmailServerInput = ComposeBulkSpeakerEmailInput & {
  /** Server-only override used by CRM to keep retries stable if its latest
   * event/contact link changes after an ambiguous first attempt. */
  idempotencyKeys?: ReadonlyMap<string, string>;
};

async function loadRecipients(dbOrTx: DbOrTx, eventId: EventId, contactIds: readonly ContactId[]): Promise<Map<string, RecipientRow>> {
  if (contactIds.length === 0) return new Map();
  const rows = await dbOrTx.select({
    contactId: contacts.id,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    unsubscribedAt: contacts.unsubscribedAt,
    suppressedAt: contactSuppressions.suppressedAt,
  }).from(contacts)
    .leftJoin(contactSuppressions, eq(contactSuppressions.contactId, contacts.id))
    .where(and(eq(contacts.eventId, eventId), inArray(contacts.id, [...contactIds])));
  return new Map(rows.map((row) => [row.contactId, row]));
}

/**
 * The compose-time merge surface mirrors `buildContext`'s `common` vars
 * exactly (comms/server/context.ts), minus the two things only send time can
 * know: a fresh, single-use portal magic link (minted per outbox row when it
 * is actually dispatched, resolution #12) and a signed unsubscribe token.
 * Both fall back to a plausible, syntactically valid URL so preview and
 * validation never fail on them — the *real* link an actual recipient
 * receives is the one the dispatcher mints.
 */
function varsFor(event: { name: string; slug: string; timezone: string; startsAt: Date; location: string | null }, row: RecipientRow, env: ReturnType<typeof getEnv>): TemplateVars {
  return {
    event: {
      name: event.name,
      start_date: formatInZone(event.startsAt, event.timezone, "date"),
      location: event.location?.trim() || "Location to be announced",
      timezone: event.timezone,
    },
    speaker: { first_name: row.firstName.trim() || "there", last_name: row.lastName.trim(), email: row.email },
    portal: { magic_link: `${env.APP_BASE_URL}/portal/${encodeURIComponent(event.slug)}` },
    unsubscribe: { url: `${env.APP_BASE_URL}/portal/${encodeURIComponent(event.slug)}/unsubscribe` },
  } as TemplateVars;
}

/**
 * Selected/filtered bulk compose (work order step 6). `mode: "preview"`
 * renders one recipient's merged content and enqueues nothing — the
 * "resolved preview first" AC. `mode: "send"` writes one `speaker_bulk_messages`
 * row and one outbox row per surviving recipient; a contact this event does
 * not own, or who is suppressed/unsubscribed, is counted rather than mailed,
 * so the returned totals are the same "queued/skipped" story a re-opened
 * comms log would tell.
 */
export async function composeBulkSpeakerEmailIn(dbOrTx: DbOrTx, eventId: EventId, input: ComposeBulkSpeakerEmailServerInput): Promise<ComposeBulkSpeakerEmailResult> {
  // Sanitized once, up front — same write-boundary discipline as
  // `saveTemplateIn`/`updateSpeakerBioIn` (resolution #2): this is
  // organizer-authored HTML that lands directly in a speaker's inbox, and
  // every downstream use (unknown-token validation, preview render, and the
  // row actually stored/re-rendered at send time) reads this one sanitized
  // value rather than the raw request body.
  const bodyHtml = sanitize(input.bodyHtml);
  const validation = validateTemplateBody("speaker_bulk_message", input.subject, bodyHtml);
  if (!validation.ok) {
    throw new AppError(
      "TEMPLATE_VAR_MISSING",
      `Unknown variable ${validation.unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list`,
      { unknownTokens: validation.unknownTokens },
    );
  }

  const [event] = await dbOrTx.select({
    name: events.name, slug: events.slug, timezone: events.timezone, startsAt: events.startsAt, location: events.location,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  const env = getEnv();
  const recipients = await loadRecipients(dbOrTx, eventId, input.contactIds);

  if (input.mode === "preview") {
    const previewId = input.previewContactId ?? input.contactIds[0];
    const row = previewId ? recipients.get(previewId) : undefined;
    if (!row) throw new AppError("NOT_FOUND", "Preview recipient not found in this event");
    const rendered = renderTemplateContent("speaker_bulk_message", input.subject, bodyHtml, varsFor(event, row, env));
    return {
      queued: 0,
      alreadyQueued: 0,
      skipped: 0,
      errors: [],
      preview: {
        recipientEmail: row.email,
        recipientName: `${row.firstName} ${row.lastName}`.trim() || row.email,
        subject: rendered.subject,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
      },
    };
  }

  const sendId = input.sendId;
  const idempotencyKeyFor = (contactId: ContactId) => input.idempotencyKeys?.get(contactId) ?? idem.speakerBulk(eventId, contactId, sendId);
  const idempotencyKeys = input.contactIds.map(idempotencyKeyFor);
  const existingMessages = new Map(
    (await dbOrTx.select({
      idempotencyKey: speakerBulkMessages.idempotencyKey,
      eventId: speakerBulkMessages.eventId,
      contactId: speakerBulkMessages.contactId,
    })
      .from(speakerBulkMessages)
      .where(inArray(speakerBulkMessages.idempotencyKey, idempotencyKeys)))
      .map((message) => [message.idempotencyKey, message] as const),
  );
  let queued = 0;
  let alreadyQueued = 0;
  let skipped = 0;
  const errors: ComposeBulkSpeakerEmailResult["errors"] = [];
  for (const contactId of input.contactIds) {
    const row = recipients.get(contactId);
    if (!row) { errors.push({ contactId, reason: "Not found in this event" }); continue; }
    const idempotencyKey = idempotencyKeyFor(contactId);
    const existing = existingMessages.get(idempotencyKey);
    if (existing) {
      // The first response may have been lost after the message insert. Count
      // that recipient as accepted by this attempt and retry enqueueing its
      // recorded destination so a rarer failure between the message and
      // outbox inserts still self-heals. CRM's latest link may have changed
      // since this message row committed; the stored event/contact is the
      // approved attempt's authoritative destination.
      await enqueueEmail(asOutboxWriter(dbOrTx), {
        eventId: eventIdSchema.parse(existing.eventId),
        templateKey: "speaker_bulk_message",
        contactId: contactIdSchema.parse(existing.contactId),
        idempotencyKey,
      });
      alreadyQueued += 1;
      continue;
    }
    // Same policy `buildContext` enforces at send time (P3-EMAIL): a hard
    // bounce/complaint blocks everything, and a bulk message is
    // non-essential, so the contact's own unsubscribe also withholds it.
    // Checking here — not just leaving it to the dispatcher — is what makes
    // the returned `skipped` count accurate immediately, before a single
    // outbox row has been claimed.
    if (row.suppressedAt || row.unsubscribedAt) { skipped += 1; continue; }
    try {
      // Rendered only to catch a per-recipient failure before it is queued;
      // the sanitized template (not this render) is what gets stored and
      // re-rendered with live vars at actual send time.
      renderTemplateContent("speaker_bulk_message", input.subject, bodyHtml, varsFor(event, row, env));
    } catch (error) {
      errors.push({ contactId, reason: error instanceof Error ? error.message : "Could not render this message" });
      continue;
    }
    const inserted = await dbOrTx.insert(speakerBulkMessages).values({
      eventId, contactId, idempotencyKey, subject: input.subject, bodyHtml,
    }).onConflictDoNothing({ target: speakerBulkMessages.idempotencyKey }).returning();
    await enqueueEmail(asOutboxWriter(dbOrTx), { eventId, templateKey: "speaker_bulk_message", contactId, idempotencyKey });
    // Retrying still calls enqueueEmail so a rare failure between the message
    // insert and outbox insert can heal itself. Only a newly-created message,
    // however, counts as newly queued in this response.
    if (inserted.length > 0) queued += 1;
    else alreadyQueued += 1;
  }
  return { queued, alreadyQueued, skipped, errors, preview: null };
}

export function composeBulkSpeakerEmail(eventId: EventId, input: ComposeBulkSpeakerEmailInput): Promise<ComposeBulkSpeakerEmailResult> {
  return composeBulkSpeakerEmailIn(db, eventId, input);
}
