import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, idem, organizationContactIdSchema, organizationIdSchema } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import { composeCrmBulkEmailIn } from "@/features/crm/server/bulk-email";
import { dispatchOutboxIn } from "./server/dispatcher";
import { composeBulkSpeakerEmailIn } from "./server/speaker-bulk";
import { seedDefaultTemplates } from "./server/templates";
import type { EmailMessage } from "./server/resend";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// `TEMPLATE_KEYS` (contracts) now includes M50's two labels too — the
// `template_key` Postgres enum needs every migration that appended a label
// applied, in order, or `seedDefaultTemplates`'s one bulk insert 22P02s on
// the first row it doesn't recognize.
const migrationReviewOps = readFileSync(new URL("../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M42 adds the admin_password_reset / admin_email_verification template keys,
// which `seedDefaultTemplates` inserts for every event.
const migrationProductAuth = readFileSync(new URL("../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43's `organizations` table, which M44's `organization_invitations`/
// `organization_audit_log` FK against; M44 appended `organization_invited` to
// `template_key`, which `seedDefaultTemplates` also inserts for every event.
const migrationTenancy = readFileSync(new URL("../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");
const migrationCrm = readFileSync(new URL("../../../drizzle/0013_speaker_crm.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e1000000-0000-4000-8000-000000000001");
const ada = contactIdSchema.parse("e1000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("e1000000-0000-4000-8000-000000000011");
const unsubscribed = contactIdSchema.parse("e1000000-0000-4000-8000-000000000012");
const suppressed = contactIdSchema.parse("e1000000-0000-4000-8000-000000000013");
const unknownContact = contactIdSchema.parse("e1000000-0000-4000-8000-000000000099");
const movedEventId = eventIdSchema.parse("e2000000-0000-4000-8000-000000000001");
const movedContact = contactIdSchema.parse("e2000000-0000-4000-8000-000000000010");

const secret = "speaker-bulk-test-secret-that-is-at-least-32-bytes";
const logEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  // M46 — dedicated key for unsubscribe token signing; `speaker_bulk_message`
  // is non-transactional, so `buildContext` always signs one for it.
  UNSUBSCRIBE_SECRET: secret,
  EMAIL_MODE: "log",
  EMAIL_FALLBACK_UI: "1",
});

describe("composeBulkSpeakerEmailIn (M51)", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationUserManagement);
    await pglite.exec(migrationCrm);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;

    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ($1,$5,'ada@example.com','Ada','Lovelace'), ($2,$5,'grace@example.com','Grace','Hopper'), ($3,$5,'unsub@example.com','Uno','Sub'), ($4,$5,'suppressed@example.com','Sam','Suppressed')",
      [ada, grace, unsubscribed, suppressed, eventId],
    );
    await pglite.query("UPDATE contacts SET unsubscribed_at = now() WHERE id=$1", [unsubscribed]);
    await pglite.query("INSERT INTO contact_suppressions(contact_id,event_id,reason) VALUES($1,$2,'bounce')", [suppressed, eventId]);
    await seedDefaultTemplates(tx, eventId);
    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'New Event','new-event','Oakland','America/Los_Angeles','2027-09-15T16:00:00Z','2027-09-17T01:00:00Z')",
      [movedEventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ($1,$2,'ada@example.com','Ada','Lovelace')",
      [movedContact, movedEventId],
    );
    await seedDefaultTemplates(tx, movedEventId);
  }, 30_000);

  afterAll(async () => pglite.close());

  it("previews one recipient's merged content without queuing anything", async () => {
    const result = await composeBulkSpeakerEmailIn(tx, eventId, {
      contactIds: [ada, grace],
      subject: "Hi {{speaker.first_name}}",
      bodyHtml: "<p>See you at {{event.name}}, {{speaker.first_name}} {{speaker.last_name}}.</p>",
      mode: "preview",
      previewContactId: ada,
    });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.preview).toMatchObject({ recipientEmail: "ada@example.com", recipientName: "Ada Lovelace", subject: "Hi Ada" });
    expect(result.preview?.bodyHtml).toContain("See you at AI Engineer, Ada Lovelace.");
    expect(result.preview?.bodyText).toContain("See you at AI Engineer, Ada Lovelace.");
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM communication_logs");
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("rejects an unknown merge token before anything is queued", async () => {
    await expect(composeBulkSpeakerEmailIn(tx, eventId, {
      contactIds: [ada],
      subject: "Hi {{speaker.first_name}}",
      bodyHtml: "<p>{{submission.title}}</p>",
      mode: "send",
      sendId: "91000000-0000-4000-8000-000000000010",
    })).rejects.toMatchObject({ code: "TEMPLATE_VAR_MISSING" });
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM communication_logs");
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("sends to selected contacts, skipping unsubscribed/suppressed and erroring on an unknown id — with accurate totals before dispatch", async () => {
    const result = await composeBulkSpeakerEmailIn(tx, eventId, {
      contactIds: [ada, grace, unsubscribed, suppressed, unknownContact],
      subject: "Update for {{speaker.first_name}}",
      bodyHtml: "<p>Hello {{speaker.first_name}}, this is a note about {{event.name}}.</p>",
      mode: "send",
      sendId: "91000000-0000-4000-8000-000000000011",
    });
    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([{ contactId: unknownContact, reason: "Not found in this event" }]);

    // One log row per recipient — never one row fanned out or one row shared.
    const logs = await pglite.query<{ contact_id: string; template_key: string; status: string }>(
      "SELECT contact_id, template_key, status FROM communication_logs WHERE event_id=$1 ORDER BY contact_id", [eventId],
    );
    expect(logs.rows).toHaveLength(2);
    expect(logs.rows.every((row) => row.template_key === "speaker_bulk_message" && row.status === "queued")).toBe(true);
    expect(logs.rows.map((row) => row.contact_id).sort()).toEqual([ada, grace].sort());
  });

  it("renders each recipient's own personalization at dispatch time", async () => {
    const sender = vi.fn(async (message: EmailMessage) => `sent-${message.to}`);
    await dispatchOutboxIn(tx, 50, { env: logEnv, sender });
    const rendered = await pglite.query<{ contact_id: string; subject_rendered: string; body_rendered_html: string }>(
      "SELECT contact_id, subject_rendered, body_rendered_html FROM communication_logs WHERE event_id=$1 ORDER BY contact_id", [eventId],
    );
    expect(rendered.rows).toHaveLength(2);
    const adaRow = rendered.rows.find((row) => row.contact_id === ada);
    const graceRow = rendered.rows.find((row) => row.contact_id === grace);
    expect(adaRow?.subject_rendered).toBe("Update for Ada");
    expect(adaRow?.body_rendered_html).toContain("Hello Ada, this is a note about AI Engineer.");
    expect(graceRow?.subject_rendered).toBe("Update for Grace");
    expect(graceRow?.body_rendered_html).toContain("Hello Grace, this is a note about AI Engineer.");
  });

  // Last in the file deliberately: it queues its own send, and the row-count
  // assertions above are scoped to exactly the sends those earlier tests made.
  it("sanitizes a <script> payload the same way the template editor does, in both preview and the stored row (M46)", async () => {
    const preview = await composeBulkSpeakerEmailIn(tx, eventId, {
      contactIds: [ada],
      subject: "Hi {{speaker.first_name}}",
      bodyHtml: "<p>hi</p><script>alert(1)</script>",
      mode: "preview",
      previewContactId: ada,
    });
    expect(preview.preview?.bodyHtml).not.toContain("<script>");
    expect(preview.preview?.bodyHtml).toContain("hi");

    await composeBulkSpeakerEmailIn(tx, eventId, {
      contactIds: [ada],
      subject: "Sanitize me",
      bodyHtml: "<p>ok</p><script>alert(2)</script>",
      mode: "send",
      sendId: "91000000-0000-4000-8000-000000000012",
    });
    const stored = await pglite.query<{ body_html: string }>(
      "SELECT body_html FROM speaker_bulk_messages WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 1", [ada],
    );
    expect(stored.rows[0]?.body_html).not.toContain("<script>");
    expect(stored.rows[0]?.body_html).toContain("ok");
  });

  it("deduplicates a retried send when the caller reuses its send id", async () => {
    const sendId = "91000000-0000-4000-8000-000000000001";
    const input = {
      contactIds: [ada],
      subject: "Retry-safe update",
      bodyHtml: "<p>Hello {{speaker.first_name}}</p>",
      mode: "send" as const,
      sendId,
    };

    const first = await composeBulkSpeakerEmailIn(tx, eventId, input);
    const idempotencyKey = `${eventId}:speaker_bulk:${ada}:${sendId}`;
    // Model the ambiguous partial failure this retry path exists to heal: the
    // durable message row committed, but its outbox/log row did not.
    await pglite.query("DELETE FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey]);
    const missingLog = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey],
    );
    expect(missingLog.rows[0]?.n).toBe(0);

    const retry = await composeBulkSpeakerEmailIn(tx, eventId, input);

    expect(first.queued).toBe(1);
    expect(first.alreadyQueued).toBe(0);
    expect(retry.queued).toBe(0);
    expect(retry.alreadyQueued).toBe(1);

    const logs = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey],
    );
    const messages = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM speaker_bulk_messages WHERE idempotency_key=$1", [idempotencyKey],
    );
    expect(logs.rows[0]?.n).toBe(1);
    expect(messages.rows[0]?.n).toBe(1);
  });

  it("deduplicates a CRM retry even when the durable contact now resolves to another event", async () => {
    const sendId = "91000000-0000-4000-8000-000000000020";
    const organizationId = organizationIdSchema.parse("e3000000-0000-4000-8000-000000000001");
    const organizationContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000010");
    const idempotencyKey = idem.crmBulk(organizationId, organizationContactId, sendId);
    const message = { subject: "Stable CRM update", bodyHtml: "<p>Hello {{speaker.first_name}}</p>", mode: "send" as const, sendId };

    const first = await composeBulkSpeakerEmailIn(tx, eventId, {
      ...message,
      contactIds: [ada],
      idempotencyKeys: new Map([[ada, idempotencyKey]]),
    });
    // Model the ambiguity between the durable message insert and its outbox
    // insert, then move the CRM contact before retrying.
    await pglite.query("DELETE FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey]);
    const retry = await composeBulkSpeakerEmailIn(tx, movedEventId, {
      ...message,
      contactIds: [movedContact],
      idempotencyKeys: new Map([[movedContact, idempotencyKey]]),
    });

    expect(first).toMatchObject({ queued: 1, alreadyQueued: 0 });
    expect(retry).toMatchObject({ queued: 0, alreadyQueued: 1 });
    const messages = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM speaker_bulk_messages WHERE idempotency_key=$1",
      [idempotencyKey],
    );
    const logs = await pglite.query<{ n: number; event_id: string; contact_id: string }>(
      "SELECT count(*)::int AS n, min(event_id::text) AS event_id, min(contact_id::text) AS contact_id FROM communication_logs WHERE idempotency_key=$1",
      [idempotencyKey],
    );
    expect(messages.rows[0]?.n).toBe(1);
    expect(logs.rows[0]?.n).toBe(1);
    expect(logs.rows[0]).toMatchObject({ event_id: eventId, contact_id: ada });
  });

  it("recovers a queued CRM recipient after its organization contact is merged", async () => {
    const organizationId = organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001");
    const mergedContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000020");
    const primaryContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000021");
    const sendId = "91000000-0000-4000-8000-000000000022";
    const idempotencyKey = idem.crmBulk(organizationId, mergedContactId, sendId);
    await pglite.query(
      "INSERT INTO organization_contacts(id,organization_id,email,first_name,last_name) VALUES ($1,$3,'merged@example.com','Merged','Contact'),($2,$3,'primary@example.com','Primary','Contact')",
      [mergedContactId, primaryContactId, organizationId],
    );
    await pglite.query(
      "INSERT INTO organization_contact_links(organization_id,organization_contact_id,event_id,contact_id) VALUES($1,$2,$3,$4)",
      [organizationId, mergedContactId, eventId, ada],
    );
    const input = {
      organizationContactIds: [mergedContactId],
      subject: "Merge-safe CRM update",
      bodyHtml: "<p>Hello {{speaker.first_name}}</p>",
      mode: "send" as const,
      sendId,
    };

    const first = await composeCrmBulkEmailIn(tx, organizationId, input);
    await pglite.query("DELETE FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey]);
    // Model merge.ts reassigning the losing identity's links to the primary
    // while retaining the loser for audit history.
    await pglite.query("UPDATE organization_contact_links SET organization_contact_id=$1 WHERE organization_contact_id=$2", [primaryContactId, mergedContactId]);
    await pglite.query("UPDATE organization_contacts SET merged_into_id=$1 WHERE id=$2", [primaryContactId, mergedContactId]);

    const retry = await composeCrmBulkEmailIn(tx, organizationId, input);

    expect(first).toMatchObject({ queued: 1, alreadyQueued: 0, errors: [] });
    expect(retry).toMatchObject({ queued: 0, alreadyQueued: 1, errors: [] });
    const logs = await pglite.query<{ n: number; event_id: string; contact_id: string }>(
      "SELECT count(*)::int AS n, min(event_id::text) AS event_id, min(contact_id::text) AS contact_id FROM communication_logs WHERE idempotency_key=$1",
      [idempotencyKey],
    );
    expect(logs.rows[0]).toMatchObject({ n: 1, event_id: eventId, contact_id: ada });
  });

  it("does not queue the surviving CRM identity after its merged alias already committed", async () => {
    const organizationId = organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001");
    const mergedContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000030");
    const primaryContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000031");
    const sendId = "91000000-0000-4000-8000-000000000023";
    const mergedKey = idem.crmBulk(organizationId, mergedContactId, sendId);
    const primaryKey = idem.crmBulk(organizationId, primaryContactId, sendId);
    await pglite.query(
      "INSERT INTO organization_contacts(id,organization_id,email,first_name,last_name) VALUES ($1,$3,'merge-partial@example.com','Merge','Partial'),($2,$3,'merge-primary@example.com','Merge','Primary')",
      [mergedContactId, primaryContactId, organizationId],
    );
    await pglite.query(
      "INSERT INTO organization_contact_links(organization_id,organization_contact_id,event_id,contact_id) VALUES($1,$2,$3,$4),($1,$5,$6,$7)",
      [organizationId, mergedContactId, eventId, grace, primaryContactId, movedEventId, movedContact],
    );
    const message = {
      subject: "Partially committed CRM update",
      bodyHtml: "<p>Hello {{speaker.first_name}}</p>",
      mode: "send" as const,
      sendId,
    };

    // Model a browser batch boundary: the losing identity committed, then a
    // later request for the primary never reached the server.
    const first = await composeCrmBulkEmailIn(tx, organizationId, {
      ...message,
      organizationContactIds: [mergedContactId],
    });
    await pglite.query("DELETE FROM communication_logs WHERE idempotency_key=$1", [mergedKey]);
    await pglite.query("UPDATE organization_contact_links SET organization_contact_id=$1 WHERE organization_contact_id=$2", [primaryContactId, mergedContactId]);
    await pglite.query("UPDATE organization_contacts SET merged_into_id=$1 WHERE id=$2", [primaryContactId, mergedContactId]);

    const retry = await composeCrmBulkEmailIn(tx, organizationId, {
      ...message,
      organizationContactIds: [mergedContactId, primaryContactId],
    });
    // The browser splits a 501-recipient campaign into separate HTTP calls.
    // A later chunk containing only the surviving identity must still find
    // the losing alias's campaign message and avoid a second key/delivery.
    const laterChunk = await composeCrmBulkEmailIn(tx, organizationId, {
      ...message,
      organizationContactIds: [primaryContactId],
    });

    expect(first).toMatchObject({ queued: 1, alreadyQueued: 0, skipped: 0, errors: [] });
    expect(retry).toMatchObject({ queued: 0, alreadyQueued: 1, skipped: 1, errors: [] });
    expect(laterChunk).toMatchObject({ queued: 0, alreadyQueued: 1, skipped: 0, errors: [] });
    const messages = await pglite.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM speaker_bulk_messages WHERE idempotency_key IN ($1,$2) ORDER BY idempotency_key",
      [mergedKey, primaryKey],
    );
    const logs = await pglite.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM communication_logs WHERE idempotency_key IN ($1,$2) ORDER BY idempotency_key",
      [mergedKey, primaryKey],
    );
    expect(messages.rows).toEqual([{ idempotency_key: mergedKey }]);
    expect(logs.rows).toEqual([{ idempotency_key: mergedKey }]);
  });

  it("keeps overlapping CRM retries on the one winning destination", async () => {
    const sendId = "91000000-0000-4000-8000-000000000021";
    const organizationId = organizationIdSchema.parse("e3000000-0000-4000-8000-000000000001");
    const organizationContactId = organizationContactIdSchema.parse("e3000000-0000-4000-8000-000000000011");
    const idempotencyKey = idem.crmBulk(organizationId, organizationContactId, sendId);
    const message = { subject: "Concurrent CRM update", bodyHtml: "<p>Hello {{speaker.first_name}}</p>", mode: "send" as const, sendId };

    const [oldLink, newLink] = await Promise.all([
      composeBulkSpeakerEmailIn(tx, eventId, {
        ...message,
        contactIds: [ada],
        idempotencyKeys: new Map([[ada, idempotencyKey]]),
      }),
      composeBulkSpeakerEmailIn(tx, movedEventId, {
        ...message,
        contactIds: [movedContact],
        idempotencyKeys: new Map([[movedContact, idempotencyKey]]),
      }),
    ]);

    expect(oldLink.queued + newLink.queued).toBe(1);
    expect(oldLink.alreadyQueued + newLink.alreadyQueued).toBe(1);
    const destinations = await pglite.query<{ message_event: string; message_contact: string; log_event: string; log_contact: string }>(
      `SELECT m.event_id::text AS message_event, m.contact_id::text AS message_contact,
              l.event_id::text AS log_event, l.contact_id::text AS log_contact
       FROM speaker_bulk_messages m
       JOIN communication_logs l USING (idempotency_key)
       WHERE m.idempotency_key=$1`,
      [idempotencyKey],
    );
    expect(destinations.rows).toHaveLength(1);
    expect(destinations.rows[0]?.log_event).toBe(destinations.rows[0]?.message_event);
    expect(destinations.rows[0]?.log_contact).toBe(destinations.rows[0]?.message_contact);
  });
});
