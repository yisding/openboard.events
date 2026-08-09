import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUBMISSION_STATUSES, eventIdSchema } from "@/shared/contracts";
import { getOverviewIn } from "./server/overview";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const EMPTY_EVENT = eventIdSchema.parse("a0000000-0000-4000-8000-000000000002");
const FORM = "a0000000-0000-4000-8000-000000000003";
const PRIMARY = "a0000000-0000-4000-8000-000000000004";
const CO_SPEAKER = "a0000000-0000-4000-8000-000000000005";
const ACCEPTED = "a0000000-0000-4000-8000-000000000006";
const PENDING = "a0000000-0000-4000-8000-000000000007";
const DRAFT = "a0000000-0000-4000-8000-000000000008";
const CONTACT_TASK = "a0000000-0000-4000-8000-000000000009";
const SUBMISSION_TASK = "a0000000-0000-4000-8000-000000000010";
const TAG = "a0000000-0000-4000-8000-000000000011";

let pg: PGlite;

describe("dashboard overview", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migration1);
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
        ($1,'DashboardConf','dashboard-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'EmptyConf','empty-conf','America/New_York','2026-10-01T13:00:00Z','2026-10-01T22:00:00Z')`,
      [EVENT, EMPTY_EVENT],
    );
    await pg.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Main CFP','open','2026-08-31T07:00:00Z')",
      [FORM, EVENT],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html,confirmation_status) VALUES
        ($1,$3,'ada@example.com','Ada','Lovelace','<p>Computing pioneer.</p>','confirmed'),
        ($2,$3,'grace@example.com','Grace','Hopper',NULL,'unconfirmed')`,
      [PRIMARY, CO_SPEAKER, EVENT],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,title,submitted_at) VALUES
        ($1,$4,$5,1,101,'accepted','cfp','Reliable agents','2026-08-07T20:00:00Z'),
        ($2,$4,$5,1,102,'pending','cfp','Fast inference','2026-08-08T01:00:00Z'),
        ($3,$4,$5,1,103,'draft','cfp','Draft idea',NULL)`,
      [ACCEPTED, PENDING, DRAFT, EVENT, FORM],
    );
    await pg.query(
      `INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES
        ($1,$2,$3,true,0),($1,$2,$4,false,1),($1,$5,$3,true,0)`,
      [EVENT, ACCEPTED, PRIMARY, CO_SPEAKER, PENDING],
    );
    await pg.query("INSERT INTO tags(id,event_id,name) VALUES($1,$2,'AI safety')", [TAG, EVENT]);
    await pg.query("INSERT INTO submission_tags(event_id,submission_id,tag_id) VALUES($1,$2,$3)", [EVENT, PENDING, TAG]);
    await pg.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at) VALUES
        ($1,$3,'Complete profile','contact','manual','2000-01-01T00:00:00Z'),
        ($2,$3,'Upload slides','submission','manual','2100-01-01T00:00:00Z')`,
      [CONTACT_TASK, SUBMISSION_TASK, EVENT],
    );
    await pg.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')",
      [EVENT, CONTACT_TASK, PRIMARY],
    );
  }, 30_000);

  afterAll(async () => {
    await pg.close();
  });

  it("zero-fills all seven statuses and derives the non-draft KPI", async () => {
    const overview = await getOverviewIn(drizzle(pg), EVENT, new Date("2026-08-08T19:00:00Z"));
    expect(Object.keys(overview.statusCounts)).toEqual(SUBMISSION_STATUSES);
    const allStatuses = Object.values(overview.statusCounts).reduce((sum, count) => sum + count, 0);
    expect(overview.kpis.submissions).toBe(allStatuses - overview.statusCounts.draft);
    expect(overview.event.slug).toBe("dashboard-conf");
    expect(overview.event.daysToEvent).toBe(38);
    expect(overview.recentSubmissions[0]).toMatchObject({ code: "SESS-102", speakers: ["Ada Lovelace"], tags: ["AI safety"] });
  });

  it("returns designed zero values and empty collections for an empty event", async () => {
    const overview = await getOverviewIn(drizzle(pg), EMPTY_EVENT);
    expect(overview.kpis).toEqual({ submissions: 0, acceptedSpeakers: 0, scheduledSessions: 0, unscheduledAccepted: 0 });
    expect(Object.values(overview.statusCounts)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(overview.speakerTracking).toMatchObject({
      acceptedSpeakers: 0,
      outstandingTasks: 0,
      overdueTasks: 0,
      topByOutstanding: [],
      overdue: [],
      confirmationMix: { confirmed: 0, unconfirmed: 0, declined: 0 },
      missingAssets: { speakers: 0, bios: 0, headshots: 0 },
    });
    expect(overview.attention).toEqual([]);
    expect(overview.forms).toEqual([]);
    expect(overview.recentSubmissions).toEqual([]);
  });

  it("matches the canonical speaker_outstanding_v total", async () => {
    const overview = await getOverviewIn(drizzle(pg), EVENT);
    const expected = await pg.query<{ open: number }>(
      "SELECT coalesce(sum(open_count), 0)::int AS open FROM speaker_outstanding_v WHERE event_id=$1",
      [EVENT],
    );
    expect(overview.speakerTracking.outstandingTasks).toBe(expected.rows[0]?.open);
    expect(overview.speakerTracking.outstandingTasks).toBe(2);
    expect(overview.speakerTracking.overdueTasks).toBe(1);
  });
});
