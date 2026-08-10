import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";
import { listOutstandingTasksIn, listPublicSubmissionsIn, toPublicCommLogRow, toPublicStats } from "./queries";

const migration0 = readFileSync(new URL("../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const OTHER_EVENT = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const TRACK = "b0000000-0000-4000-8000-000000000010";
const TAG = "b0000000-0000-4000-8000-000000000011";
const PRIMARY = "b0000000-0000-4000-8000-000000000020";
const CO_SPEAKER = "b0000000-0000-4000-8000-000000000021";
const ACCEPTED = "b0000000-0000-4000-8000-000000000030";
const PENDING = "b0000000-0000-4000-8000-000000000031";
const DRAFT = "b0000000-0000-4000-8000-000000000032";
const OTHER_EVENT_SUBMISSION = "b0000000-0000-4000-8000-000000000033";
const CONTACT_TASK = "b0000000-0000-4000-8000-000000000040";
const DONE_TASK = "b0000000-0000-4000-8000-000000000041";

let pglite: PGlite;
let db: DbOrTx;

describe("api/v1 keyed-route queries", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      `INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES
        ($1,'V1 Conf','v1-conf','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'Other Conf','other-conf','2026-10-01T16:00:00Z','2026-10-02T01:00:00Z')`,
      [EVENT, OTHER_EVENT],
    );
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Platforms','#6958d7')", [TRACK, EVENT]);
    await pglite.query("INSERT INTO tags(id,event_id,name) VALUES($1,$2,'Evals')", [TAG, EVENT]);
    await pglite.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
        ($1,$3,'ada@example.com','Ada','Lovelace'),
        ($2,$3,'grace@example.com','Grace','Hopper')`,
      [PRIMARY, CO_SPEAKER, EVENT],
    );

    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title,track_id,submitted_at,notified_at)
       VALUES($1,$2,101,'accepted','cfp','Caching at the edge',$3, now() - interval '2 days', now() - interval '1 day')`,
      [ACCEPTED, EVENT, TRACK],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title,submitted_at)
       VALUES($1,$2,102,'pending','cfp','Evals in production', now() - interval '1 day')`,
      [PENDING, EVENT],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title)
       VALUES($1,$2,103,'draft','cfp','Half-written idea')`,
      [DRAFT, EVENT],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title,submitted_at)
       VALUES($1,$2,201,'accepted','cfp','Belongs to another event', now())`,
      [OTHER_EVENT_SUBMISSION, OTHER_EVENT],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [EVENT, ACCEPTED, PRIMARY],
    );
    await pglite.query("INSERT INTO submission_tags(event_id,submission_id,tag_id) VALUES($1,$2,$3)", [EVENT, ACCEPTED, TAG]);

    await pglite.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at) VALUES
        ($1,$3,'Complete profile','contact','manual','2000-01-01T00:00:00Z'),
        ($2,$3,'Confirm attendance','contact','manual','2100-01-01T00:00:00Z')`,
      [CONTACT_TASK, DONE_TASK, EVENT],
    );
    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')",
      [EVENT, DONE_TASK, PRIMARY],
    );
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  });

  describe("listPublicSubmissionsIn", () => {
    it("excludes drafts unconditionally, even with no status filter", async () => {
      const { rows } = await listPublicSubmissionsIn(db, EVENT, { limit: 50, cursorCode: null });
      expect(rows.map((row) => row.status)).not.toContain("draft");
      expect(rows).toHaveLength(2);
    });

    it("is scoped to the event — another event's submissions never appear", async () => {
      const { rows } = await listPublicSubmissionsIn(db, EVENT, { limit: 50, cursorCode: null });
      expect(rows.some((row) => row.title === "Belongs to another event")).toBe(false);
    });

    it("filters by a single non-draft status", async () => {
      const { rows } = await listPublicSubmissionsIn(db, EVENT, { status: "pending", limit: 50, cursorCode: null });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: "Evals in production", status: "pending" });
    });

    it("shapes the DTO: formatted code, speakers, tags, track, submitter, notifiedAt", async () => {
      const { rows } = await listPublicSubmissionsIn(db, EVENT, { status: "accepted", limit: 50, cursorCode: null });
      expect(rows).toEqual([expect.objectContaining({
        code: "SESS-101",
        title: "Caching at the edge",
        status: "accepted",
        track: "Platforms",
        tags: ["Evals"],
        speakers: ["Ada Lovelace"],
        notifiedAt: expect.any(String),
        submittedAt: expect.any(String),
      })]);
    });

    it("paginates by code cursor and reports nextCursor only when more rows remain", async () => {
      const first = await listPublicSubmissionsIn(db, EVENT, { limit: 1, cursorCode: null });
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]?.code).toBe("SESS-101");
      expect(first.nextCursor).toBe("101");

      const second = await listPublicSubmissionsIn(db, EVENT, { limit: 1, cursorCode: Number(first.nextCursor) });
      expect(second.rows).toHaveLength(1);
      expect(second.rows[0]?.code).toBe("SESS-102");
      expect(second.nextCursor).toBeNull();
    });
  });

  describe("listOutstandingTasksIn", () => {
    it("matches the canonical speaker_outstanding_v total and excludes fully-done speakers", async () => {
      const rows = await listOutstandingTasksIn(db, EVENT);
      const expected = await pglite.query<{ open: number }>(
        "SELECT coalesce(sum(open_count), 0)::int AS open FROM speaker_outstanding_v WHERE event_id=$1 AND open_count > 0",
        [EVENT],
      );
      expect(rows.reduce((sum, row) => sum + row.openCount, 0)).toBe(expected.rows[0]?.open);
      expect(rows).toEqual([expect.objectContaining({ name: "Ada Lovelace", email: "ada@example.com", openCount: 1, overdueCount: 1 })]);
      expect(rows.some((row) => row.name === "Grace Hopper")).toBe(false);
    });
  });

  describe("toPublicStats", () => {
    it("keeps only kpis/statusCounts/speakerTracking, dropping the UI-only fields", () => {
      const overview = {
        event: { id: "e", slug: "e", name: "E", timezone: "UTC", startsAt: "2026-01-01T00:00:00Z", daysToEvent: 1 },
        kpis: { submissions: 1, acceptedSpeakers: 1, scheduledSessions: 0, unscheduledAccepted: 0 },
        statusCounts: { draft: 0, pending: 1, accept_queue: 0, decline_queue: 0, accepted: 0, declined: 0, withdrawn: 0 },
        speakerTracking: {
          acceptedSpeakers: 1, outstandingTasks: 1, overdueTasks: 0, topByOutstanding: [], overdue: [],
          confirmationMix: { confirmed: 0, unconfirmed: 1, declined: 0 }, missingAssets: { speakers: 0, bios: 0, headshots: 0 },
        },
        attention: [{ code: "awaiting_decision" as const, count: 1, href: "/events/e/abstracts" }],
        forms: [],
        recentSubmissions: [{ id: "s", code: "SESS-1", title: "T", status: "pending" as const, source: "cfp", speakers: [], tags: [], submittedAt: null }],
      };
      const publicStats = toPublicStats(overview);
      expect(Object.keys(publicStats).sort()).toEqual(["kpis", "speakerTracking", "statusCounts"]);
      expect(publicStats.kpis).toBe(overview.kpis);
    });
  });

  describe("toPublicCommLogRow", () => {
    it("drops every field that can carry a live magic link or an internal id", () => {
      const row = {
        id: "l" as never, contactId: "c" as never, recipientEmail: "ada@example.com", recipientName: "Ada Lovelace",
        templateKey: "submission_received" as const, status: "sent" as const,
        subjectRendered: "Your magic link: https://example.test/portal/t/secret", providerMessageId: "prov_1",
        error: null, icsUid: null, submissionId: null, sessionId: null, taskId: null,
        createdAt: "2026-01-01T00:00:00.000Z", sentAt: "2026-01-01T00:00:01.000Z",
      };
      expect(toPublicCommLogRow(row)).toEqual({
        recipient: { name: "Ada Lovelace", email: "ada@example.com" },
        templateKey: "submission_received",
        status: "sent",
        providerMessageId: "prov_1",
        createdAt: "2026-01-01T00:00:00.000Z",
        sentAt: "2026-01-01T00:00:01.000Z",
      });
    });
  });
});
