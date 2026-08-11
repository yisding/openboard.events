import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { consumeToken, issuePortalToken, requestPortalLoginIn } from "@/features/auth";
import { createPortalSessionRowIn, findConcurrentPortalSignInIn } from "@/features/auth/server/portal";
import { openPortalLoginPayload, sealPortalLoginPayload } from "@/features/auth/server/secret-payload";
import { verifyPortalTokenIn } from "@/features/auth/server/tokens";
import { getOrCreateContact, updateContactFields } from "@/features/portal";
import { contactIdSchema, eventIdSchema, tokenIdSchema } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 added `contacts.workflow_status`; `getOrCreateContact`'s unqualified
// `.returning()` now selects it.
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M59 (drizzle/0016) added `contacts.acceptance_seen_at`. This harness applies
// a hand-picked subset of migrations rather than the whole journal, so any
// drizzle query that names every declared `contacts` column — an unqualified
// `.returning()`, or a `select()` of the whole table — fails against a
// database built without it. Applied last, as it is in the journal.
const migrationSpeakerMoments = readFileSync(new URL("../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");
const eventA = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const eventB = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const contactA = contactIdSchema.parse("b0000000-0000-4000-8000-000000000003");
const payloadTokenId = tokenIdSchema.parse("b0000000-0000-4000-8000-000000000004");
const secret = "portal-auth-test-secret-that-is-at-least-32-bytes";

describe("portal authentication", () => {
  let pglite: PGlite;
  let tx: TxDb;
  let testDb: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationSpeakerMoments);
    await pglite.query("INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Portal A','portal-a','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Portal B','portal-b','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')", [eventA, eventB]);
    await pglite.query("INSERT INTO contacts(id,event_id,email) VALUES($1,$2,'speaker@example.com')", [contactA, eventA]);
    testDb = drizzle(pglite, { schema });
    tx = testDb as unknown as TxDb;
  }, 30_000);

  afterAll(async () => pglite.close());

  it("stores only token hashes and consumes a correct OTP once", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "magic_link", ttl: "PT15M", withOtp: true });
    if (!issued.otp) throw new Error("expected OTP");
    const stored = await pglite.query<{ token_hash: string; otp_hash: string }>("SELECT token_hash,otp_hash FROM portal_tokens WHERE id=$1", [issued.tokenId]);
    expect(stored.rows[0]?.token_hash).not.toBe(issued.raw);
    expect(stored.rows[0]?.otp_hash).not.toBe(issued.otp);
    await expect(consumeToken(tx, { contactId: contactA, code: issued.otp }, { eventId: eventA, purpose: "magic_link" })).resolves.toEqual({ contactId: contactA, eventId: eventA });
    await expect(consumeToken(tx, { contactId: contactA, code: issued.otp }, { eventId: eventA, purpose: "magic_link" })).resolves.toBeNull();
  });

  it("recognizes a consumed OTP and its session inside one transaction", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "magic_link", ttl: "PT15M", withOtp: true });
    if (!issued.otp) throw new Error("expected OTP");
    const otp = issued.otp;
    await testDb.transaction(async (inner) => {
      const transaction = inner as unknown as TxDb;
      await expect(consumeToken(transaction, { contactId: contactA, code: otp }, { eventId: eventA, purpose: "magic_link" })).resolves.toEqual({ contactId: contactA, eventId: eventA });
      await createPortalSessionRowIn(transaction, contactA, eventA, null);
      await expect(findConcurrentPortalSignInIn(transaction, { contactId: contactA, code: otp }, { eventId: eventA, purpose: "magic_link" })).resolves.toEqual({ contactId: contactA, email: "speaker@example.com" });
    });
    await expect(findConcurrentPortalSignInIn(tx, { contactId: contactA, code: "000000" }, { eventId: eventA, purpose: "magic_link" })).resolves.toBeNull();
  });

  it("invalidates a challenge after five wrong OTP attempts", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "magic_link", ttl: "PT15M", withOtp: true });
    if (!issued.otp) throw new Error("expected OTP");
    const wrongCode = issued.otp === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(consumeToken(tx, { contactId: contactA, code: wrongCode }, { eventId: eventA, purpose: "magic_link" })).resolves.toBeNull();
    }
    await expect(consumeToken(tx, { contactId: contactA, code: issued.otp }, { eventId: eventA, purpose: "magic_link" })).resolves.toBeNull();
    const state = await pglite.query<{ attempts: number; consumed: boolean }>("SELECT attempts,consumed_at IS NOT NULL AS consumed FROM portal_tokens WHERE id=$1", [issued.tokenId]);
    expect(state.rows[0]).toEqual({ attempts: 5, consumed: true });
  });

  it("verifies calendar tokens repeatedly without consuming them", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "ics_download", ttl: "P365D" });
    await expect(verifyPortalTokenIn(tx, issued.raw, { purpose: "ics_download" })).resolves.toEqual({ contactId: contactA, eventId: eventA });
    await expect(verifyPortalTokenIn(tx, issued.raw, { purpose: "ics_download" })).resolves.toEqual({ contactId: contactA, eventId: eventA });
    const stored = await pglite.query<{ consumed_at: Date | null }>("SELECT consumed_at FROM portal_tokens WHERE id=$1", [issued.tokenId]);
    expect(stored.rows[0]?.consumed_at).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "ics_download", ttl: "P365D" });
    await pglite.query("UPDATE portal_tokens SET expires_at=now()-interval '1 second' WHERE id=$1", [issued.tokenId]);
    await expect(verifyPortalTokenIn(tx, issued.raw, { purpose: "ics_download" })).resolves.toBeNull();
  });

  it("rejects OTP issuance for non-login token purposes", async () => {
    await expect(issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "ics_download", ttl: "P365D", withOtp: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "impersonation", ttl: "PT5M", withOtp: true })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("throttles the fourth request and queues three encrypted login emails", async () => {
    const email = "throttle@example.com";
    for (let request = 0; request < 3; request += 1) {
      const result = await requestPortalLoginIn(tx, { eventId: eventA, eventSlug: "portal-a", email, appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: false });
      expect(result).toEqual({ message: "If that address is on file, we've sent a code" });
    }
    await expect(requestPortalLoginIn(tx, { eventId: eventA, eventSlug: "portal-a", email, appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: false })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const rows = await pglite.query<{ n: number; encrypted: number }>("SELECT count(*)::int AS n,count(secret_payload_ciphertext)::int AS encrypted FROM communication_logs l JOIN contacts c ON c.id=l.contact_id WHERE c.email=$1", [email]);
    expect(rows.rows[0]).toEqual({ n: 3, encrypted: 3 });
  });

  it("carries a validated return path into the encrypted magic link", async () => {
    const result = await requestPortalLoginIn(tx, {
      eventId: eventA,
      eventSlug: "portal-a",
      email: "return-path@example.com",
      appBaseUrl: "https://preview.example.com",
      sessionSecret: secret,
      fallback: true,
      next: "/portal/portal-a/tasks?filter=late",
    });
    expect(new URL(result.fallback?.magicLink ?? "").searchParams.get("next")).toBe("/portal/portal-a/tasks?filter=late");
  });

  it("serializes concurrent login issuance at three requests per recipient", async () => {
    const email = "concurrent-throttle@example.com";
    const requests = Array.from({ length: 4 }, () => testDb.transaction((inner) => requestPortalLoginIn(inner as unknown as TxDb, {
      eventId: eventA,
      eventSlug: "portal-a",
      email,
      appBaseUrl: "https://preview.example.com",
      sessionSecret: secret,
      fallback: false,
    })));
    const results = await Promise.allSettled(requests);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "RATE_LIMITED" });
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM communication_logs l JOIN contacts c ON c.id=l.contact_id WHERE c.email=$1", [email]);
    expect(rows.rows[0]?.n).toBe(3);
  });

  it("round-trips the v1 encrypted envelope and rejects tampering or unknown versions", async () => {
    const context = { eventId: eventA, contactId: contactA, tokenId: payloadTokenId };
    const payload = { otp: "123456", magicLink: "https://preview.example.com/portal/portal-a/verify?token=secret" };
    const envelope = await sealPortalLoginPayload(payload, context, secret);
    expect(envelope[0]).toBe(1);
    await expect(openPortalLoginPayload(envelope, context, secret)).resolves.toEqual(payload);
    const tampered = Uint8Array.from(envelope);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(openPortalLoginPayload(tampered, context, secret)).rejects.toMatchObject({ code: "VALIDATION" });
    const unknown = Uint8Array.from(envelope);
    unknown[0] = 2;
    await expect(openPortalLoginPayload(unknown, context, secret)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps canonical contact writes scoped to their event", async () => {
    const contactId = await getOrCreateContact(tx, eventA, " New@Example.COM ");
    await updateContactFields(tx, eventA, contactId, { firstName: "New" });
    await expect(updateContactFields(tx, eventB, contactId, { firstName: "Leak" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = await pglite.query<{ email: string; first_name: string }>("SELECT email,first_name FROM contacts WHERE id=$1", [contactId]);
    expect(row.rows[0]).toEqual({ email: "new@example.com", first_name: "New" });
  });
});
