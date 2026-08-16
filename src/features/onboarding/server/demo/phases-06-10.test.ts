import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { detectConflicts, getSchedulableSessionsIn } from "@/features/agenda";
import { createOrganizationIn } from "@/features/organizations";
import { organizationIdSchema, userIdSchema, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../../scripts/lib/product-migrations";
import { DEMO_RUNNABLE_PHASES } from "../../demo-schemas";
import {
  COMM_LOG_ROWS,
  DATASET_MANIFEST,
  FILE_REQUESTS,
  RESOURCE_PAGES,
  SESSIONS,
  SET_PIECE_TRAY_SESSION_KEY,
  TASK_DEFINITIONS,
} from "./dataset";
import { demoEventId } from "./ids";
import { advanceDemoProvisioningIn } from "./provisioning";

/**
 * First Fair — WP5's own half of the world: the review queue, the agenda's
 * planted conflicts, the speaker portal, the resource pages and the
 * backdated delivery log.
 *
 * Idempotency (every phase run twice → identical row counts) and the
 * "nothing queued" invariant are already exercised across all ten phases by
 * `provisioning.test.ts`'s own `it.each` loop and its "writes no queued
 * outbox row" assertion — that suite starts covering phases 6–10 the moment
 * their runners replace the no-ops, so this file does not repeat either
 * check. What it verifies instead is content this phase's own writers are
 * responsible for getting right: the two rounds' shape, the schedule's
 * geometry, the one overdue assignment, the resource pages and the ledger.
 */

describe("phases 6-10", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let ownerUserId: UserId;
  let organizationId: OrganizationId;
  let eventId: EventId;

  const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;

    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["first-fair-wp5@test.dev", "WP5 Owner"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
    const organization = await createOrganizationIn(database, ownerUserId, { name: "wp5-world", slug: "wp5-world" });
    organizationId = organizationIdSchema.parse(organization.id);
    eventId = demoEventId(organizationId);

    for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
    }
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("matches the dataset manifest exactly for every table these phases own", async () => {
    const counts: Record<string, number> = {};
    for (const [table, column] of [
      ["sessions", "event_id"], ["portal_tasks", "event_id"], ["file_requests", "event_id"],
      ["resource_pages", "event_id"], ["communication_logs", "event_id"],
    ] as const) {
      const row = await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [eventId]);
      counts[table] = row.rows[0]?.n ?? 0;
    }
    expect(counts.sessions).toBe(DATASET_MANIFEST.sessions);
    expect(counts.sessions).toBe(SESSIONS.length);
    expect(counts.portal_tasks).toBe(DATASET_MANIFEST.taskDefinitions);
    expect(counts.portal_tasks).toBe(TASK_DEFINITIONS.length);
    expect(counts.file_requests).toBe(DATASET_MANIFEST.fileRequests);
    expect(counts.file_requests).toBe(FILE_REQUESTS.length);
    expect(counts.resource_pages).toBe(DATASET_MANIFEST.resourcePages);
    expect(counts.resource_pages).toBe(RESOURCE_PAGES.length);
    expect(counts.communication_logs).toBe(DATASET_MANIFEST.communicationLogs);
    expect(counts.communication_logs).toBe(COMM_LOG_ROWS.length);
  });

  describe("evaluation (phase 6)", () => {
    it("opens round one to the organizer with real, unscored work", async () => {
      const rows = await pglite.query<{ name: string; round: number; status: string; anonymize_authors: boolean; opens_at: Date | null }>(
        "SELECT name, round, status, anonymize_authors, opens_at FROM evaluation_plans WHERE event_id = $1 ORDER BY round",
        [eventId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toMatchObject({ name: "First pass", round: 1, status: "open", anonymize_authors: false });
      expect(rows.rows[1]).toMatchObject({ name: "Program committee", round: 2, status: "open", anonymize_authors: true });
      // "Scheduled" — round two is blind and exists, but has not opened yet.
      const opensAt = rows.rows[1]?.opens_at ? new Date(rows.rows[1].opens_at).getTime() : 0;
      expect(opensAt).toBeGreaterThan(Date.now());

      const criteria = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM evaluation_criteria c
           JOIN evaluation_plans p ON p.id = c.plan_id
          WHERE p.event_id = $1 AND p.round = 1`,
        [eventId],
      );
      expect(criteria.rows[0]?.n).toBe(3);

      const assignments = await pglite.query<{ reviewer_user_id: string; status: string }>(
        `SELECT ra.reviewer_user_id, ra.status FROM review_assignments ra
           JOIN evaluation_plans p ON p.id = ra.plan_id
          WHERE p.event_id = $1 AND p.round = 1`,
        [eventId],
      );
      expect(assignments.rows).toHaveLength(6);
      expect(assignments.rows.every((row) => row.reviewer_user_id === ownerUserId && row.status === "assigned")).toBe(true);

      const roundTwoAssignments = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM review_assignments ra
           JOIN evaluation_plans p ON p.id = ra.plan_id
          WHERE p.event_id = $1 AND p.round = 2`,
        [eventId],
      );
      expect(roundTwoAssignments.rows[0]?.n).toBe(0);
    });

    it("scores nothing on the organizer's behalf (design D6)", async () => {
      const reviews = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reviews r
           JOIN evaluation_plans p ON p.id = r.plan_id
          WHERE p.event_id = $1`,
        [eventId],
      );
      expect(reviews.rows[0]?.n).toBe(0);
    });
  });

  describe("agenda (phase 7)", () => {
    it("leaves every session unpublished, with three accepted-but-unscheduled in the tray", async () => {
      const rows = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM sessions WHERE event_id = $1 AND status = 'published'",
        [eventId],
      );
      expect(rows.rows[0]?.n).toBe(0);

      const unscheduled = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM sessions WHERE event_id = $1 AND (starts_at IS NULL OR room_id IS NULL)",
        [eventId],
      );
      expect(unscheduled.rows[0]?.n).toBe(SESSIONS.filter((session) => session.placement === null).length);
    });

    it("leaves Chapter 7's set-piece talk in the tray, not on the grid", async () => {
      // The dataset says `placement: null`; this is the same claim asserted
      // against a really provisioned event, because the failure it guards is
      // a provisioner that schedules it anyway (`promoteSubmissionIn` alone
      // does not, but a future auto-placement step could). The tour arms
      // `sessionsScheduled` on this row moving out of the tray, so a start
      // time here is a chapter the organizer cannot complete.
      const setPiece = SESSIONS.find((session) => session.key === SET_PIECE_TRAY_SESSION_KEY);
      const rows = await pglite.query<{ starts_at: Date | null; room_id: string | null }>(
        "SELECT starts_at, room_id FROM sessions WHERE event_id = $1 AND title = $2",
        [eventId, setPiece?.title],
      );
      expect(rows.rows, setPiece?.title).toHaveLength(1);
      expect(rows.rows[0]?.starts_at).toBeNull();
      expect(rows.rows[0]?.room_id).toBeNull();
    });

    it("plants exactly two conflicts in the provisioned world, and never flags the back-to-back pair", async () => {
      const schedulable = await getSchedulableSessionsIn(database, eventId, null);
      const conflicts = detectConflicts(schedulable);

      // The room double-booking (Main Stage, 10:15) and the same-speaker
      // double-booking (Priya Kalburgi, 14:00), and *nothing else*. The total
      // is what matters, not the blocking subset: same-track overlaps are
      // `severity: "warning"` but still land in the Conflicts badge, the
      // toolbar banner and `world.conflictCount`, so a third one would make
      // the cold open's "two scheduling conflicts" false on the screen the
      // organizer opens ninety seconds later.
      expect(conflicts).toHaveLength(2);
      expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(["room", "speaker"]);

      const titleOf = async (key: string) => {
        const session = SESSIONS.find((candidate) => candidate.key === key);
        const [row] = (await pglite.query<{ id: string }>(
          "SELECT id FROM sessions WHERE event_id = $1 AND title = $2",
          [eventId, session?.title],
        )).rows;
        return row?.id;
      };
      const backToBackIds = [await titleOf("robotics-world-models"), await titleOf("shipping-mcp-servers")];
      const flaggedIds = new Set<string>(conflicts.flatMap((conflict) => [conflict.a, conflict.b]));
      for (const id of backToBackIds) {
        expect(id).toBeDefined();
        expect(flaggedIds.has(id as string)).toBe(false);
      }
    });
  });

  describe("portal (phase 8)", () => {
    it("gives the whole roster of accepted speakers the same four tasks", async () => {
      const tasks = await pglite.query<{ name: string; target_type: string; completion_mode: string }>(
        "SELECT name, target_type, completion_mode FROM portal_tasks WHERE event_id = $1 ORDER BY name",
        [eventId],
      );
      expect(tasks.rows).toHaveLength(TASK_DEFINITIONS.length);
      expect(tasks.rows.every((row) => row.target_type === "contact")).toBe(true);
    });

    it("leaves exactly one assignment overdue, event-wide", async () => {
      const overdue = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_assignments_v v
           JOIN portal_tasks t ON t.id = v.task_id
          WHERE v.event_id = $1 AND v.overdue`,
        [eventId],
      );
      expect(overdue.rows[0]?.n).toBe(1);
    });
  });

  describe("resources (phase 9)", () => {
    it("publishes two of the three pages", async () => {
      const rows = await pglite.query<{ published: boolean }>(
        "SELECT published FROM resource_pages WHERE event_id = $1",
        [eventId],
      );
      expect(rows.rows).toHaveLength(RESOURCE_PAGES.length);
      expect(rows.rows.filter((row) => !row.published)).toHaveLength(1);
    });
  });

  describe("comms (phase 10)", () => {
    it("enables a real reminder ladder", async () => {
      const rules = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM reminder_rules WHERE event_id = $1 AND enabled",
        [eventId],
      );
      expect(rules.rows[0]?.n).toBe(4);
    });

    it("writes nine terminal, event-namespaced log rows and nothing queued", async () => {
      const rows = await pglite.query<{ status: string; idempotency_key: string }>(
        "SELECT status, idempotency_key FROM communication_logs WHERE event_id = $1",
        [eventId],
      );
      expect(rows.rows).toHaveLength(COMM_LOG_ROWS.length);
      expect(rows.rows.every((row) => row.idempotency_key.startsWith(`demo:${eventId}:`))).toBe(true);
      expect([...new Set(rows.rows.map((row) => row.status))]).toEqual(["skipped"]);
    });

    // MTP-18 §4/26, the safety audit's pass/fail row: the demo may never claim
    // to have dispatched mail, not even in backdated history nobody watched
    // being written. Status *and* reason, because a row skipped for a missing
    // template would also read `skipped` while meaning something else.
    it("never claims a demo send: every backdated row is skipped, for the demo reason, with no sent timestamp", async () => {
      const rows = await pglite.query<{ status: string; error: string | null; sent_at: Date | null; attempts: number }>(
        "SELECT status, error, sent_at, attempts FROM communication_logs WHERE event_id = $1",
        [eventId],
      );
      // Non-vacuity first: "every row is skipped" is trivially true of zero
      // rows, and a phase 10 that seeded nothing would pass the loop below
      // while failing the guarantee the loop exists to enforce.
      expect(rows.rows).toHaveLength(COMM_LOG_ROWS.length);
      for (const row of rows.rows) {
        expect(row).toMatchObject({
          status: "skipped",
          error: "demo event — mail is never delivered",
          sent_at: null,
          attempts: 0,
        });
      }
    });
  });
});
