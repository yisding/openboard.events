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
  submissionIdSchema,
  tokenIdSchema,
} from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { dispatchOutboxIn } from "./server/dispatcher";
import { listLogIn } from "./server/queries";
import { seedDefaultTemplates } from "./server/templates";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const emptyEventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const contactId = contactIdSchema.parse("c0000000-0000-4000-8000-000000000003");
const receivedId = submissionIdSchema.parse("c0000000-0000-4000-8000-000000000004");
const decisionId = submissionIdSchema.parse("c0000000-0000-4000-8000-000000000005");
const formId = "c0000000-0000-4000-8000-000000000006";
const secret = "dispatcher-test-secret-that-is-at-least-32-bytes";
const logEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  EMAIL_MODE: "log",
  EMAIL_FALLBACK_UI: "1",
});
const sendEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  EMAIL_MODE: "send",
  EMAIL_FALLBACK_UI: "0",
  EMAIL_FROM: "mail@example.com",
  RESEND_API_KEY: "re_test",
});

describe("communications outbox dispatcher", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.query("INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Empty','empty','Online','UTC','2026-10-01T09:00:00Z','2026-10-01T17:00:00Z')", [eventId, emptyEventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Nadia','Lee')", [contactId, eventId]);
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Main CFP','open')", [formId, eventId]);
    await pglite.query("INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id) VALUES($1,$3,$4,1,7,'pending',';lkj<img onerror=alert(1)>','cfp',$5),($2,$3,$4,1,8,'accepted','Decision session','cfp',$5)", [receivedId, decisionId, eventId, formId, contactId]);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM portal_tokens");
  });

  afterAll(async () => pglite.close());

  it("seeds exactly eight templates and three reminder rungs idempotently", async () => {
    await seedDefaultTemplates(tx, eventId);
    await seedDefaultTemplates(tx, eventId);
    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [eventId]);
    const reminders = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reminder_rules WHERE event_id=$1", [eventId]);
    expect(templates.rows[0]?.n).toBe(8);
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
