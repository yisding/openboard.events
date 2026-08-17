import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { adminAuthEmailOutbox } from "@/db/schema";
import {
  dispatchAdminAuthEmailOutboxIn,
  getAdminAuthFallbackLinkIn,
  openPlatformAdminLinkPayload,
  listFailedAdminAuthEmailsIn,
  recordAdminAuthEmailSuppressionIn,
  requeueFailedAdminAuthEmailsIn,
  sendAdminAuthEmailIn,
} from "@/features/auth";
import { userIdSchema } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";

const MIGRATIONS = [
  "0000_init", "0001_views_triggers", "0002_admin_auth", "0003_jade_defaults",
  "0004_review_operations", "0005_rate_limits", "0006_content_deliverables",
  "0007_email_compliance", "0008_speaker_roster_operations", "0009_product_auth",
  "0022_admin_auth_email_outbox",
];

const userId = userIdSchema.parse("c0000000-0000-4000-8000-000000000011");
const orphanId = userIdSchema.parse("c0000000-0000-4000-8000-000000000099");
const SECRET = "test-session-secret-that-is-at-least-32-bytes";
const logEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: SECRET,
  EMAIL_MODE: "log",
  EMAIL_FALLBACK_UI: "1",
});

describe("platform admin auth mail outbox", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    for (const name of MIGRATIONS) {
      await pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));
    }
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Ada Organizer'),($2,'orphan@example.com','Eventless Owner')",
      [userId, orphanId],
    );
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 60_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM admin_auth_email_outbox");
  });

  afterAll(async () => pglite.close());

  it("queues eventless reset mail and encrypts the bearer link under row-bound AAD", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: orphanId,
      email: "Orphan@Example.com",
      name: "Eventless Owner",
      url: "http://localhost:3000/login/reset?token=super-secret-reset-token",
      expiresIn: "1 hour",
    }, logEnv);

    const [row] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(row).toMatchObject({
      userId: orphanId,
      recipientEmail: "orphan@example.com",
      status: "queued",
      templateKey: "admin_password_reset",
    });
    if (!row?.secretPayloadCiphertext) throw new Error("expected a sealed link");
    expect(new TextDecoder().decode(row.secretPayloadCiphertext)).not.toContain("super-secret-reset-token");

    await expect(openPlatformAdminLinkPayload(
      row.secretPayloadCiphertext,
      { userId: orphanId, messageId: row.id },
      SECRET,
    )).resolves.toEqual({
      url: "http://localhost:3000/login/reset?token=super-secret-reset-token",
      expiresIn: "1 hour",
    });
    await expect(openPlatformAdminLinkPayload(
      row.secretPayloadCiphertext,
      { userId: userId, messageId: row.id },
      SECRET,
    )).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("dispatches through log mode, clears ciphertext, and renders product-level copy", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: orphanId,
      email: "orphan@example.com",
      name: "Eventless Owner",
      url: "http://localhost:3000/login/reset?token=super-secret-reset-token",
      expiresIn: "1 hour",
    }, logEnv);
    const stats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: logEnv });
    expect(stats).toMatchObject({ claimed: 1, sent: 1, failed: 0, retried: 0 });

    const [row] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(row).toMatchObject({ status: "sent", subjectRendered: "Reset your Openboard password", providerMessageId: "log-mode" });
    expect(row?.secretPayloadCiphertext).toBeNull();
    expect(row?.bodyRenderedHtml).toContain("super-secret-reset-token");
    expect(row?.bodyRenderedHtml).not.toContain("speaker portal");
  });

  it("exposes a confirmation link only through the explicit non-production fallback", async () => {
    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_email_verification",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/api/auth/verify-email?token=verification-token&callbackURL=%2Fsignup%2Fverified",
      expiresIn: "1 hour",
    }, logEnv);
    await expect(getAdminAuthFallbackLinkIn(tx, "organizer@example.com", logEnv))
      .resolves.toContain("token=verification-token");

    const hiddenEnv = parseEnv({ ...logEnv, EMAIL_FALLBACK_UI: "0" });
    await expect(getAdminAuthFallbackLinkIn(tx, "organizer@example.com", hiddenEnv)).resolves.toBeNull();
  });

  it("keeps preview activation links encrypted and available when delivery is limited", async () => {
    const previewEnv = {
      ...logEnv,
      APP_ENV: "preview" as const,
      APP_BASE_URL: "https://preview.openboard.test",
      EMAIL_MODE: "send" as const,
      EMAIL_FROM: "Openboard <hello@example.com>",
      EMAIL_REPLY_TO: "replies@example.com",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    };
    const allowed = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_email_verification",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "https://preview.openboard.test/api/auth/verify-email?token=allowed-preview-token",
      expiresIn: "1 hour",
    }, previewEnv);
    const limited = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_email_verification",
      userId: orphanId,
      email: "orphan@example.com",
      name: "Eventless Owner",
      url: "https://preview.openboard.test/api/auth/verify-email?token=limited-preview-token",
      expiresIn: "1 hour",
    }, previewEnv);
    const sender = vi.fn().mockResolvedValue("preview-provider-message");

    const stats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: previewEnv, sender });
    expect(stats).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
    expect(sender).toHaveBeenCalledOnce();
    await expect(getAdminAuthFallbackLinkIn(tx, "organizer@example.com", previewEnv))
      .resolves.toContain("token=allowed-preview-token");
    await expect(getAdminAuthFallbackLinkIn(tx, "orphan@example.com", previewEnv))
      .resolves.toContain("token=limited-preview-token");

    const rows = await tx.select().from(adminAuthEmailOutbox);
    for (const messageId of [allowed.messageId, limited.messageId]) {
      const row = rows.find((candidate) => candidate.id === messageId);
      expect(row?.secretPayloadCiphertext).not.toBeNull();
      expect(row?.bodyRenderedHtml ?? "").not.toContain("preview-token");
    }
    const hiddenPreview = { ...previewEnv, EMAIL_FALLBACK_UI: "0" as const };
    await expect(getAdminAuthFallbackLinkIn(tx, "organizer@example.com", hiddenPreview)).resolves.toBeNull();
  });

  it("retries transient provider failures with the same idempotency key, then redacts the stored link", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_email_verification",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/api/auth/verify-email?token=verification-token&callbackURL=%2Fsignup%2Fverified",
      expiresIn: "1 hour",
    }, logEnv);
    const sendEnv = parseEnv({
      ...logEnv,
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "Openboard <hello@example.com>",
      EMAIL_REPLY_TO: "replies@example.com",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    });
    const failure = vi.fn().mockRejectedValueOnce(new Error("provider unavailable"));
    const first = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender: failure });
    expect(first).toMatchObject({ claimed: 1, retried: 1 });

    const [queued] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(queued?.status).toBe("queued");
    expect(queued?.attempts).toBe(1);
    await pglite.query("UPDATE admin_auth_email_outbox SET next_attempt_at=now() WHERE id=$1", [queued?.id]);

    const success = vi.fn().mockResolvedValue("resend-message-id");
    const second = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender: success });
    expect(second).toMatchObject({ claimed: 1, sent: 1 });
    expect(success.mock.calls[0]?.[0].idempotencyKey).toBe(queued?.idempotencyKey);
    expect(success.mock.calls[0]?.[0].replyTo).toBe("replies@example.com");

    const [sent] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, queued?.id ?? ""));
    expect(sent).toMatchObject({ status: "sent", providerMessageId: "resend-message-id", attempts: 2 });
    expect(sent?.bodyRenderedHtml).toContain("token=[redacted]");
    expect(sent?.bodyRenderedHtml).not.toContain("verification-token");
    expect(sent?.secretPayloadCiphertext).toBeNull();
  });

  it("redacts a nested invitation credential from sent reset-mail history", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?next=%2Fjoin%3Ftoken%3Dinvite-secret&token=reset-secret",
      expiresIn: "1 hour",
    }, logEnv);
    const sendEnv = parseEnv({
      ...logEnv,
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "Openboard <hello@example.com>",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    });

    await dispatchAdminAuthEmailOutboxIn(tx, 10, {
      env: sendEnv,
      sender: vi.fn().mockResolvedValue("nested-redaction-id"),
    });

    const [sent] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(sent?.bodyRenderedHtml).toContain("token=[redacted]");
    expect(sent?.bodyRenderedHtml).toContain("token%3D[redacted]");
    expect(sent?.bodyRenderedHtml).not.toContain("reset-secret");
    expect(sent?.bodyRenderedHtml).not.toContain("invite-secret");
    expect(sent?.secretPayloadCiphertext).toBeNull();
  });

  it("redacts a nested invitation credential from verification mail, which encodes it twice", async () => {
    // The URL the confirmation path actually builds. `next` is percent-encoded
    // once by `existingSignupVerificationCallback`, then the whole
    // `callbackURL` again by `URLSearchParams` — so the invitation token's
    // delimiter lands as `%253Ftoken%253D`, not the `%3Ftoken%3D` the reset
    // path produces and the case above fixtures. A single-depth pattern left
    // this live `/join` bearer token in the persisted body.
    const next = `/join?token=${encodeURIComponent("invite-secret")}`;
    const callbackURL = `/signup/verified?confirmed=1&next=${encodeURIComponent(next)}`;
    const url = new URL("/api/auth/verify-email", "http://localhost:3000");
    url.search = new URLSearchParams({ token: "verification-secret", callbackURL }).toString();

    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_email_verification",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: url.toString(),
      expiresIn: "1 hour",
    }, logEnv);
    const sendEnv = parseEnv({
      ...logEnv,
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "Openboard <hello@example.com>",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    });

    await dispatchAdminAuthEmailOutboxIn(tx, 10, {
      env: sendEnv,
      sender: vi.fn().mockResolvedValue("double-encoded-redaction-id"),
    });

    const [sent] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(sent?.bodyRenderedHtml).toContain("token=[redacted]");
    expect(sent?.bodyRenderedHtml).toContain("token%253D[redacted]");
    expect(sent?.bodyRenderedHtml).not.toContain("verification-secret");
    expect(sent?.bodyRenderedHtml).not.toContain("invite-secret");
    expect(sent?.secretPayloadCiphertext).toBeNull();
  });

  it("retains encrypted payloads when a rotated secret makes a row terminal", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: orphanId,
      email: "orphan@example.com",
      name: "Eventless Owner",
      url: "http://localhost:3000/login/reset?token=rotation-recovery",
      expiresIn: "1 hour",
    }, logEnv);
    const rotatedEnv = parseEnv({ ...logEnv, SESSION_SECRET: "a-different-test-session-secret-at-least-32-bytes" });

    const stats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: rotatedEnv });
    expect(stats).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    const [failed] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, result.messageId));
    expect(failed?.status).toBe("failed");
    expect(failed?.secretPayloadCiphertext).not.toBeNull();
  });

  it("skips preview recipients outside the configured allowlist", async () => {
    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: orphanId,
      email: "orphan@example.com",
      name: "Eventless Owner",
      url: "http://localhost:3000/login/reset?token=not-allowed",
      expiresIn: "1 hour",
    }, logEnv);
    const sendEnv = parseEnv({
      ...logEnv,
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "hello@example.com",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    });
    const sender = vi.fn();
    const stats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender });
    expect(stats).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it("records provider suppression and withholds future auth mail to that address", async () => {
    const sendEnv = parseEnv({
      ...logEnv,
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "hello@example.com",
      EMAIL_ALLOWLIST: "organizer@example.com",
      RESEND_API_KEY: "re_test",
    });
    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=will-bounce",
      expiresIn: "1 hour",
    }, logEnv);
    await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender: vi.fn().mockResolvedValue("auth-bounce-id") });
    await expect(recordAdminAuthEmailSuppressionIn(tx, { providerMessageId: "auth-bounce-id", reason: "bounce" }))
      .resolves.toEqual({ recipientEmail: "organizer@example.com" });

    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=withheld",
      expiresIn: "1 hour",
    }, logEnv);
    const sender = vi.fn();
    const stats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender });
    expect(stats).toMatchObject({ claimed: 1, skipped: 1 });
    expect(sender).not.toHaveBeenCalled();

    // Bounces may be transient. Once the suppression is 30 days old, a new
    // recovery request is allowed through again.
    await pglite.query(
      "UPDATE admin_auth_email_outbox SET suppressed_at=now() - interval '31 days' WHERE provider_message_id='auth-bounce-id'",
    );
    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=after-bounce-expiry",
      expiresIn: "1 hour",
    }, logEnv);
    const recoveredSender = vi.fn().mockResolvedValue("auth-complaint-id");
    const recovered = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender: recoveredSender });
    expect(recovered).toMatchObject({ claimed: 1, sent: 1 });
    expect(recoveredSender).toHaveBeenCalledOnce();

    // Complaints remain permanent regardless of age.
    await expect(recordAdminAuthEmailSuppressionIn(tx, { providerMessageId: "auth-complaint-id", reason: "complaint" }))
      .resolves.toEqual({ recipientEmail: "organizer@example.com" });
    await pglite.query(
      "UPDATE admin_auth_email_outbox SET suppressed_at=now() - interval '31 days' WHERE provider_message_id='auth-complaint-id'",
    );
    await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "organizer@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=after-complaint",
      expiresIn: "1 hour",
    }, logEnv);
    const permanentlySuppressed = vi.fn();
    const complaintStats = await dispatchAdminAuthEmailOutboxIn(tx, 10, { env: sendEnv, sender: permanentlySuppressed });
    expect(complaintStats).toMatchObject({ claimed: 1, skipped: 1 });
    expect(permanentlySuppressed).not.toHaveBeenCalled();
  });
});

/**
 * Issue #625 — once a row exhausted the shared six-attempt cutoff, `failRow`
 * wrote `status: "failed"` and nothing in the product could re-open it.
 * `retryFailedCommunicationsIn` is event-scoped to `communication_logs`, so an
 * admin whose reset mail died during a provider outage was locked out with SQL
 * as the only remedy.
 */
describe("requeueing terminal admin auth mail", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    for (const name of MIGRATIONS) {
      await pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));
    }
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Ada Organizer'),($2,'orphan@example.com','Eventless Owner')",
      [userId, orphanId],
    );
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 60_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM admin_auth_email_outbox");
  });

  afterAll(async () => pglite.close());

  async function queueThenFail(email: string): Promise<string> {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email,
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=a-reset-token",
      expiresIn: "1 hour",
    }, logEnv);
    await pglite.query(
      "UPDATE admin_auth_email_outbox SET status='failed', attempts=6, error='provider unavailable' WHERE id=$1",
      [result.messageId],
    );
    return result.messageId;
  }

  it("re-opens a terminal row and gives it a fresh attempt ladder", async () => {
    const messageId = await queueThenFail("ada@example.com");

    const result = await requeueFailedAdminAuthEmailsIn(tx, {});
    expect(result.requeued.map((row) => row.id)).toEqual([messageId]);
    // The failure it died of survives into the report — the operator needs to
    // know what to fix before the fresh ladder spends itself on the same thing.
    expect(result.requeued[0]).toMatchObject({ attempts: 6, error: "provider unavailable" });

    const [row] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, messageId));
    expect(row).toMatchObject({ status: "queued", attempts: 0, error: null, lockedUntil: null });
    // Reset to zero rather than nudged: the row already spent its ladder on a
    // condition the operator has since fixed, and leaving it at six would let
    // one more transient failure close it again immediately.
    expect(row?.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("narrows to one recipient when asked, leaving the rest terminal", async () => {
    const mine = await queueThenFail("ada@example.com");
    const theirs = await queueThenFail("grace@example.com");

    const result = await requeueFailedAdminAuthEmailsIn(tx, { emails: ["ADA@Example.com"] });
    expect(result.requeued.map((row) => row.id)).toEqual([mine]);

    const [untouched] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, theirs));
    expect(untouched?.status).toBe("failed");
  });

  // The link *is* the message for every template in this table, so re-sending
  // one whose sealed payload is gone would deliver mail that cannot do
  // anything — and stop the recipient waiting for a real one.
  it("reports a row with no sealed payload as unrecoverable instead of re-sending it", async () => {
    const messageId = await queueThenFail("ada@example.com");
    await pglite.query("UPDATE admin_auth_email_outbox SET secret_payload_ciphertext = NULL WHERE id=$1", [messageId]);

    const result = await requeueFailedAdminAuthEmailsIn(tx, {});
    expect(result.requeued).toEqual([]);
    expect(result.unrecoverable.map((row) => row.id)).toEqual([messageId]);

    const [row] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, messageId));
    expect(row?.status).toBe("failed");
  });

  // The CLI's `--id <uuid>` flow is the surgical case: one named row out of a
  // pile, when a blanket requeue would re-mail people who no longer need it.
  it("narrows to named ids, leaving every other failed row terminal", async () => {
    const wanted = await queueThenFail("ada@example.com");
    const other = await queueThenFail("grace@example.com");

    const result = await requeueFailedAdminAuthEmailsIn(tx, { ids: [wanted] });
    expect(result.requeued.map((row) => row.id)).toEqual([wanted]);

    const [untouched] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, other));
    expect(untouched?.status).toBe("failed");
  });

  // The command reports before it writes, so the two must select the same set
  // — a preview that disagrees with the action it previews is worse than none.
  it("previews exactly the rows the requeue would act on", async () => {
    const mine = await queueThenFail("ada@example.com");
    await queueThenFail("grace@example.com");

    const previewed = await listFailedAdminAuthEmailsIn(tx, { emails: ["ADA@Example.com"] });
    expect(previewed.map((row) => row.id)).toEqual([mine]);
    const result = await requeueFailedAdminAuthEmailsIn(tx, { emails: ["ADA@Example.com"] });
    expect(result.requeued.map((row) => row.id)).toEqual(previewed.map((row) => row.id));
  });

  it("leaves queued and sent rows alone", async () => {
    const queued = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId,
      email: "waiting@example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=still-waiting",
      expiresIn: "1 hour",
    }, logEnv);
    await pglite.query("UPDATE admin_auth_email_outbox SET attempts=2 WHERE id=$1", [queued.messageId]);

    const result = await requeueFailedAdminAuthEmailsIn(tx, {});
    expect(result.requeued).toEqual([]);
    // A mid-ladder row must keep its attempts: resetting one the drain is
    // still working through would restart a backoff that is doing its job.
    const [row] = await tx.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, queued.messageId));
    expect(row).toMatchObject({ status: "queued", attempts: 2 });
  });
});
