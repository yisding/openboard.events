import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { PORTAL_LOGIN_NEUTRAL_MESSAGE, consumeToken, issuePortalToken, requestPortalLoginIn, verifyPortalLoginIn } from "@/features/auth";
import { createPortalSessionRowIn, findConcurrentPortalSignInIn, publicCfpIsOpenIn } from "@/features/auth/server/portal";
import { openPortalLoginPayload, sealPortalLoginPayload } from "@/features/auth/index.payloads";
import { verifyPortalTokenIn } from "@/features/auth/server/tokens";
import { getOrCreateContact, updateContactFields } from "@/features/event-contacts";
import { contactIdSchema, eventIdSchema, formIdSchema, tokenIdSchema } from "@/shared/contracts";

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
const ONFILE_EMAILS = ["throttle@example.com", "return-path@example.com", "concurrent-throttle@example.com", "on-file@example.com"];

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
    // The sign-in form no longer creates a contact for whatever address is
    // typed into it, so the throttle and return-path cases need people who are
    // genuinely on file — the organizer added them, or a CFP submission did.
    for (const email of ONFILE_EMAILS) {
      await pglite.query("INSERT INTO contacts(event_id,email) VALUES($1,$2)", [eventA, email]);
    }
    testDb = drizzle(pglite, { schema });
    tx = testDb as unknown as TxDb;
  }, 30_000);

  afterAll(async () => pglite.close());

  const countPortalSessions = async () => (await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM portal_sessions WHERE contact_id=$1", [contactA],
  )).rows[0]?.n ?? 0;

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

  /**
   * The lockout above is only real if the guess survives the refusal. Every
   * wrong code is spent inside the sign-in transaction, and that transaction
   * used to be rolled back by the `UNAUTHORIZED` thrown from inside it — the
   * counter went back to zero on every guess, so five-strikes-and-out never
   * arrived and a six-digit credential could be guessed indefinitely. The
   * refusal is returned now and thrown by the caller after the commit.
   */
  it("spends a guess on every wrong code, even though the sign-in is refused", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "magic_link", ttl: "PT15M", withOtp: true });
    if (!issued.otp) throw new Error("expected OTP");
    const correctCode = issued.otp;
    const wrongCode = correctCode === "000000" ? "999999" : "000000";
    const attempt = (code: string) => testDb.transaction((inner) => verifyPortalLoginIn(inner as unknown as TxDb, {
      eventId: eventA,
      purpose: "magic_link",
      code,
      email: "speaker@example.com",
      impersonatedByUserId: null,
    }));
    const tokenState = async () => (await pglite.query<{ attempts: number; consumed: boolean }>(
      "SELECT attempts,consumed_at IS NOT NULL AS consumed FROM portal_tokens WHERE id=$1", [issued.tokenId],
    )).rows[0];
    const sessionsBefore = await countPortalSessions();

    for (let guess = 1; guess <= 5; guess += 1) {
      await expect(attempt(wrongCode)).resolves.toEqual({ verified: false });
      expect(await tokenState()).toEqual({ attempts: guess, consumed: guess === 5 });
    }
    // Five strikes burned the challenge, so the code that was right all along
    // is refused too — and no session was minted on the way past.
    await expect(attempt(correctCode)).resolves.toEqual({ verified: false });
    expect(await countPortalSessions()).toBe(sessionsBefore);
  });

  it("signs a speaker in on the right code and burns the challenge with the session", async () => {
    const issued = await issuePortalToken(tx, { eventId: eventA, contactId: contactA, purpose: "magic_link", ttl: "PT15M", withOtp: true });
    if (!issued.otp) throw new Error("expected OTP");
    const code = issued.otp;
    const sessionsBefore = await countPortalSessions();
    const outcome = await testDb.transaction((inner) => verifyPortalLoginIn(inner as unknown as TxDb, {
      eventId: eventA,
      purpose: "magic_link",
      code,
      email: "speaker@example.com",
      impersonatedByUserId: null,
    }));
    expect(outcome).toMatchObject({ verified: true, contactId: contactA, email: "speaker@example.com" });
    const state = await pglite.query<{ consumed: boolean }>("SELECT consumed_at IS NOT NULL AS consumed FROM portal_tokens WHERE id=$1", [issued.tokenId]);
    expect(state.rows[0]?.consumed).toBe(true);
    expect(await countPortalSessions()).toBe(sessionsBefore + 1);
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

  /**
   * The sign-in form is public and unauthenticated. Creating a contact for
   * whatever address was typed into it handed anyone a write into the
   * organizer's roster: every stray or scripted address became a permanent
   * speaker row, "Awaiting confirmation, 0 submissions", forever. The neutral
   * answer is the *only* thing an unknown address gets.
   */
  it("answers an address that is not on file without writing anything down", async () => {
    const stranger = "nobody-typed-this@example.com";
    const roster = async () => (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1", [eventA],
    )).rows[0]?.n ?? 0;
    // The outbox is `communication_logs`, keyed by `contact_id` — there is no
    // per-address column an unknown sender could even land in — so measure the
    // login-mail count across the pair of requests and prove only one landed.
    const outbox = async () => (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1 AND template_key='portal_login'", [eventA],
    )).rows[0]?.n ?? 0;
    const before = await roster();
    const outboxBefore = await outbox();

    const known = await requestPortalLoginIn(tx, { eventId: eventA, eventSlug: "portal-a", email: "on-file@example.com", appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: false });
    const unknown = await requestPortalLoginIn(tx, { eventId: eventA, eventSlug: "portal-a", email: stranger, appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: false });
    // Indistinguishable from the on-file answer: the screen must not be able to
    // tell an attacker who has an account here.
    expect(unknown).toEqual({ message: PORTAL_LOGIN_NEUTRAL_MESSAGE });
    expect(unknown).toEqual(known);

    // The roster is exactly as long as it was, and the address that was typed
    // has left no trace — no contact, and so no outbox row hanging off one.
    expect(await roster()).toBe(before);
    const trace = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email=$2", [eventA, stranger]);
    expect(trace.rows[0]?.n).toBe(0);
    // Only the on-file request enqueued a login email; the unknown one queued
    // nothing — there is no contact to hang an outbox row off.
    expect(await outbox()).toBe(outboxBefore + 1);
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

  /**
   * The one door through the rule above, and the reason it has to exist.
   *
   * Every visitor to a public call for speakers starts on the account step; the
   * draft endpoint requires a portal session; the only way to get one is this
   * code. So "never issue a code to an address with no contact row" closed a
   * published CFP to precisely the people it was published for — anyone not
   * already on the organizer's roster, which is every first-time submitter.
   */
  describe("a first-time submitter to an open call for speakers", () => {
    const newcomer = "first-time@example.com";

    it("is issued a code and put on file, with the same sentence a known address gets", async () => {
      const roster = async () => (await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email=$2", [eventA, newcomer],
      )).rows[0]?.n ?? 0;
      expect(await roster()).toBe(0);

      const opened = await requestPortalLoginIn(tx, {
        eventId: eventA, eventSlug: "portal-a", email: newcomer,
        appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: true,
        mayCreateContact: true,
      });

      // On file now, and holding a real credential rather than the neutral no-op.
      expect(await roster()).toBe(1);
      expect(opened.fallback?.otp).toMatch(/^\d{6}$/u);
      // Still the same sentence, so the reply cannot be read as "this address
      // was new" — the enumeration property survives the door.
      expect(opened.message).toBe(PORTAL_LOGIN_NEUTRAL_MESSAGE);
      const enqueued = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1 AND template_key='portal_login' AND contact_id=(SELECT id FROM contacts WHERE event_id=$1 AND email=$2)",
        [eventA, newcomer],
      );
      expect(enqueued.rows[0]?.n).toBe(1);
    });

    it("is still refused when the caller does not say it is a call for speakers", async () => {
      const other = "second-timer@example.com";
      const result = await requestPortalLoginIn(tx, {
        eventId: eventA, eventSlug: "portal-a", email: other,
        appBaseUrl: "https://preview.example.com", sessionSecret: secret, fallback: true,
      });
      expect(result).toEqual({ message: PORTAL_LOGIN_NEUTRAL_MESSAGE });
      const trace = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email=$2", [eventA, other],
      );
      expect(trace.rows[0]?.n).toBe(0);
    });
  });

  /**
   * `mayCreateContact` above is never taken from the request body — it is what
   * this function answers. Each case here is a form id a caller could put in a
   * payload, and every one of them has to read as "not an open public call".
   */
  describe("the open-CFP gate that decides whether an address may be created", () => {
    const formOf = async (values: {
      id: string; eventId: string; context: string; status: string;
      opensAt?: string | null; closesAt?: string | null;
    }) => {
      await pglite.query(
        `INSERT INTO forms(id,event_id,context,internal_name,status,opens_at,closes_at${values.context === "portal" ? ",target_type" : ""})
         VALUES($1,$2,$3::form_context,$4,$5::form_status,$6,$7${values.context === "portal" ? ",'contact'" : ""})`,
        [values.id, values.eventId, values.context, `fixture ${values.id}`, values.status, values.opensAt ?? null, values.closesAt ?? null],
      );
      return formIdSchema.parse(values.id);
    };
    const gateFor = "b0000000-0000-4000-8000-0000000001";

    it("opens only for a cfp form, on this event, that is open right now", async () => {
      const open = await formOf({ id: `${gateFor}01`, eventId: eventA, context: "cfp", status: "open" });
      expect(await publicCfpIsOpenIn(tx, eventA, open)).toBe(true);

      // Admin intent outranks the dates in the closing direction.
      const draft = await formOf({ id: `${gateFor}02`, eventId: eventA, context: "cfp", status: "draft" });
      expect(await publicCfpIsOpenIn(tx, eventA, draft)).toBe(false);

      // A window that has not started, and one that has already ended: the
      // deadline is the moment a stranger stops being able to mint a row.
      const early = await formOf({ id: `${gateFor}03`, eventId: eventA, context: "cfp", status: "open", opensAt: "2099-01-01T00:00:00Z" });
      expect(await publicCfpIsOpenIn(tx, eventA, early)).toBe(false);
      const late = await formOf({ id: `${gateFor}04`, eventId: eventA, context: "cfp", status: "open", closesAt: "2020-01-01T00:00:00Z" });
      expect(await publicCfpIsOpenIn(tx, eventA, late)).toBe(false);

      // A portal form is an authenticated surface, not a public call.
      const portal = await formOf({ id: `${gateFor}05`, eventId: eventA, context: "portal", status: "open" });
      expect(await publicCfpIsOpenIn(tx, eventA, portal)).toBe(false);

      // Another event's open CFP is not a door into this one.
      const elsewhere = await formOf({ id: `${gateFor}06`, eventId: eventB, context: "cfp", status: "open" });
      expect(await publicCfpIsOpenIn(tx, eventA, elsewhere)).toBe(false);
      expect(await publicCfpIsOpenIn(tx, eventB, elsewhere)).toBe(true);

      // And an id that names nothing at all.
      expect(await publicCfpIsOpenIn(tx, eventA, formIdSchema.parse(`${gateFor}99`))).toBe(false);
    });
  });

  it("keeps canonical contact writes scoped to their event", async () => {
    const contactId = await getOrCreateContact(tx, eventA, " New@Example.COM ");
    await updateContactFields(tx, eventA, contactId, { firstName: "New" });
    await expect(updateContactFields(tx, eventB, contactId, { firstName: "Leak" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = await pglite.query<{ email: string; first_name: string }>("SELECT email,first_name FROM contacts WHERE id=$1", [contactId]);
    expect(row.rows[0]).toEqual({ email: "new@example.com", first_name: "New" });
  });
});
