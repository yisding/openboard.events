import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, submissionIdSchema, taskIdSchema } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import type { EmailMessage } from "@/shared/server/email-provider";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";
import { DEMO_MAIL_SKIP_REASON } from "./context";
import { dispatchOutboxIn } from "./dispatcher";
import { scanRemindersIn } from "./reminders";
import { seedDefaultTemplates } from "./templates";

/**
 * First Fair — rail 4: the reminder crons are left running on purpose.
 *
 * The demo provisions a task that was due thirty days ago, which means the
 * whole −7/−1/+1 reminder ladder is already elapsed the moment the world
 * exists. Filtering demo events out of `scanRemindersIn` would have been the
 * obvious safety move and it would have deleted the thing Chapters 5 and 9 are
 * built around: a Communications log with a real ladder in it, showing real
 * outcomes. Rail 2 is what makes leaving the cron alone safe, so this suite
 * drives the actual scan against the actual backdated data and follows every
 * row it produces all the way to its terminal state.
 *
 * The real-event control runs the identical fixture: the ladder must behave the
 * same way on both, and diverge only at the dispatcher.
 */

const secret = "demo-reminders-secret-that-is-at-least-32-bytes";
const sendEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  UNSUBSCRIBE_SECRET: secret,
  EMAIL_MODE: "send",
  EMAIL_FALLBACK_UI: "0",
  EMAIL_FROM: "mail@example.org",
  RESEND_API_KEY: "re_test",
});

/** A typed `sendViaResend` stand-in, so `sender.mock.calls` keeps its shape. */
function spy() {
  return vi.fn((message: EmailMessage) => Promise.resolve(`provider:${message.to}`));
}

type Fixture = {
  eventId: ReturnType<typeof eventIdSchema.parse>;
  contactId: ReturnType<typeof contactIdSchema.parse>;
  submissionId: ReturnType<typeof submissionIdSchema.parse>;
  taskId: ReturnType<typeof taskIdSchema.parse>;
  email: string;
};

function uuid(prefix: string, nth: number): string {
  return `${prefix}-0000-4000-8000-${String(nth).padStart(12, "0")}`;
}

function fixture(prefix: string, email: string): Fixture {
  return {
    email,
    eventId: eventIdSchema.parse(uuid(prefix, 1)),
    contactId: contactIdSchema.parse(uuid(prefix, 2)),
    submissionId: submissionIdSchema.parse(uuid(prefix, 3)),
    taskId: taskIdSchema.parse(uuid(prefix, 4)),
  };
}

const demo = fixture("d1000000", "dana.whitfield@northline.demo.invalid");
const real = fixture("e1000000", "dana.whitfield@example.org");

describe("the reminder ladder on a demo event (First Fair rail 4)", () => {
  let pglite: PGlite;
  let tx: TxDb;

  /**
   * Dana Whitfield's overdue headshot task, exactly as phase 8 provisions it:
   * due thirty days ago, against a speaker accepted sixty days ago and a task
   * created sixty days ago. `materialized_at` therefore predates all three
   * rungs, so the ladder fires the latest one and permanently retires the rest
   * — the same shape an organizer would find on a real event that had been
   * running for two months.
   */
  async function seedOverdueTask(target: Fixture, isDemo: boolean): Promise<void> {
    await pglite.query(
      `INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at,is_demo)
       VALUES($1,$2,$3,'Moscone West','America/Los_Angeles',now()+interval '65 days',now()+interval '67 days',$4)`,
      [target.eventId, `Reminder ladder (${isDemo ? "demo" : "real"})`, isDemo ? "ladder-demo" : "ladder-real", isDemo],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Dana','Whitfield')",
      [target.contactId, target.eventId, target.email],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,title,source,submitter_contact_id,decided_at,updated_at)
       VALUES($1,$2,1,'accepted','Context Engineering','manual',$3,now()-interval '60 days',now()-interval '60 days')`,
      [target.submissionId, target.eventId, target.contactId],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary) VALUES($1,$2,$3,true)",
      [target.eventId, target.submissionId, target.contactId],
    );
    await pglite.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,created_at,updated_at)
       VALUES($1,$2,'Upload a headshot','contact','manual',now()-interval '30 days',now()-interval '60 days',now()-interval '60 days')`,
      [target.taskId, target.eventId],
    );
    await seedDefaultTemplates(tx, target.eventId);
  }

  async function rowsFor(target: Fixture) {
    const result = await pglite.query<{ template_key: string; status: string; error: string | null }>(
      "SELECT template_key,status,error FROM communication_logs WHERE event_id=$1 ORDER BY template_key,idempotency_key",
      [target.eventId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
    await seedOverdueTask(demo, true);
    await seedOverdueTask(real, false);
  }, 120_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM portal_tokens");
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("lets the cron enqueue the overdue ladder and drains every row to skipped", async () => {
    const stats = await scanRemindersIn(tx);

    // Rail 4 is only worth having if the ladder actually runs. Both events are
    // in the same database and the scan is unfiltered, so the demo's rows are
    // produced alongside the real event's.
    expect(stats.assignedEnqueued).toBe(2);
    expect(stats.remindersEnqueued).toBe(2);
    expect(stats.rungsRetired).toBe(4);

    const queuedBefore = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1 AND status='queued'",
      [demo.eventId],
    );
    expect(queuedBefore.rows[0]?.n).toBe(2);

    const sender = spy();
    await dispatchOutboxIn(tx, 50, { env: sendEnv, sender });

    const demoRows = await rowsFor(demo);
    expect(demoRows).toHaveLength(4);
    expect(demoRows.every((row) => row.status === "skipped")).toBe(true);
    // Two rungs were retired by the scan itself with their own reason; the two
    // that were genuinely queued are the ones the dispatcher had to stop.
    expect(demoRows.filter((row) => row.error === DEMO_MAIL_SKIP_REASON)).toHaveLength(2);
    expect(demoRows.filter((row) => row.error?.startsWith("superseded rung"))).toHaveLength(2);

    // Nothing addressed to a speaker who does not exist reached the provider.
    for (const call of sender.mock.calls) {
      expect(call[0].to).not.toBe(demo.email);
    }
  });

  it("leaves the same ladder on a real event delivering normally", async () => {
    await scanRemindersIn(tx);
    const sender = spy();

    await dispatchOutboxIn(tx, 50, { env: sendEnv, sender });

    const realRows = await rowsFor(real);
    expect(realRows.filter((row) => row.status === "sent")).toHaveLength(2);
    expect(realRows.filter((row) => row.error === DEMO_MAIL_SKIP_REASON)).toEqual([]);
    expect(sender.mock.calls.map((call) => call[0].to)).toEqual([real.email, real.email]);
  });

  it("re-scanning a demo event never resurrects a rung the dispatcher already skipped", async () => {
    await scanRemindersIn(tx);
    const sender = spy();
    await dispatchOutboxIn(tx, 50, { env: sendEnv, sender });

    // The 15-minute cron keeps ticking for as long as the demo exists. A
    // `skipped` row owns its idempotency key forever, so a second tick has
    // nothing to add and the dispatcher has nothing to claim.
    const second = await scanRemindersIn(tx);
    expect(second).toMatchObject({ assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 });
    await expect(dispatchOutboxIn(tx, 50, { env: sendEnv, sender }))
      .resolves.toMatchObject({ claimed: 0, sent: 0, skipped: 0 });
    expect(sender.mock.calls.every((call) => call[0].to === real.email)).toBe(true);
  });
});
