import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, submissionIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d1000000-0000-4000-8000-000000000001");
const speaker = contactIdSchema.parse("d1000000-0000-4000-8000-000000000002");
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
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => work(tx),
  };
});

const { notifyQueues, transitionStatus } = await import("@/features/submissions");

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
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Event','event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')",
      [speaker, eventId],
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

    const result = await notifyQueues(eventId);
    expect(result.accepted).toEqual([toAccept]);
    expect(result.declined).toEqual([toDecline]);
    expect(result.emailsQueued).toBe(2);
    expect(await commsFor("submission_accepted")).toHaveLength(1);
    expect(await commsFor("submission_declined")).toHaveLength(1);
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
