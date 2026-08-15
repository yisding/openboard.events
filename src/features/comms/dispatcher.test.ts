import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sealPortalLoginPayload } from "@/features/auth";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  sessionIdSchema,
  submissionIdSchema,
  taskIdSchema,
  tokenIdSchema, userIdSchema, TEMPLATE_KEYS } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { dispatchOutboxIn } from "./server/dispatcher";
import { listLogIn } from "./server/queries";
import type { EmailMessage } from "@/shared/server/email-provider";
import { recordSuppressionIn } from "./server/suppression";
import { seedDefaultTemplates } from "./server/templates";
import { signUnsubscribeToken, unsubscribeFromRemindersIn, verifyUnsubscribeToken } from "./server/unsubscribe";
import { deleteSessionIn } from "@/features/agenda/server/mutations";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// P3-EMAIL: comm_status bounced/complained, contacts suppression columns,
// events.physical_address.
const migrationEmailCompliance = readFileSync(new URL("../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M51 appended `speaker_bulk_message` to `template_key`; `seedDefaultTemplates`
// needs every migration that ever appended a label, in order.
const migrationRoster = readFileSync(new URL("../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M42 adds the admin_password_reset / admin_email_verification template keys,
// which `seedDefaultTemplates` inserts for every event.
const migrationProductAuth = readFileSync(new URL("../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43's `organizations` table is what M44's `organization_invitations`/
// `organization_audit_log` FK against; M44 appended `organization_invited` to
// `template_key`, which `seedDefaultTemplates` inserts for every event —
// both are required for the same reason `migrationProductAuth` is.
const migrationTenancy = readFileSync(new URL("../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");
// M59 added `contacts.acceptance_seen_at`; `unsubscribeFromRemindersIn`'s
// unqualified `.returning()` needs every declared column to exist.
const migrationSpeakerMoments = readFileSync(new URL("../../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");
// First Fair — `buildContext` now selects `events.is_demo` (the demo-event mail
// barrier), so every dispatcher fixture needs the column. 0044 widens 0023's
// milestone CHECK, which is why the milestone table comes along with it.
const migrationOnboardingMilestones = readFileSync(new URL("../../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
const migrationDemoEvents = readFileSync(new URL("../../../drizzle/0044_demo_events_and_tour.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const emptyEventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const contactId = contactIdSchema.parse("c0000000-0000-4000-8000-000000000003");
const receivedId = submissionIdSchema.parse("c0000000-0000-4000-8000-000000000004");
const decisionId = submissionIdSchema.parse("c0000000-0000-4000-8000-000000000005");
const formId = "c0000000-0000-4000-8000-000000000006";
const sessionId = sessionIdSchema.parse("c0000000-0000-4000-8000-000000000007");
const reminderTaskId = taskIdSchema.parse("c0000000-0000-4000-8000-000000000008");
const secret = "dispatcher-test-secret-that-is-at-least-32-bytes";
const logEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  // M46 — dedicated key for unsubscribe token signing, distinct from
  // SESSION_SECRET; every non-essential send in this file needs it.
  UNSUBSCRIBE_SECRET: secret,
  EMAIL_MODE: "log",
  EMAIL_FALLBACK_UI: "1",
});
const sendEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  UNSUBSCRIBE_SECRET: secret,
  EMAIL_MODE: "send",
  EMAIL_FALLBACK_UI: "0",
  EMAIL_FROM: "mail@example.com",
  EMAIL_REPLY_TO: "replies@example.com",
  RESEND_API_KEY: "re_test",
});
const productionSendEnv = parseEnv({
  ...sendEnv,
  APP_ENV: "production",
  APP_BASE_URL: "https://events.example.com",
  DATABASE_URL: "postgres://user:pass@db.example.com/openboard",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "sb-files",
  DEPLOYMENT_ID: "dispatcher-test-production",
  RESEND_WEBHOOK_SECRET: "w".repeat(32),
  SPEAKER_SHARE_SECRET: "p".repeat(32),
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
});

describe("communications outbox dispatcher", () => {
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
    await pglite.exec(migrationSpeakerMoments);
    await pglite.exec(migrationCalendarCancellationSnapshots);
    await pglite.exec(migrationOnboardingMilestones);
    await pglite.exec(migrationDemoEvents);
    await pglite.query("INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Empty','empty','Online','UTC','2026-10-01T09:00:00Z','2026-10-01T17:00:00Z')", [eventId, emptyEventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Nadia','Lee')", [contactId, eventId]);
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Main CFP','open')", [formId, eventId]);
    await pglite.query("INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id) VALUES($1,$3,$4,1,7,'pending',';lkj<img onerror=alert(1)>','cfp',$5),($2,$3,$4,1,8,'accepted','Decision session','cfp',$5)", [receivedId, decisionId, eventId, formId, contactId]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary) VALUES($1,$2,$3,true)", [eventId, decisionId, contactId]);
    await pglite.query("INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,$3,'Decision session','decision-session','2026-09-15T18:00:00Z','2026-09-15T18:30:00Z','published')", [sessionId, eventId, decisionId]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)", [eventId, sessionId, contactId]);
    await pglite.query("INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at) VALUES($1,$2,'Complete profile','contact','manual','2026-09-01T07:00:00Z')", [reminderTaskId, eventId]);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM calendar_invites");
    await pglite.query("DELETE FROM portal_tokens");
    await pglite.query("UPDATE contacts SET email='speaker@example.com',unsubscribed_at=NULL WHERE id=$1", [contactId]);
    await pglite.query("DELETE FROM contact_suppressions WHERE contact_id=$1", [contactId]);
    await pglite.query("UPDATE events SET physical_address=NULL WHERE id=$1", [eventId]);
    await pglite.query("UPDATE submissions SET status='accepted' WHERE id=$1", [decisionId]);
    await pglite.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status,schedule_revision,row_version)
       VALUES($1,$2,$3,'Decision session','decision-session','2026-09-15T18:00:00Z','2026-09-15T18:30:00Z','published',0,1)
       ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='published',
         schedule_revision=0,row_version=1,title=excluded.title,slug=excluded.slug`,
      [sessionId, eventId, decisionId],
    );
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [eventId, sessionId, contactId]);
  });

  afterAll(async () => pglite.close());

  // M50 appended `reviewer_invited` and `review_reminder` to TEMPLATE_KEYS, so
  // the fixed set is ten: the count is asserted against the contract rather than
  // a literal, which is what made it a useful guard in the first place.
  it("seeds exactly one template per key and three reminder rungs idempotently", async () => {
    await seedDefaultTemplates(tx, eventId);
    await seedDefaultTemplates(tx, eventId);
    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [eventId]);
    const reminders = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reminder_rules WHERE event_id=$1", [eventId]);
    expect(templates.rows[0]?.n).toBe(TEMPLATE_KEYS.length);
    expect(reminders.rows[0]?.n).toBe(3);
  });

  it("renders and records a queued email exactly once in log mode", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: idem.received(eventId, receivedId), refs: { submissionId: receivedId } });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toEqual({ claimed: 1, sent: 1, skipped: 0, failed: 0, retried: 0 });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 });
    const stored = await pglite.query<{ status: string; provider_message_id: string; body_rendered_html: string }>("SELECT status,provider_message_id,body_rendered_html FROM communication_logs WHERE idempotency_key=$1", [idem.received(eventId, receivedId)]);
    expect(stored.rows[0]).toMatchObject({ status: "sent", provider_message_id: "log-mode" });
    expect(stored.rows[0]?.body_rendered_html).toContain(";lkj&lt;img onerror=alert(1)&gt;");
    expect(stored.rows[0]?.body_rendered_html).not.toContain("<img onerror");
  });

  /**
   * Legacy reviewer invitation rows can exist before a reviewer is assigned to
   * a round. They must remain renderable during migration to the product-level,
   * email-bound reviewer invitation path.
   */
  it("renders a reviewer invitation before the reviewer is on any round, and names the round once there is one", async () => {
    await seedDefaultTemplates(tx, eventId);
    const nina = userIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
    const omar = userIdSchema.parse("c0000000-0000-4000-8000-00000000000b");
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'nina@example.com','Nina'),($2,'omar@example.com','Omar') ON CONFLICT DO NOTHING", [nina, omar]);

    await enqueueEmail(tx, { eventId, contactId, templateKey: "reviewer_invited", idempotencyKey: idem.reviewerInvited(eventId, nina) });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    const unassigned = await pglite.query<{ status: string; body_rendered_html: string }>(
      "SELECT status,body_rendered_html FROM communication_logs WHERE idempotency_key=$1",
      [idem.reviewerInvited(eventId, nina)],
    );
    expect(unassigned.rows[0]?.status).toBe("sent");
    // No round exists, so none is named — the invitation must not send the
    // reviewer looking for a round that is not there.
    expect(unassigned.rows[0]?.body_rendered_html).toContain("not yet announced");
    expect(unassigned.rows[0]?.body_rendered_html).toContain("/events/");

    const planId = "c0000000-0000-4000-8000-00000000000c";
    await pglite.query(
      "INSERT INTO evaluation_plans(id,event_id,name,round,scale_min,scale_max,status) VALUES($1,$2,'Round 1',1,1,5,'open')",
      [planId, eventId],
    );
    await enqueueEmail(tx, { eventId, contactId, templateKey: "reviewer_invited", idempotencyKey: idem.reviewerInvited(eventId, omar) });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    const assigned = await pglite.query<{ body_rendered_html: string }>(
      "SELECT body_rendered_html FROM communication_logs WHERE idempotency_key=$1",
      [idem.reviewerInvited(eventId, omar)],
    );
    expect(assigned.rows[0]?.body_rendered_html).toContain("Round 1");
    await pglite.query("DELETE FROM evaluation_plans WHERE id=$1", [planId]);
  });

  it("uses per-form confirmation overrides with the same safe renderer", async () => {
    await seedDefaultTemplates(tx, eventId);
    await pglite.query("UPDATE forms SET confirmation_subject='Custom: {{submission.title}}',confirmation_body_html='<p>Hello {{speaker.first_name}} — {{submission.title}}</p>' WHERE id=$1", [formId]);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:override`, refs: { submissionId: receivedId } });
    await dispatchOutboxIn(tx, 50, { env: logEnv });
    const row = await pglite.query<{ subject_rendered: string; body_rendered_html: string }>("SELECT subject_rendered,body_rendered_html FROM communication_logs");
    expect(row.rows[0]?.subject_rendered).toBe("Custom: ;lkj<img onerror=alert(1)>");
    expect(row.rows[0]?.body_rendered_html).toContain("Hello Nadia — ;lkj&lt;img onerror=alert(1)&gt;");
    await pglite.query("UPDATE forms SET confirmation_subject=NULL,confirmation_body_html=NULL WHERE id=$1", [formId]);
  });

  it("skips a decision row when the organizer has undone the decision", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_accepted", idempotencyKey: `${eventId}:decision:${decisionId}:1`, refs: { submissionId: decisionId } });
    await pglite.query("UPDATE submissions SET status='pending' WHERE id=$1", [decisionId]);
    const sender = vi.fn(async () => "sent-id");
    const before = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_tokens");
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toEqual({ claimed: 1, sent: 0, skipped: 1, failed: 0, retried: 0 });
    const after = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_tokens");
    expect(sender).not.toHaveBeenCalled();
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const row = await pglite.query<{ status: string; error: string }>("SELECT status,error FROM communication_logs");
    expect(row.rows[0]).toEqual({ status: "skipped", error: "submission is no longer accepted" });
  });

  it("backs off provider failures and makes the sixth attempt terminal", async () => {
    await seedDefaultTemplates(tx, eventId);
    const key = `${eventId}:provider-retry`;
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: key, refs: { submissionId: receivedId } });
    const sender = vi.fn(async () => { throw new Error("provider 500"); });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toEqual({ claimed: 1, sent: 0, skipped: 0, failed: 0, retried: 1 });
    const retry = await pglite.query<{ status: string; attempts: number; delay_seconds: number; unlocked: boolean }>("SELECT status,attempts,extract(epoch from (next_attempt_at-now()))::int AS delay_seconds,locked_until IS NULL AS unlocked FROM communication_logs WHERE idempotency_key=$1", [key]);
    expect(retry.rows[0]).toMatchObject({ status: "queued", attempts: 1, unlocked: true });
    expect(retry.rows[0]?.delay_seconds).toBeGreaterThanOrEqual(115);
    expect(retry.rows[0]?.delay_seconds).toBeLessThanOrEqual(120);
    await pglite.query("UPDATE communication_logs SET attempts=5,next_attempt_at=now() WHERE idempotency_key=$1", [key]);
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toEqual({ claimed: 1, sent: 0, skipped: 0, failed: 1, retried: 0 });
    const terminal = await pglite.query<{ status: string; attempts: number }>("SELECT status,attempts FROM communication_logs WHERE idempotency_key=$1", [key]);
    expect(terminal.rows[0]).toEqual({ status: "failed", attempts: 6 });
  });

  it("reclaims an expired crash lock", async () => {
    await seedDefaultTemplates(tx, eventId);
    const key = `${eventId}:crashed-claim`;
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: key, refs: { submissionId: receivedId } });
    await pglite.query("UPDATE communication_logs SET locked_until=now()-interval '1 minute' WHERE idempotency_key=$1", [key]);
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toMatchObject({ claimed: 1, sent: 1 });
  });

  it("fails corrupted login envelopes, clears secrets, and continues the batch", async () => {
    await seedDefaultTemplates(tx, eventId);
    const firstToken = tokenIdSchema.parse("c0000000-0000-4000-8000-000000000011");
    const secondToken = tokenIdSchema.parse("c0000000-0000-4000-8000-000000000012");
    const payload = { otp: "123456", magicLink: "http://localhost:3000/portal/ai-engineer/verify?token=secret" };
    const sealed = await sealPortalLoginPayload(payload, { eventId, contactId, tokenId: firstToken }, secret);
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
    const unknown = await sealPortalLoginPayload(payload, { eventId, contactId, tokenId: secondToken }, secret);
    unknown[0] = 2;
    await enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey: idem.portalLogin(eventId, contactId, firstToken), secretPayloadCiphertext: sealed });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey: idem.portalLogin(eventId, contactId, secondToken), secretPayloadCiphertext: unknown });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toEqual({ claimed: 2, sent: 0, skipped: 0, failed: 2, retried: 0 });
    const rows = await pglite.query<{ status: string; secret_cleared: boolean }>("SELECT status,secret_payload_ciphertext IS NULL AS secret_cleared FROM communication_logs ORDER BY idempotency_key");
    expect(rows.rows).toEqual([{ status: "failed", secret_cleared: true }, { status: "failed", secret_cleared: true }]);
  });

  it("redacts a valid login credential from non-diagnostic audit storage", async () => {
    await seedDefaultTemplates(tx, eventId);
    const tokenId = tokenIdSchema.parse("c0000000-0000-4000-8000-000000000013");
    const secretPayloadCiphertext = await sealPortalLoginPayload({
      otp: "654321",
      magicLink: "http://localhost:3000/portal/ai-engineer/verify?token=live-secret",
    }, { eventId, contactId, tokenId }, secret);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey: idem.portalLogin(eventId, contactId, tokenId), secretPayloadCiphertext });
    const redactedLogEnv = parseEnv({ ...logEnv, EMAIL_FALLBACK_UI: "0" });
    await expect(dispatchOutboxIn(tx, 50, { env: redactedLogEnv })).resolves.toMatchObject({ sent: 1 });
    const row = await pglite.query<{ body: string; cleared: boolean }>("SELECT body_rendered_html AS body,secret_payload_ciphertext IS NULL AS cleared FROM communication_logs");
    expect(row.rows[0]?.cleared).toBe(true);
    expect(row.rows[0]?.body).toContain("[redacted]");
    expect(row.rows[0]?.body).not.toContain("654321");
    expect(row.rows[0]?.body).not.toContain("live-secret");
  });

  it("applies the send allowlist before minting tokens or calling the provider", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:allowlist`, refs: { submissionId: receivedId } });
    const sender = vi.fn(async () => "sent-id");
    const env = parseEnv({ ...sendEnv, EMAIL_ALLOWLIST: "@example.org" });
    await expect(dispatchOutboxIn(tx, 50, { env, sender })).resolves.toEqual({ claimed: 1, sent: 0, skipped: 1, failed: 0, retried: 0 });
    expect(sender).not.toHaveBeenCalled();
    const tokens = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_tokens");
    expect(tokens.rows[0]?.n).toBe(0);
  });

  it("renders calendar downloads in the token-first route format", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:schedule-link`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toMatchObject({ sent: 1 });
    const stored = await pglite.query<{ body: string; ics_uid: string }>("SELECT body_rendered_html AS body,ics_uid FROM communication_logs");
    expect(stored.rows[0]?.body).toContain("Sep 15, 2026, 11:00 AM–11:30 AM PDT");
    expect(stored.rows[0]?.body).not.toContain("America/Los_Angeles");
    expect(stored.rows[0]?.body).toMatch(new RegExp(`/cal/[^/?\"&]+/${sessionId}`));
    expect(stored.rows[0]?.body).not.toContain(`/cal/${sessionId}?token=`);
    expect(stored.rows[0]?.ics_uid).toContain(`sess-${sessionId}-spk-${contactId}@`);
    const inviteState = await pglite.query<{ sequence: number; last_method: string }>("SELECT sequence,last_method FROM calendar_invites");
    expect(inviteState.rows[0]).toEqual({ sequence: 0, last_method: "request" });

    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM portal_tokens");
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:schedule-link-production`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: productionSendEnv, sender: vi.fn(async () => "sent-id") })).resolves.toMatchObject({ sent: 1 });
    const redacted = await pglite.query<{ body: string }>("SELECT body_rendered_html AS body FROM communication_logs");
    expect(redacted.rows[0]?.body).toContain(`/cal/[redacted]/${sessionId}`);
  });

  it("keeps UID and organizer stable across request, reschedule, and cancel attachments", async () => {
    await seedDefaultTemplates(tx, eventId);
    const messages: EmailMessage[] = [];
    const sender = vi.fn(async (message: EmailMessage) => {
      messages.push(message);
      return `sent-${messages.length}`;
    });

    const displaySenderEnv = parseEnv({ ...sendEnv, EMAIL_FROM: "AI Engineer Sandbox <mail@example.com>" });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:invite:0`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: displaySenderEnv, sender })).resolves.toMatchObject({ sent: 1 });

    await pglite.query("UPDATE sessions SET starts_at='2026-09-15T19:00:00Z',ends_at='2026-09-15T19:30:00Z',schedule_revision=1 WHERE id=$1", [sessionId]);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_changed", idempotencyKey: `${eventId}:invite:1`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: displaySenderEnv, sender })).resolves.toMatchObject({ sent: 1 });

    await pglite.query("DELETE FROM session_speakers WHERE session_id=$1 AND contact_id=$2", [sessionId, contactId]);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_changed", idempotencyKey: `${eventId}:invite:2`, refs: { sessionId } });
    const changedSenderEnv = parseEnv({ ...sendEnv, EMAIL_FROM: "calendar@other.example" });
    await expect(dispatchOutboxIn(tx, 50, { env: changedSenderEnv, sender })).resolves.toMatchObject({ sent: 1 });

    expect(sender).toHaveBeenCalledTimes(3);
    expect(messages[0]?.from).toBe("AI Engineer Sandbox <mail@example.com>");
    expect(messages[0]?.replyTo).toBe("replies@example.com");
    const calendars = messages.map((message) => {
      const attachment = message.attachments?.[0];
      expect(attachment?.filename).toBe("invite.ics");
      const bytes = Uint8Array.from(atob(attachment?.content ?? ""), (character) => character.charCodeAt(0));
      return new TextDecoder().decode(bytes).replaceAll("\r\n ", "");
    });
    expect(calendars[0]).toContain("METHOD:REQUEST\r\n");
    expect(calendars[0]).toContain("SEQUENCE:0\r\n");
    expect(calendars[1]).toContain("SEQUENCE:1\r\n");
    expect(calendars[2]).toContain("METHOD:CANCEL\r\n");
    expect(calendars[2]).toContain("SEQUENCE:2\r\n");
    for (const calendar of calendars) {
      expect(calendar).toContain("ORGANIZER;CN=\"AI Engineer\":mailto:mail@example.com");
      expect(calendar).toContain("ATTENDEE;CN=\"Nadia Lee\";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:speaker@example.com");
    }
    expect(messages[0]?.attachments?.[0]?.content_type).toContain("method=REQUEST");
    expect(messages[2]?.attachments?.[0]?.content_type).toContain("method=CANCEL");

    const state = await pglite.query<{ sequence: number; last_method: string; ics_uid: string; organizer_email: string }>(
      "SELECT sequence,last_method,ics_uid,organizer_email FROM calendar_invites",
    );
    expect(state.rows[0]).toMatchObject({ sequence: 2, last_method: "cancel", organizer_email: "mail@example.com" });
    const logUids = await pglite.query<{ ics_uid: string }>("SELECT DISTINCT ics_uid FROM communication_logs");
    expect(logUids.rows).toEqual([{ ics_uid: state.rows[0]?.ics_uid }]);
  });

  it("delivers a self-contained CANCEL after the session and invite state are hard-deleted", async () => {
    await seedDefaultTemplates(tx, eventId);
    const messages: EmailMessage[] = [];
    const sender = vi.fn(async (message: EmailMessage) => {
      messages.push(message);
      return `hard-delete-${messages.length}`;
    });

    await enqueueEmail(tx, {
      eventId,
      contactId,
      templateKey: "schedule_assigned",
      idempotencyKey: `${eventId}:hard-delete:request`,
      refs: { sessionId },
    });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toMatchObject({ sent: 1 });

    await deleteSessionIn(tx, eventId, sessionId, 1);
    const queued = await pglite.query<{ session_id: string | null; has_snapshot: boolean }>(
      `SELECT logs.session_id, jobs.snapshot IS NOT NULL AS has_snapshot
       FROM communication_logs logs
       JOIN calendar_cancellation_jobs jobs ON jobs.communication_log_id=logs.id
       WHERE logs.status='queued'`,
    );
    expect(queued.rows).toEqual([{ session_id: null, has_snapshot: true }]);
    expect((await pglite.query("SELECT id FROM calendar_invites")).rows).toHaveLength(0);

    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toMatchObject({ sent: 1 });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.subject).toBe("Schedule removed: Decision session");
    const requestAttachment = messages[0]?.attachments?.[0];
    const cancelAttachment = messages[1]?.attachments?.[0];
    const decode = (content = "") => new TextDecoder()
      .decode(Uint8Array.from(atob(content), (character) => character.charCodeAt(0)))
      .replaceAll("\r\n ", "");
    const requestCalendar = decode(requestAttachment?.content);
    const cancelCalendar = decode(cancelAttachment?.content);
    expect(requestCalendar).toContain("METHOD:REQUEST\r\n");
    expect(cancelCalendar).toContain("METHOD:CANCEL\r\n");
    expect(cancelCalendar).toContain("SEQUENCE:1\r\n");
    expect(cancelCalendar.match(/UID:[^\r]+/u)?.[0]).toBe(requestCalendar.match(/UID:[^\r]+/u)?.[0]);
    expect(cancelCalendar.match(/DTSTART:[^\r]+/u)?.[0]).toBe(requestCalendar.match(/DTSTART:[^\r]+/u)?.[0]);

    const terminal = await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM calendar_cancellation_jobs",
    );
    expect(terminal.rows[0]?.count).toBe(0);
  });

  it("does not send a cancellation to an attendee address the contact no longer owns", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, {
      eventId,
      contactId,
      templateKey: "schedule_assigned",
      idempotencyKey: `${eventId}:address-change:request`,
      refs: { sessionId },
    });
    await expect(dispatchOutboxIn(tx, 50, {
      env: sendEnv,
      sender: vi.fn(async () => "request-sent"),
    })).resolves.toMatchObject({ sent: 1 });
    await deleteSessionIn(tx, eventId, sessionId, 1);
    await pglite.query("UPDATE contacts SET email='new-speaker@example.com' WHERE id=$1", [contactId]);

    const sender = vi.fn(async () => "should-not-send");
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender }))
      .resolves.toMatchObject({ sent: 0, skipped: 1 });
    expect(sender).not.toHaveBeenCalled();
    const [log] = (await pglite.query<{ status: string; error: string }>(
      "SELECT status,error FROM communication_logs WHERE idempotency_key LIKE '%:calendar_cancel:%'",
    )).rows;
    expect(log).toEqual({ status: "skipped", error: "attendee address changed since the invite was sent" });
    expect((await pglite.query("SELECT communication_log_id FROM calendar_cancellation_jobs")).rows).toHaveLength(0);
  });

  it("retries a failed CANCEL with the same sequence", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:cancel-retry:request`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender: vi.fn(async () => "request-sent") })).resolves.toMatchObject({ sent: 1 });

    await pglite.query("DELETE FROM session_speakers WHERE session_id=$1 AND contact_id=$2", [sessionId, contactId]);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_changed", idempotencyKey: `${eventId}:cancel-retry:cancel`, refs: { sessionId } });
    const failingSender = vi.fn(async () => { throw new Error("provider unavailable"); });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender: failingSender })).resolves.toMatchObject({ retried: 1 });
    const prepared = await pglite.query<{ sequence: number; last_method: string }>("SELECT sequence,last_method FROM calendar_invites");
    expect(prepared.rows[0]).toEqual({ sequence: 1, last_method: "cancel" });
    expect((await pglite.query("SELECT communication_log_id FROM calendar_cancellation_jobs")).rows).toHaveLength(1);

    // Live state changes before retry, but the provider idempotency key already
    // names a CANCEL. The retry must reproduce that exact intent, not reinterpret
    // the row as a new REQUEST.
    await pglite.query(
      "INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)",
      [eventId, sessionId, contactId],
    );

    await pglite.query("UPDATE communication_logs SET next_attempt_at=now() WHERE idempotency_key=$1", [`${eventId}:cancel-retry:cancel`]);
    const retriedMessages: EmailMessage[] = [];
    const retrySender = vi.fn(async (message: EmailMessage) => {
      retriedMessages.push(message);
      return "cancel-sent";
    });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender: retrySender })).resolves.toMatchObject({ sent: 1 });
    const attachment = retriedMessages[0]?.attachments?.[0];
    const bytes = Uint8Array.from(atob(attachment?.content ?? ""), (character) => character.charCodeAt(0));
    const calendar = new TextDecoder().decode(bytes).replaceAll("\r\n ", "");
    expect(calendar).toContain("METHOD:CANCEL\r\n");
    expect(calendar).toContain("SEQUENCE:1\r\n");
    const delivered = await pglite.query<{ sequence: number; last_method: string }>("SELECT sequence,last_method FROM calendar_invites");
    expect(delivered.rows[0]).toEqual({ sequence: 1, last_method: "cancel" });
  });

  it("fails closed without sending when ATTENDEE differs from To", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:invite:mismatch`, refs: { sessionId } });
    const sender = vi.fn(async () => "sent-id");
    const invitePreparer = vi.fn(async () => ({
      ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      filename: "invite.ics" as const,
      contentType: "text/calendar; charset=utf-8; method=REQUEST",
      uid: "wrong-attendee@example.com",
      sequence: 0,
      method: "REQUEST" as const,
      attendeeEmail: "someone-else@example.com",
      googleUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      outlookUrl: "https://outlook.live.com/calendar/0/deeplink/compose?rru=addevent",
      downloadUrl: "https://events.example.com/cal/token/session",
    }));
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender, invitePreparer })).resolves.toEqual({ claimed: 1, sent: 0, skipped: 0, failed: 1, retried: 0 });
    expect(sender).not.toHaveBeenCalled();
    const [failed] = (await pglite.query<{ status: string; error: string }>("SELECT status,error FROM communication_logs")).rows;
    expect(failed).toMatchObject({ status: "failed", error: "calendar ATTENDEE must match the email recipient" });
  });

  it("uses a scoped unsubscribe capability and persists the reminder opt-out", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "task_reminder", idempotencyKey: `${eventId}:reminder-link`, refs: { taskId: reminderTaskId } });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toMatchObject({ sent: 1 });
    const stored = await pglite.query<{ body: string }>("SELECT body_rendered_html AS body FROM communication_logs");
    expect(stored.rows[0]?.body).toContain("/portal/ai-engineer/unsubscribe?token=");
    expect(stored.rows[0]?.body).not.toContain("?contact=");

    const token = await signUnsubscribeToken({ eventId, contactId }, secret);
    await expect(verifyUnsubscribeToken(token, secret)).resolves.toMatchObject({ eventId, contactId, purpose: "task_reminder_unsubscribe" });
    await expect(unsubscribeFromRemindersIn(tx, "wrong-event", token, secret)).resolves.toBe(false);
    await expect(unsubscribeFromRemindersIn(tx, "ai-engineer", token, secret)).resolves.toBe(true);
    const contact = await pglite.query<{ unsubscribed: boolean }>("SELECT unsubscribed_at IS NOT NULL AS unsubscribed FROM contacts WHERE id=$1", [contactId]);
    expect(contact.rows[0]?.unsubscribed).toBe(true);
  });

  it("honors contacts.unsubscribed_at fleet-wide, exempting only decision/schedule/portal-login mail", async () => {
    await seedDefaultTemplates(tx, eventId);
    await pglite.query("UPDATE contacts SET unsubscribed_at=now() WHERE id=$1", [contactId]);
    const tokenId = tokenIdSchema.parse("c0000000-0000-4000-8000-000000000021");
    const secretPayloadCiphertext = await sealPortalLoginPayload(
      { otp: "111111", magicLink: "http://localhost:3000/portal/ai-engineer/verify?token=x" },
      { eventId, contactId, tokenId },
      secret,
    );
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:unsub:received`, refs: { submissionId: receivedId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "task_assigned", idempotencyKey: `${eventId}:unsub:task`, refs: { taskId: reminderTaskId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_accepted", idempotencyKey: `${eventId}:unsub:decision`, refs: { submissionId: decisionId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:unsub:schedule`, refs: { sessionId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey: idem.portalLogin(eventId, contactId, tokenId), secretPayloadCiphertext });

    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toEqual({ claimed: 5, sent: 3, skipped: 2, failed: 0, retried: 0 });
    const rows = await pglite.query<{ idempotency_key: string; status: string; error: string | null }>(
      "SELECT idempotency_key,status,error FROM communication_logs ORDER BY idempotency_key",
    );
    const byKey = Object.fromEntries(rows.rows.map((row) => [row.idempotency_key, row]));
    expect(byKey[`${eventId}:unsub:received`]).toMatchObject({ status: "skipped", error: "contact unsubscribed from non-essential email" });
    expect(byKey[`${eventId}:unsub:task`]).toMatchObject({ status: "skipped", error: "contact unsubscribed from non-essential email" });
    expect(byKey[`${eventId}:unsub:decision`]).toMatchObject({ status: "sent" });
    expect(byKey[`${eventId}:unsub:schedule`]).toMatchObject({ status: "sent" });
    expect(byKey[idem.portalLogin(eventId, contactId, tokenId)]).toMatchObject({ status: "sent" });
  });

  it("suppresses a contact fleet-wide after a bounce/complaint webhook, including decision/schedule/portal-login mail", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:bounce:seed`, refs: { submissionId: receivedId } });
    const sender = vi.fn(async () => "resend-bounce-id");
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toMatchObject({ sent: 1 });

    const target = await recordSuppressionIn(tx, { providerMessageId: "resend-bounce-id", reason: "bounce" });
    expect(target).toEqual({ eventId, contactId });
    const suppression = await pglite.query<{ reason: string }>(
      "SELECT reason FROM contact_suppressions WHERE contact_id=$1", [contactId],
    );
    expect(suppression.rows[0]).toEqual({ reason: "bounce" });
    const seedLog = await pglite.query<{ status: string }>("SELECT status FROM communication_logs WHERE idempotency_key=$1", [`${eventId}:bounce:seed`]);
    expect(seedLog.rows[0]?.status).toBe("bounced");

    // Redelivery of the same webhook event (Resend/Svix retries on non-2xx)
    // must not error and must not fight the already-'bounced' log row.
    await expect(recordSuppressionIn(tx, { providerMessageId: "resend-bounce-id", reason: "bounce" })).resolves.toEqual({ eventId, contactId });

    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_accepted", idempotencyKey: `${eventId}:bounce:decision`, refs: { submissionId: decisionId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: `${eventId}:bounce:schedule`, refs: { sessionId } });
    await expect(dispatchOutboxIn(tx, 50, { env: logEnv })).resolves.toEqual({ claimed: 2, sent: 0, skipped: 2, failed: 0, retried: 0 });
    const rows = await pglite.query<{ error: string }>("SELECT error FROM communication_logs WHERE idempotency_key IN ($1,$2)", [`${eventId}:bounce:decision`, `${eventId}:bounce:schedule`]);
    expect(rows.rows.every((row) => row.error === "contact suppressed (bounce)")).toBe(true);
  });

  it("attaches List-Unsubscribe only to non-essential sends and renders the CAN-SPAM address in the footer", async () => {
    await seedDefaultTemplates(tx, eventId);
    await pglite.query("UPDATE events SET physical_address='123 Main St, Suite 100, San Francisco, CA 94105' WHERE id=$1", [eventId]);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:headers:non-essential`, refs: { submissionId: receivedId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_accepted", idempotencyKey: `${eventId}:headers:essential`, refs: { submissionId: decisionId } });
    const messages: EmailMessage[] = [];
    const sender = vi.fn(async (message: EmailMessage) => { messages.push(message); return `sent-${messages.length}`; });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender })).resolves.toMatchObject({ sent: 2 });

    const nonEssential = messages.find((message) => message.idempotencyKey === `${eventId}:headers:non-essential`);
    const essential = messages.find((message) => message.idempotencyKey === `${eventId}:headers:essential`);
    expect(nonEssential?.headers?.["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/portal\/ai-engineer\/unsubscribe\?token=.+>$/u);
    expect(essential?.headers).toBeUndefined();

    const rows = await pglite.query<{ idempotency_key: string; body: string }>(
      "SELECT idempotency_key,body_rendered_html AS body FROM communication_logs WHERE idempotency_key IN ($1,$2)",
      [`${eventId}:headers:non-essential`, `${eventId}:headers:essential`],
    );
    for (const row of rows.rows) expect(row.body).toContain("123 Main St, Suite 100, San Francisco, CA 94105");
    const nonEssentialRow = rows.rows.find((row) => row.idempotency_key === `${eventId}:headers:non-essential`);
    const essentialRow = rows.rows.find((row) => row.idempotency_key === `${eventId}:headers:essential`);
    expect(nonEssentialRow?.body).toContain("Unsubscribe");
    expect(essentialRow?.body).not.toContain("Unsubscribe");
  });

  it("claims concurrent batches without overlap", async () => {
    await seedDefaultTemplates(tx, eventId);
    await tx.insert(schema.communicationLogs).values(Array.from({ length: 60 }, (_value, index) => ({
      eventId,
      contactId,
      templateKey: "submission_received" as const,
      idempotencyKey: `${eventId}:concurrent:${index}`,
      submissionId: receivedId,
      status: "queued" as const,
    })));
    const [first, second] = await Promise.all([
      dispatchOutboxIn(tx, 50, { env: logEnv }),
      dispatchOutboxIn(tx, 50, { env: logEnv }),
    ]);
    expect(first.claimed + second.claimed).toBe(60);
    expect(first.sent + second.sent).toBe(60);
    const rows = await pglite.query<{ sent: number; attempts: number }>("SELECT count(*) FILTER (WHERE status='sent')::int AS sent,sum(attempts)::int AS attempts FROM communication_logs");
    expect(rows.rows[0]).toEqual({ sent: 60, attempts: 60 });
  }, 30_000);

  it("keeps communication log queries event scoped", async () => {
    await seedDefaultTemplates(tx, eventId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: `${eventId}:list-log`, refs: { submissionId: receivedId } });
    await dispatchOutboxIn(tx, 50, { env: logEnv });
    await expect(listLogIn(tx, eventId)).resolves.toHaveLength(1);
    await expect(listLogIn(tx, emptyEventId)).resolves.toEqual([]);
  });
});
