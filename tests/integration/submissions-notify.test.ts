import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, submissionIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// P3-EMAIL added `events.physical_address` and the suppression table the
// dispatcher consults.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M51 added `contacts.workflow_status`; auto-confirming a speaker goes through
// `updateContactFields`, whose bare `.returning()` selects every mapped column.
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M59 (drizzle/0016) added `contacts.acceptance_seen_at`. This harness applies
// a hand-picked subset of migrations rather than the whole journal, so any
// drizzle query that names every declared `contacts` column — an unqualified
// `.returning()`, or a `select()` of the whole table — fails against a
// database built without it. Applied last, as it is in the journal.
const migrationSpeakerMoments = readFileSync(new URL("../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");
const migrationStatusHistory = readFileSync(new URL("../../drizzle/0028_submission_status_history.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d1000000-0000-4000-8000-000000000001");
const speaker = contactIdSchema.parse("d1000000-0000-4000-8000-000000000002");
const organizer = userIdSchema.parse("d1000000-0000-4000-8000-000000000003");
const orphanSubmission = submissionIdSchema.parse("d1000000-0000-4000-8000-000000000010");
const toAccept = submissionIdSchema.parse("d1000000-0000-4000-8000-000000000011");
const toDecline = submissionIdSchema.parse("d1000000-0000-4000-8000-000000000012");
const pending = submissionIdSchema.parse("d1000000-0000-4000-8000-000000000013");

let pglite: PGlite;
let tx: TxDb;

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    db: new Proxy({}, { get: (_target, property) => Reflect.get(tx as object, property, tx) }),
    // A real `BEGIN`, not the ambient handle. `notifyQueues` and
    // `transitionStatus` are two of the audited `withTx` compositions, and
    // their contract is atomicity: running the callback outside a transaction
    // means a mid-batch failure leaves partial status writes and queued email
    // behind while every assertion here still passes, and the concurrency test
    // below has no row lock to serialize on.
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => (
      tx as unknown as { transaction: (callback: (handle: TxDb) => Promise<unknown>) => Promise<unknown> }
    ).transaction(work),
  };
});

const { listSubmissionStatusHistoryIn, notifyQueues, previewNotifyQueuesIn, transitionStatus, withdraw } = await import("@/features/submissions");

async function insert(id: string, status: string, withSubmitter = true) {
  await pglite.query(
    `INSERT INTO submissions(id,event_id,code,status,source,title,submitter_contact_id)
     VALUES($1,$2,$3,$4,'cfp',$5,$6)`,
    [id, eventId, Number(id.slice(-2)), status, `Proposal ${id.slice(-2)}`, withSubmitter ? speaker : null],
  );
}

async function commsFor(templateKey: string): Promise<Array<{ idempotency_key: string }>> {
  const rows = await pglite.query<{ idempotency_key: string }>(
    "SELECT idempotency_key FROM communication_logs WHERE template_key=$1 ORDER BY created_at",
    [templateKey],
  );
  return rows.rows;
}

describe("decide and notify", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationSpeakerMoments);
    await pglite.exec(migrationStatusHistory);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Event','event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')",
      [speaker, eventId],
    );
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Olive Organizer')", [organizer]);
    await pglite.query(
      `INSERT INTO email_templates(event_id,key,subject,body_html) VALUES
       ($1,'submission_accepted','Accepted for {{event.name}}','<p>Welcome {{speaker.first_name}}: {{submission.title}}</p>'),
       ($1,'submission_declined','Update from {{event.name}}','<p>Thank you for {{submission.title}}</p>')`,
      [eventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM submissions");
    await pglite.query("UPDATE contacts SET confirmation_status='unconfirmed'");
  });

  it("moves only the rows that are where the organizer thought they were", async () => {
    await insert(pending, "pending");
    await insert(toAccept, "accepted");

    const result = await transitionStatus(eventId, [pending, toAccept], "accept_queue", "pending");
    // The already-accepted row moved on since the screen was drawn, so it is
    // reported rather than quietly overwritten.
    expect(result.changed).toEqual([pending]);
    expect(result.stale).toEqual([toAccept]);
  });

  it("lets exactly one of two concurrent transitions win", async () => {
    await insert(pending, "pending");
    const [first, second] = await Promise.all([
      transitionStatus(eventId, [pending], "accept_queue", "pending"),
      transitionStatus(eventId, [pending], "decline_queue", "pending"),
    ]);
    const winners = [first, second].filter((result) => result.changed.length === 1);
    expect(winners).toHaveLength(1);
  });

  it("refuses an illegal transition before the trigger has to", async () => {
    await insert(pending, "withdrawn");
    const error = await transitionStatus(eventId, [pending], "accepted", "withdrawn").catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("STALE_STATUS");
  });

  it("finalizes both queues and sends exactly one email each", async () => {
    await insert(toAccept, "accept_queue");
    await insert(toDecline, "decline_queue");

    const preview = await previewNotifyQueuesIn(tx, eventId);
    const result = await notifyQueues(eventId, preview.queueRevision);
    expect(result.accepted).toEqual([toAccept]);
    expect(result.declined).toEqual([toDecline]);
    expect(result.emailsQueued).toBe(2);
    expect(await commsFor("submission_accepted")).toHaveLength(1);
    expect(await commsFor("submission_declined")).toHaveLength(1);
  });

  it("retains attributed organizer, notification, and speaker status changes", async () => {
    await insert(pending, "pending");
    await transitionStatus(eventId, [pending], "accept_queue", "pending", organizer);
    const preview = await previewNotifyQueuesIn(tx, eventId);
    await notifyQueues(eventId, preview.queueRevision, organizer);

    const decided = await listSubmissionStatusHistoryIn(tx, eventId, pending);
    expect(decided.map((entry) => [entry.fromStatus, entry.toStatus, entry.source])).toEqual([
      ["accept_queue", "accepted", "notification"],
      ["pending", "accept_queue", "organizer"],
      [null, "pending", "system"],
    ]);
    expect(decided[0]).toMatchObject({ actorName: "Olive Organizer", actorEmail: "organizer@example.com" });
    expect(decided[1]).toMatchObject({ actorName: "Olive Organizer", actorEmail: "organizer@example.com" });

    await insert(toDecline, "pending");
    await withdraw(eventId, speaker, toDecline);
    const withdrawn = await listSubmissionStatusHistoryIn(tx, eventId, toDecline);
    expect(withdrawn[0]).toMatchObject({
      fromStatus: "pending",
      toStatus: "withdrawn",
      source: "speaker",
      actorName: "Ada Lovelace",
      actorEmail: "ada@example.com",
    });
  });

  it("previews exact queue counts and samples without changing decisions", async () => {
    await insert(orphanSubmission, "accept_queue", false);
    await insert(toAccept, "accept_queue");
    await insert(toDecline, "decline_queue");

    const preview = await previewNotifyQueuesIn(tx, eventId);

    expect(preview).toMatchObject({
      accepted: 2,
      declined: 1,
      emailsQueued: 2,
      skippedNoRecipient: 1,
    });
    expect(preview.queueRevision).not.toBe("empty");
    expect(preview.samples.map((sample) => sample.decision)).toEqual(["accepted", "declined"]);
    expect(preview.samples[0]).toMatchObject({
      recipientName: "Ada Lovelace",
      recipientEmail: "ada@example.com",
      submissionTitle: "Proposal 11",
      subject: "Accepted for Event",
    });
    expect(preview.samples[0]?.bodyHtml).toContain("Welcome Ada: Proposal 11");
    expect(preview.samples[0]?.bodyText).toContain("Welcome Ada: Proposal 11");

    const statuses = await pglite.query<{ status: string }>("SELECT status FROM submissions ORDER BY code");
    expect(statuses.rows.map((row) => row.status)).toEqual(["accept_queue", "accept_queue", "decline_queue"]);
    expect(await commsFor("submission_accepted")).toHaveLength(0);
    const contact = await pglite.query<{ confirmation_status: string }>("SELECT confirmation_status FROM contacts WHERE id=$1", [speaker]);
    expect(contact.rows[0]?.confirmation_status).toBe("unconfirmed");
  });

  it("refuses to send an unreviewed decision added after the preview", async () => {
    await insert(toAccept, "accept_queue");
    const preview = await previewNotifyQueuesIn(tx, eventId);
    await insert(toDecline, "decline_queue");

    const error = await notifyQueues(eventId, preview.queueRevision).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("STALE_WRITE");
    const statuses = await pglite.query<{ status: string }>("SELECT status FROM submissions ORDER BY code");
    expect(statuses.rows.map((row) => row.status)).toEqual(["accept_queue", "decline_queue"]);
    expect(await commsFor("submission_accepted")).toHaveLength(0);
    expect(await commsFor("submission_declined")).toHaveLength(0);
  });

  it("rolls the whole batch back when one decision email cannot be queued", async () => {
    await insert(toAccept, "accept_queue");
    await insert(toDecline, "decline_queue");
    await pglite.exec(`
      CREATE FUNCTION fail_decline_email() RETURNS trigger AS $$
      BEGIN
        IF NEW.template_key = 'submission_declined' THEN
          RAISE EXCEPTION 'forced decision email failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_decline_email BEFORE INSERT ON communication_logs
      FOR EACH ROW EXECUTE FUNCTION fail_decline_email();
    `);

    const historyBefore = (await listSubmissionStatusHistoryIn(tx, eventId, toAccept)).length;

    try {
      await expect(notifyQueues(eventId)).rejects.toThrow();

      // The half that succeeded must not survive its sibling's failure. If it
      // did, the queue would show the acceptance already sent while its email
      // never was, and pressing Notify again would skip it.
      const statuses = await pglite.query<{ status: string }>("SELECT status FROM submissions ORDER BY code");
      expect(statuses.rows.map((row) => row.status)).toEqual(["accept_queue", "decline_queue"]);
      expect(await commsFor("submission_accepted")).toHaveLength(0);
      expect(await listSubmissionStatusHistoryIn(tx, eventId, toAccept)).toHaveLength(historyBefore);
    } finally {
      await pglite.exec("DROP TRIGGER fail_decline_email ON communication_logs; DROP FUNCTION fail_decline_email();");
    }
  });

  it("does nothing at all the second time Notify is pressed", async () => {
    await insert(toAccept, "accept_queue");
    await notifyQueues(eventId);
    const again = await notifyQueues(eventId);

    expect(again).toEqual({ accepted: [], declined: [], emailsQueued: 0, skippedNoRecipient: [] });
    expect(await commsFor("submission_accepted")).toHaveLength(1);
  });

  it("sends a second, distinct email after an organizer undoes and re-decides", async () => {
    await insert(toAccept, "accept_queue");
    await notifyQueues(eventId);

    // Undo to pending: the trigger clears notified_at and bumps notify_revision,
    // which is what makes the next decision a new email rather than a duplicate
    // the outbox would swallow.
    await transitionStatus(eventId, [toAccept], "pending", "accepted");
    await transitionStatus(eventId, [toAccept], "decline_queue", "pending");
    const second = await notifyQueues(eventId);

    expect(second.declined).toEqual([toAccept]);
    const keys = [...await commsFor("submission_accepted"), ...await commsFor("submission_declined")]
      .map((row) => row.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys.some((key) => key.endsWith(":0"))).toBe(true);
    expect(keys.some((key) => key.endsWith(":1"))).toBe(true);
  });

  it("auto-confirms an accepted speaker, because there is no confirm button", async () => {
    await insert(toAccept, "accept_queue");
    await notifyQueues(eventId);
    const rows = await pglite.query<{ confirmation_status: string }>("SELECT confirmation_status FROM contacts WHERE id=$1", [speaker]);
    expect(rows.rows[0]?.confirmation_status).toBe("confirmed");
  });

  it("confirms the primary participant, not whoever filled the form in", async () => {
    // A submitter may name somebody else as primary. Confirming the submitter
    // then says the wrong speaker is coming.
    const presenter = "d1000000-0000-4000-8000-000000000020";
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@example.com','Grace','Hopper') ON CONFLICT DO NOTHING",
      [presenter, eventId],
    );
    await insert(toAccept, "accept_queue");
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [eventId, toAccept, presenter],
    );

    const result = await notifyQueues(eventId);
    expect(result.emailsQueued).toBe(1);

    const rows = await pglite.query<{ id: string; confirmation_status: string }>(
      "SELECT id, confirmation_status FROM contacts ORDER BY email",
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.confirmation_status]));
    expect(byId[presenter]).toBe("confirmed");
    // The submitter still got the email, and is not silently marked as speaking.
    expect(byId[speaker]).toBe("unconfirmed");
  });

  it("does not auto-confirm on a decline", async () => {
    await insert(toDecline, "decline_queue");
    await notifyQueues(eventId);
    const rows = await pglite.query<{ confirmation_status: string }>("SELECT confirmation_status FROM contacts WHERE id=$1", [speaker]);
    expect(rows.rows[0]?.confirmation_status).toBe("unconfirmed");
  });

  it("reports a submission with nobody on it instead of failing the batch", async () => {
    await insert(orphanSubmission, "accept_queue", false);
    await insert(toAccept, "accept_queue");

    const result = await notifyQueues(eventId);
    expect(result.skippedNoRecipient).toEqual([orphanSubmission]);
    // The rest of the batch still went out.
    expect(result.emailsQueued).toBe(1);
  });

  it("writes nothing when both queues are empty", async () => {
    await insert(pending, "pending");
    const result = await notifyQueues(eventId);
    expect(result).toEqual({ accepted: [], declined: [], emailsQueued: 0, skippedNoRecipient: [] });
    expect(await commsFor("submission_accepted")).toHaveLength(0);
  });
});
