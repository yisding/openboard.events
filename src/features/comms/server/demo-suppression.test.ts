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
  organizationInvitationIdSchema,
  planIdSchema,
  sessionIdSchema,
  submissionIdSchema,
  taskIdSchema,
  tokenIdSchema,
  userIdSchema,
  TEMPLATE_KEYS,
  type TemplateKey,
} from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import type { EmailMessage } from "@/shared/server/email-provider";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";
import { DEMO_MAIL_SKIP_REASON } from "./context";
import { dispatchOutboxIn } from "./dispatcher";
import { seedDefaultTemplates } from "./templates";

/**
 * First Fair — rail 2, the dispatcher chokepoint (design §6).
 *
 * A demo event exists so a brand-new organizer can play with a conference full
 * of people who do not exist. Eighteen of them have plausible names and
 * plausible addresses, and the product queues, renders and logs real mail for
 * them exactly as it would for a real conference — which is the whole point of
 * the tour's Communications chapter. The one thing that must never happen is a
 * send.
 *
 * `buildContext` is the single choke point every outbox row passes before
 * `sendViaResend`, so the guard lives there and this suite is its proof. The
 * assertions are deliberately exhaustive over `TEMPLATE_KEYS` rather than over
 * a hand-picked list: the guarantee the product prints on screen is "no email
 * ever leaves the building", and a guarantee with an exception nobody wrote a
 * test for is a guarantee with an exception.
 *
 * The demo fixture is also configured to be hostile to the guard:
 *
 *  - its contact address is NOT on `EMAIL_ALLOWLIST`, so a row skipped for the
 *    wrong reason would still look "safe" — every assertion checks the reason,
 *    not just the status;
 *  - the environment is `EMAIL_MODE=send` with a live-looking API key, so
 *    nothing about the environment is doing the work;
 *  - templates are seeded, so no row can be skipped for a missing template.
 */

const secret = "demo-suppression-secret-that-is-at-least-32-bytes";
const sendEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  UNSUBSCRIBE_SECRET: secret,
  EMAIL_MODE: "send",
  EMAIL_FALLBACK_UI: "0",
  EMAIL_FROM: "mail@example.org",
  RESEND_API_KEY: "re_test",
  // Only the real event's address is allowlisted. The demo event's is not, so
  // a guard that ran *after* the allowlist would produce a skipped row with
  // the wrong reason — which every assertion below would catch.
  EMAIL_ALLOWLIST: "@example.org",
});
/**
 * The same environment with the demo's unroutable domain allowlisted too.
 * Used where the point is to isolate the dispatcher guard from rail 1: with
 * the allowlist unable to intervene, anything that still stops a demo row is
 * `buildContext`'s `is_demo` check and nothing else.
 */
const demoAllowlistedEnv = parseEnv({ ...sendEnv, EMAIL_ALLOWLIST: "@example.org,@northline.demo.invalid" });

/** A typed `sendViaResend` stand-in, so `sender.mock.calls` keeps its shape. */
function spy() {
  return vi.fn((message: EmailMessage) => Promise.resolve(`provider:${message.to}`));
}

type Fixture = {
  label: string;
  eventId: ReturnType<typeof eventIdSchema.parse>;
  slug: string;
  contactId: ReturnType<typeof contactIdSchema.parse>;
  email: string;
  formId: string;
  receivedId: ReturnType<typeof submissionIdSchema.parse>;
  acceptedId: ReturnType<typeof submissionIdSchema.parse>;
  declinedId: ReturnType<typeof submissionIdSchema.parse>;
  sessionId: ReturnType<typeof sessionIdSchema.parse>;
  taskId: ReturnType<typeof taskIdSchema.parse>;
  planId: ReturnType<typeof planIdSchema.parse>;
  reviewerUserId: ReturnType<typeof userIdSchema.parse>;
  tokenId: ReturnType<typeof tokenIdSchema.parse>;
  invitationId: ReturnType<typeof organizationInvitationIdSchema.parse>;
};

/** `<prefix>-0000-4000-8000-<nn>` keeps every fixture id readable in a failure. */
function uuid(prefix: string, nth: number): string {
  return `${prefix}-0000-4000-8000-${String(nth).padStart(12, "0")}`;
}

function fixture(label: string, prefix: string, slug: string, email: string): Fixture {
  return {
    label,
    slug,
    email,
    eventId: eventIdSchema.parse(uuid(prefix, 1)),
    contactId: contactIdSchema.parse(uuid(prefix, 2)),
    formId: uuid(prefix, 3),
    receivedId: submissionIdSchema.parse(uuid(prefix, 4)),
    acceptedId: submissionIdSchema.parse(uuid(prefix, 5)),
    declinedId: submissionIdSchema.parse(uuid(prefix, 6)),
    sessionId: sessionIdSchema.parse(uuid(prefix, 7)),
    taskId: taskIdSchema.parse(uuid(prefix, 8)),
    planId: planIdSchema.parse(uuid(prefix, 9)),
    reviewerUserId: userIdSchema.parse(uuid(prefix, 10)),
    tokenId: tokenIdSchema.parse(uuid(prefix, 11)),
    invitationId: organizationInvitationIdSchema.parse(uuid(prefix, 12)),
  };
}

const demo = fixture("demo", "d0000000", "worlds-fair-demo", "dana.whitfield@northline.demo.invalid");
const real = fixture("real", "e0000000", "worlds-fair-real", "dana.whitfield@example.org");

/**
 * The keys whose fixture below is complete enough to reach the provider on a
 * real event. They are the no-regression half of this suite: the guard must
 * narrow demo events and nothing else.
 *
 * `admin_password_reset` / `admin_email_verification` are absent because their
 * sealed envelope has no exported sealer (only `openAdminLinkPayload`), so an
 * opaque payload fails terminally here rather than sending; `organization_invited`
 * is absent because its invitation is not pending. Both are still enqueued on
 * both events, and both are still asserted never to carry the demo reason.
 */
const REAL_EVENT_MUST_SEND: readonly TemplateKey[] = [
  "submission_received",
  "submission_accepted",
  "submission_declined",
  "task_assigned",
  "task_reminder",
  "schedule_assigned",
  "portal_login",
  "reviewer_invited",
  "review_reminder",
  "speaker_bulk_message",
];

describe("demo events never send mail (First Fair rail 2)", () => {
  let pglite: PGlite;
  let tx: TxDb;

  async function seedFixture(target: Fixture, isDemo: boolean): Promise<void> {
    await pglite.query(
      `INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at,is_demo)
       VALUES($1,$2,$3,'Moscone West','America/Los_Angeles','2099-09-15T16:00:00Z','2099-09-17T01:00:00Z',$4)`,
      [target.eventId, `AI Engineer World’s Fair (${target.label})`, target.slug, isDemo],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Dana','Whitfield')",
      [target.contactId, target.eventId, target.email],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Speak at the Fair','open')",
      [target.formId, target.eventId],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id,decided_at)
       VALUES($1,$5,$6,1,1,'pending','Voice Agents Under 300ms','cfp',$4,NULL),
             ($2,$5,$6,1,2,'accepted','Context Engineering','cfp',$4,now()),
             ($3,$5,$6,1,3,'declined','How Vellumatic Solves Agent Reliability','cfp',$4,now())`,
      [target.receivedId, target.acceptedId, target.declinedId, target.contactId, target.eventId, target.formId],
    );
    // The accepted submission is what makes the contact an accepted speaker,
    // which is what materialises the contact-targeted task assignment the two
    // task templates need.
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary) VALUES($1,$2,$3,true)",
      [target.eventId, target.acceptedId, target.contactId],
    );
    await pglite.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status)
       VALUES($1,$2,$3,'Context Engineering','context-engineering','2099-09-15T18:00:00Z','2099-09-15T18:30:00Z','published')`,
      [target.sessionId, target.eventId, target.acceptedId],
    );
    await pglite.query(
      "INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)",
      [target.eventId, target.sessionId, target.contactId],
    );
    await pglite.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at)
       VALUES($1,$2,'Upload a headshot','contact','manual','2099-08-01T07:00:00Z')`,
      [target.taskId, target.eventId],
    );
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,$2,'Program Chair')",
      [target.reviewerUserId, `chair-${target.label}@example.org`],
    );
    await pglite.query(
      "INSERT INTO evaluation_plans(id,event_id,name,round,scale_min,scale_max,status) VALUES($1,$2,'First pass',1,1,5,'open')",
      [target.planId, target.eventId],
    );
    await pglite.query(
      "INSERT INTO reviewer_assignments(event_id,plan_id,user_id) VALUES($1,$2,$3)",
      [target.eventId, target.planId, target.reviewerUserId],
    );
    await pglite.query(
      "INSERT INTO review_assignments(event_id,plan_id,submission_id,reviewer_user_id,status) VALUES($1,$2,$3,$4,'assigned')",
      [target.eventId, target.planId, target.receivedId, target.reviewerUserId],
    );
    await pglite.query(
      "INSERT INTO speaker_bulk_messages(event_id,contact_id,idempotency_key,subject,body_html) VALUES($1,$2,$3,'Travel details','<p>Hi Dana</p>')",
      [target.eventId, target.contactId, idem.speakerBulk(target.eventId, target.contactId, "bulk-1")],
    );
    await seedDefaultTemplates(tx, target.eventId);
  }

  /**
   * One queued row per `TEMPLATE_KEYS` value. Everything that can go through
   * `enqueueEmail` does, so the sealed-payload contract and the
   * `communication_logs` CHECK constraints are honoured exactly as they are in
   * production.
   *
   * The two M42 admin auth keys are the exception, and deliberately so:
   * drizzle/0011 narrowed `communication_logs_secret_payload_check` back to
   * `portal_login` only, and `enqueueEmail` requires a sealed payload for those
   * keys, so the pair is no longer reachable through the event-scoped outbox at
   * all (product auth mail moved to `admin_auth_email_outbox`). They are still
   * legal `template_key` values with legacy rows in the wild, so the demo guard
   * is asserted over them too — inserted the only way such a row can exist.
   */
  async function enqueueEveryTemplate(target: Fixture): Promise<void> {
    const { eventId, contactId } = target;
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: idem.received(eventId, target.receivedId), refs: { submissionId: target.receivedId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_accepted", idempotencyKey: idem.decision(eventId, target.acceptedId, 1), refs: { submissionId: target.acceptedId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "submission_declined", idempotencyKey: idem.decision(eventId, target.declinedId, 1), refs: { submissionId: target.declinedId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "task_assigned", idempotencyKey: idem.taskAssigned(eventId, target.taskId, contactId, null), refs: { taskId: target.taskId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "task_reminder", idempotencyKey: idem.taskReminder(eventId, target.taskId, contactId, null, -7), refs: { taskId: target.taskId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_assigned", idempotencyKey: idem.scheduled(eventId, target.sessionId, contactId, 0), refs: { sessionId: target.sessionId } });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "schedule_changed", idempotencyKey: idem.scheduled(eventId, target.sessionId, contactId, 1), refs: { sessionId: target.sessionId } });
    await enqueueEmail(tx, {
      eventId,
      contactId,
      templateKey: "portal_login",
      idempotencyKey: idem.portalLogin(eventId, contactId, target.tokenId),
      secretPayloadCiphertext: await sealPortalLoginPayload(
        { otp: "123456", magicLink: `http://localhost:3000/portal/${target.slug}/verify?token=live-secret` },
        { eventId, contactId, tokenId: target.tokenId },
        secret,
      ),
    });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "reviewer_invited", idempotencyKey: idem.reviewerInvited(eventId, target.reviewerUserId) });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "review_reminder", idempotencyKey: idem.reviewReminder(eventId, target.planId, target.reviewerUserId, "attempt-1") });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "speaker_bulk_message", idempotencyKey: idem.speakerBulk(eventId, contactId, "bulk-1") });
    await enqueueEmail(tx, { eventId, contactId, templateKey: "organization_invited", idempotencyKey: idem.organizationInvited(eventId, target.invitationId, "send-1") });
    await pglite.query(
      `INSERT INTO communication_logs(event_id,contact_id,template_key,idempotency_key,status)
       VALUES($1,$2,'admin_password_reset',$3,'queued'),($1,$2,'admin_email_verification',$4,'queued')`,
      [
        eventId,
        contactId,
        idem.adminAuthLink(eventId, "admin_password_reset", target.reviewerUserId, "link-1"),
        idem.adminAuthLink(eventId, "admin_email_verification", target.reviewerUserId, "link-2"),
      ],
    );
  }

  async function logRows(target: Fixture) {
    const result = await pglite.query<{ template_key: TemplateKey; status: string; error: string | null }>(
      "SELECT template_key,status,error FROM communication_logs WHERE event_id=$1 ORDER BY template_key",
      [target.eventId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
    await seedFixture(demo, true);
    await seedFixture(real, false);
  }, 120_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM calendar_invites");
    await pglite.query("DELETE FROM portal_tokens");
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("skips every template key on a demo event without calling the provider", async () => {
    await enqueueEveryTemplate(demo);
    const sender = spy();

    const stats = await dispatchOutboxIn(tx, 50, { env: sendEnv, sender });

    expect(stats).toEqual({
      claimed: TEMPLATE_KEYS.length,
      sent: 0,
      skipped: TEMPLATE_KEYS.length,
      failed: 0,
      retried: 0,
    });
    // The assertion the whole feature rests on.
    expect(sender).toHaveBeenCalledTimes(0);

    const rows = await logRows(demo);
    expect(rows).toHaveLength(TEMPLATE_KEYS.length);
    expect([...new Set(rows.map((row) => row.template_key))].sort())
      .toEqual([...TEMPLATE_KEYS].sort());
    // Status alone is not enough: a row skipped for the allowlist, a missing
    // template or a stale decision would look identical on the dashboard while
    // proving nothing about the demo guard.
    for (const row of rows) {
      expect({ key: row.template_key, status: row.status, error: row.error })
        .toEqual({ key: row.template_key, status: "skipped", error: DEMO_MAIL_SKIP_REASON });
    }
  });

  it("refuses a demo row before minting a portal credential or opening a sealed payload", async () => {
    await enqueueEveryTemplate(demo);
    const sender = spy();

    // The demo domain is allowlisted for this run on purpose: with the
    // allowlist out of the way, the demo guard is the only thing left that can
    // stop these rows, so what follows measures the guard and not the rail
    // above it.
    const stats = await dispatchOutboxIn(tx, 50, { env: demoAllowlistedEnv, sender });

    expect(stats).toMatchObject({ sent: 0, skipped: TEMPLATE_KEYS.length, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(0);
    for (const row of await logRows(demo)) expect(row.error).toBe(DEMO_MAIL_SKIP_REASON);
    // `buildContext` mints magic-link and calendar tokens for most templates on
    // its way to a send. The guard runs above all of that, so a demo event
    // leaves no credential behind — and no rendered body to leak one from.
    const tokens = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_tokens");
    expect(tokens.rows[0]?.n).toBe(0);
    const rendered = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1 AND (body_rendered_html IS NOT NULL OR subject_rendered IS NOT NULL)",
      [demo.eventId],
    );
    expect(rendered.rows[0]?.n).toBe(0);
    const secrets = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1 AND secret_payload_ciphertext IS NOT NULL",
      [demo.eventId],
    );
    expect(secrets.rows[0]?.n).toBe(0);
  });

  it("still delivers the same template keys on a real event", async () => {
    await enqueueEveryTemplate(real);
    const sender = spy();

    await dispatchOutboxIn(tx, 50, { env: sendEnv, sender });

    const rows = await logRows(real);
    expect(rows).toHaveLength(TEMPLATE_KEYS.length);
    // The guard narrows demo events and nothing else: no real-event row may
    // ever carry the demo reason, whatever else happened to it.
    expect(rows.filter((row) => row.error === DEMO_MAIL_SKIP_REASON)).toEqual([]);

    const sentKeys = rows.filter((row) => row.status === "sent").map((row) => row.template_key);
    for (const key of REAL_EVENT_MUST_SEND) expect(sentKeys).toContain(key);
    expect(sender).toHaveBeenCalledTimes(sentKeys.length);
    for (const call of sender.mock.calls) {
      expect(call[0].to).toBe(real.email);
    }
  });

  it("keeps the demo barrier independent of the send allowlist", async () => {
    // Same run, both events at once: the demo event's address is unroutable and
    // unallowlisted, the real event's is allowlisted. A dispatcher tick that
    // drains both must sort them correctly on `is_demo` alone.
    await enqueueEveryTemplate(demo);
    await enqueueEveryTemplate(real);
    const sender = spy();

    await dispatchOutboxIn(tx, 100, { env: sendEnv, sender });

    const demoRows = await logRows(demo);
    expect(demoRows.every((row) => row.status === "skipped" && row.error === DEMO_MAIL_SKIP_REASON)).toBe(true);
    expect(sender.mock.calls.every((call) => call[0].to === real.email)).toBe(true);
    expect(sender.mock.calls.length).toBeGreaterThan(0);
  });
});
