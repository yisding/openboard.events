import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { getNavCountsIn, getReviewerQueueCountIn } from "./nav-counts";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const EMPTY_EVENT = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const REVIEWER = userIdSchema.parse("b0000000-0000-4000-8000-000000000003");
const OTHER_REVIEWER = userIdSchema.parse("b0000000-0000-4000-8000-000000000004");

let pg: PGlite;

describe("nav counts", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migration1);
    await pg.exec(migrationReviewOps);

    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
        ($1,'NavConf','nav-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'EmptyConf','empty-nav-conf','America/New_York','2026-10-01T13:00:00Z','2026-10-01T22:00:00Z')`,
      [EVENT, EMPTY_EVENT],
    );
    await pg.query(
      `INSERT INTO users(id,email,name) VALUES ($1,'reviewer@example.com','Reviewer One'),($2,'other@example.com','Reviewer Two')`,
      [REVIEWER, OTHER_REVIEWER],
    );

    // Two accepted speakers: one complete, one missing both bio and headshot.
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html,confirmation_status) VALUES
        ('b0000000-0000-4000-8000-000000000010',$1,'ada@example.com','Ada','Lovelace','<p>Bio.</p>','confirmed'),
        ('b0000000-0000-4000-8000-000000000011',$1,'grace@example.com','Grace','Hopper',NULL,'unconfirmed')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title,submitted_at) VALUES
        ('b0000000-0000-4000-8000-000000000020',$1,101,'accepted','cfp','Accepted talk','2026-08-07T20:00:00Z'),
        ('b0000000-0000-4000-8000-000000000021',$1,102,'accepted','cfp','Second accepted talk','2026-08-07T20:00:00Z'),
        ('b0000000-0000-4000-8000-000000000022',$1,103,'pending','cfp','Pending talk','2026-08-08T20:00:00Z')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES
        ($1,'b0000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000010',true,0),
        ($1,'b0000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000011',true,0)`,
      [EVENT],
    );

    // No `task_assignments` base table exists — `task_assignments_v` fans a
    // contact-targeted task out to every accepted speaker (resolution #14),
    // so this one row produces two overdue assignments (Ada and Grace).
    await pg.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at) VALUES
        ('b0000000-0000-4000-8000-000000000030',$1,'Upload slides','contact','manual','2026-01-01T00:00:00Z')`,
      [EVENT],
    );

    // One open round: REVIEWER has one unfinished assignment, OTHER_REVIEWER
    // has already submitted theirs.
    await pg.query(
      `INSERT INTO evaluation_plans(id,event_id,name,round,status) VALUES ('b0000000-0000-4000-8000-000000000040',$1,'Round 1',1,'open')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO review_assignments(id,event_id,plan_id,submission_id,reviewer_user_id,status) VALUES
        ('b0000000-0000-4000-8000-000000000041',$1,'b0000000-0000-4000-8000-000000000040','b0000000-0000-4000-8000-000000000020',$2,'assigned'),
        ('b0000000-0000-4000-8000-000000000042',$1,'b0000000-0000-4000-8000-000000000040','b0000000-0000-4000-8000-000000000021',$3,'assigned')`,
      [EVENT, REVIEWER, OTHER_REVIEWER],
    );
    await pg.query(
      `INSERT INTO reviews(id,event_id,plan_id,submission_id,reviewer_user_id,overall_score,submitted_at) VALUES
        ('b0000000-0000-4000-8000-000000000043',$1,'b0000000-0000-4000-8000-000000000040','b0000000-0000-4000-8000-000000000021',$2,4,'2026-08-01T00:00:00Z')`,
      [EVENT, OTHER_REVIEWER],
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  it("counts pending abstracts, missing speakers and overdue tasks", async () => {
    const db = drizzle(pg);
    const counts = await getNavCountsIn(db, EVENT);
    expect(counts.abstractsPending).toBe(1);
    // Neither seeded speaker has a headshot, so both count (Grace is missing
    // her bio too, but `speakersMissing` counts people, not instances).
    expect(counts.speakersMissing).toBe(2);
    // One overdue task fans out to both accepted speakers (Ada and Grace).
    expect(counts.tasksOverdue).toBe(2);
  });

  it("returns all zeros for an event with nothing to act on", async () => {
    const db = drizzle(pg);
    const counts = await getNavCountsIn(db, EMPTY_EVENT);
    expect(counts).toEqual({ abstractsPending: 0, speakersMissing: 0, tasksOverdue: 0 });
  });

  it("counts a reviewer's own unfinished, currently-open assignments", async () => {
    const db = drizzle(pg);
    expect(await getReviewerQueueCountIn(db, EVENT, REVIEWER)).toBe(1);
    // OTHER_REVIEWER already submitted their one assignment.
    expect(await getReviewerQueueCountIn(db, EVENT, OTHER_REVIEWER)).toBe(0);
  });
});
