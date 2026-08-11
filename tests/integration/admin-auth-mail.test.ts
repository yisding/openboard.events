import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { communicationLogs } from "@/db/schema";
import { openAdminLinkPayload, sealAdminLinkPayload, sendAdminAuthEmailIn } from "@/features/auth";
import { buildContext } from "@/features/comms/server/context";
import { renderTemplateContent } from "@/features/comms/server/render";
import { DEFAULT_TEMPLATES } from "@/features/comms/server/templates";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { parseEnv } from "@/shared/lib/env";
import { contactIdSchema, eventIdSchema, userIdSchema } from "@/shared/contracts";

/**
 * M42 — admin password-reset and email-verification mail on the existing
 * outbox. Not a second mailer: the same `enqueueEmail`, the same dispatcher
 * context, the same rendering, and therefore the same suppression, bounce and
 * compliance behaviour P3-EMAIL built.
 */

const MIGRATIONS = [
  "0000_init", "0001_views_triggers", "0002_admin_auth", "0003_jade_defaults",
  "0004_review_operations", "0005_rate_limits", "0006_content_deliverables",
  "0007_email_compliance", "0008_speaker_roster_operations", "0009_product_auth",
  // M42 is the subject here, so this list stops at 0009 rather than tracking
  // the journal — with one exception. 0016 adds `contacts.acceptance_seen_at`,
  // and drizzle names every declared column of `contacts` in an unqualified
  // `.returning()`/`select()`, so the column has to exist even though nothing
  // below reads it. Skipping 0010-0015 is still deliberate: they are later
  // modules this test is not about, and 0014's template backfill would change
  // the very `email_templates` rows these assertions inspect.
  "0016_speaker_moments",
];

const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const organizerId = userIdSchema.parse("c0000000-0000-4000-8000-000000000011");
const SECRET = "test-session-secret-that-is-at-least-32-bytes";

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: SECRET,
  UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-at-least-32-bytes-long",
  ADMIN_AUTH_PROVIDER: "better-auth",
});

describe("M42 admin auth mail through the outbox", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    for (const name of MIGRATIONS) {
      await pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));
    }
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Openboard Conf','m42-mail','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Later Event','m42-mail-2','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
      [eventId, otherEventId],
    );
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Ada Organizer')", [organizerId]);
    // Two memberships, deliberately in reverse chronological order of event id,
    // so `homeEventId`'s ordering is actually exercised rather than accidentally
    // satisfied.
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role,created_at) VALUES($1,$2,'owner','2026-01-01T00:00:00Z'),($1,$3,'organizer','2026-02-01T00:00:00Z')",
      [organizerId, eventId, otherEventId],
    );
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 60_000);

  afterAll(async () => pglite.close());

  it("queues a reset email against the organizer's oldest event and their contact row", async () => {
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: organizerId,
      email: "Organizer@Example.com",
      name: "Ada Organizer",
      url: "http://localhost:3000/login/reset?token=super-secret-reset-token",
      expiresIn: "1 hour",
    }, env);
    expect(result.queued).toBe(true);

    const [row] = await tx.select().from(communicationLogs).where(eq(communicationLogs.templateKey, "admin_password_reset"));
    expect(row?.eventId).toBe(eventId);
    expect(row?.status).toBe("queued");
    expect(row?.secretPayloadCiphertext).toBeTruthy();
    // The idempotency key is event-scoped and names the template and user, per
    // the pinned recipe.
    expect(row?.idempotencyKey.startsWith(`${eventId}:admin_password_reset:${organizerId}:`)).toBe(true);

    // The contact was created for the normalized address, not the mixed-case
    // one the caller passed.
    const contacts = await pglite.query<{ email: string }>("SELECT email FROM contacts WHERE event_id = $1", [eventId]);
    expect(contacts.rows.map((c) => c.email)).toEqual(["organizer@example.com"]);
  });

  it("never stores the link in the clear, and binds it to the row that carries it", async () => {
    const [row] = await tx.select().from(communicationLogs).where(eq(communicationLogs.templateKey, "admin_password_reset"));
    const ciphertext = row?.secretPayloadCiphertext;
    if (!ciphertext || !row) throw new Error("expected a queued reset row");

    expect(new TextDecoder().decode(ciphertext)).not.toContain("super-secret-reset-token");

    const linkId = row.idempotencyKey.split(":").at(-1) ?? "";
    const contactId = contactIdSchema.parse(row.contactId);
    const opened = await openAdminLinkPayload(ciphertext, { eventId, contactId, linkId }, SECRET);
    expect(opened.url).toBe("http://localhost:3000/login/reset?token=super-secret-reset-token");

    // AAD binding: the same envelope under a different link id or contact does
    // not open, so a payload cannot be replayed onto another outbox row.
    await expect(openAdminLinkPayload(ciphertext, { eventId, contactId, linkId: "other" }, SECRET)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(openAdminLinkPayload(ciphertext, { eventId, contactId: contactIdSchema.parse(organizerId), linkId }, SECRET))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("renders the reset email with the link and without a speaker portal credential", async () => {
    const [row] = await tx.select().from(communicationLogs).where(eq(communicationLogs.templateKey, "admin_password_reset"));
    if (!row) throw new Error("expected a queued reset row");

    const context = await buildContext(row, tx, env);
    const template = DEFAULT_TEMPLATES.admin_password_reset;
    const rendered = renderTemplateContent("admin_password_reset", template.subject, template.bodyHtml, context.vars, {});

    expect(rendered.subject).toContain("Openboard Conf");
    expect(rendered.html).toContain("super-secret-reset-token");
    expect(rendered.html).toContain("1 hour");
    // AC 3's isolation, visible in the output: admin auth mail carries no
    // speaker-portal magic link, and none was minted for it.
    expect(rendered.html).not.toContain("/portal/");
    const tokens = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_tokens");
    expect(tokens.rows[0]?.n).toBe(0);
  });

  it("refuses a secret payload on a template that may not carry one, and demands one where it must", async () => {
    const contactId = contactIdSchema.parse(
      (await pglite.query<{ id: string }>("SELECT id FROM contacts WHERE event_id = $1", [eventId])).rows[0]?.id,
    );
    await expect(enqueueEmail(tx, {
      eventId,
      templateKey: "submission_received",
      contactId,
      idempotencyKey: `${eventId}:bad-secret`,
      secretPayloadCiphertext: await sealAdminLinkPayload({ url: "http://localhost:3000/x?token=a", expiresIn: "1 hour" }, { eventId, contactId, linkId: "l" }, SECRET),
    })).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(enqueueEmail(tx, {
      eventId,
      templateKey: "admin_email_verification",
      contactId,
      idempotencyKey: `${eventId}:missing-secret`,
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("queues nothing for an account with no event membership", async () => {
    const orphan = userIdSchema.parse("c0000000-0000-4000-8000-000000000099");
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'orphan@example.com','Orphan')", [orphan]);
    const before = await tx.select().from(communicationLogs);
    const result = await sendAdminAuthEmailIn(tx, {
      templateKey: "admin_password_reset",
      userId: orphan,
      email: "orphan@example.com",
      name: "Orphan",
      url: "http://localhost:3000/login/reset?token=t",
      expiresIn: "1 hour",
    }, env);
    expect(result.queued).toBe(false);
    const after = await tx.select().from(communicationLogs);
    expect(after).toHaveLength(before.length);
  });
});
