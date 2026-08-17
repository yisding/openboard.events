import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { detectConflicts, getSchedulableSessionsIn } from "@/features/agenda";
import { listOrganizationOnboardingMilestonesIn } from "@/features/product-signals";
import { eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { tourWorldSchema, WORLD_FACT_KEYS } from "../tour-schemas";
import {
  advanceTourCursorIn,
  armTourStepIn,
  getDemoTourBootstrapIn,
  getTourStateIn,
  getTourWorldIn,
  recordTourStepIn,
} from "./tour";

/**
 * The full journal, applied in order. This suite reads across most of the
 * schema — forms, submissions, reviews, the agenda, the outbox, the portal —
 * because the one query it is here to pin reads across most of the schema.
 * Hand-picking migrations would mean editing this list every time an
 * unrelated table moves.
 */
const migrationRoot = new URL("../../../../drizzle/", import.meta.url);
function productMigrations(): string[] {
  return readdirSync(migrationRoot)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationRoot), "utf8"));
}

const organizationId = organizationIdSchema.parse("f7000000-0000-4000-8000-000000000001");
const demoEventId = eventIdSchema.parse("f7000000-0000-4000-8000-000000000011");
const realEventId = eventIdSchema.parse("f7000000-0000-4000-8000-000000000012");
const organizerId = userIdSchema.parse("f7000000-0000-4000-8000-000000000021");
const coOrganizerId = userIdSchema.parse("f7000000-0000-4000-8000-000000000022");

const id = (suffix: string) => `f7000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

let pglite: PGlite;
let database: DbOrTx;

/** Counts the statements a reader issues, so "one query per poll" is a test, not a claim. */
function statementCounter(): { db: DbOrTx; count: () => number } {
  let count = 0;
  const counting = {
    execute: (query: unknown) => {
      count += 1;
      return (database as unknown as { execute: (statement: unknown) => unknown }).execute(query);
    },
  };
  return { db: counting as unknown as DbOrTx, count: () => count };
}

async function resetCursor(overrides: { phase?: string; state?: string; step?: string; chapter?: string } = {}) {
  await pglite.query("DELETE FROM event_tour_steps WHERE event_id = $1", [demoEventId]);
  await pglite.query("DELETE FROM event_demo_tour WHERE event_id = $1", [demoEventId]);
  await pglite.query(
    `INSERT INTO event_demo_tour(event_id, organization_id, user_id, provision_phase, tour_state, chapter, step_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      demoEventId,
      organizationId,
      organizerId,
      overrides.phase ?? "ready",
      overrides.state ?? "not_started",
      overrides.chapter ?? "cold-open",
      overrides.step ?? "coldopen.hello",
    ],
  );
  await pglite.query(
    "DELETE FROM organization_onboarding_milestones WHERE organization_id = $1",
    [organizationId],
  );
}

describe("First Fair — guided tour server state", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    for (const migration of productMigrations()) await pglite.exec(migration);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Northline','northline')", [organizationId]);
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Organizer'),($2,'co@example.com','Co-organizer')",
      [organizerId, coOrganizerId],
    );
    for (const [eventId, name, slug, isDemo] of [
      [demoEventId, "AI Engineer World’s Fair 2026", "ai-engineer-worlds-fair-demo-f7000000", true],
      [realEventId, "Northline Summit", "northline-summit", false],
    ] as const) {
      await pglite.query(
        `INSERT INTO events(id,name,slug,organization_id,timezone,starts_at,ends_at,is_demo)
         VALUES($1,$2,$3,$4,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z',$5)`,
        [eventId, name, slug, organizationId, isDemo],
      );
    }
  }, 180_000);

  afterAll(async () => pglite.close());

  beforeEach(async () => resetCursor());

  describe("the world snapshot", () => {
    beforeAll(async () => {
      const formId = id("101");
      const sectionId = id("102");
      await pglite.query(
        "INSERT INTO forms(id,event_id,context,internal_name) VALUES($1,$2,'cfp','Speak at AI Engineer World''s Fair')",
        [formId, demoEventId],
      );
      await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')", [sectionId, demoEventId, formId]);
      // Three live fields and one soft-deleted one: a builder delete must not
      // read as "the organizer added a question".
      for (const [index, key] of ["title", "abstract", "format", "retired"].entries()) {
        await pglite.query(
          `INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,deleted_at)
           VALUES($1,$2,$3,$4,$5,$5,'text',$6)`,
          [id(`11${index}`), demoEventId, formId, sectionId, key, key === "retired" ? new Date().toISOString() : null],
        );
      }
      for (const version of [1, 2]) {
        await pglite.query(
          "INSERT INTO form_versions(id,event_id,form_id,version,snapshot) VALUES($1,$2,$3,$4,'{}'::jsonb)",
          [id(`12${version}`), demoEventId, formId, version],
        );
      }

      const contactIds = [id("131"), id("132")];
      for (const [index, contactId] of contactIds.entries()) {
        await pglite.query(
          "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Dana','Whitfield')",
          [contactId, demoEventId, `speaker-${index}@northline.demo.invalid`],
        );
      }

      const submissionIds = [id("141"), id("142"), id("143")];
      for (const [index, submissionId] of submissionIds.entries()) {
        await pglite.query(
          "INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,$3,$4,'cfp',$5)",
          [submissionId, demoEventId, index + 1, ["pending", "pending", "accepted"][index], `Proposal ${index}`],
        );
      }

      const planId = id("151");
      await pglite.query("INSERT INTO evaluation_plans(id,event_id,name) VALUES($1,$2,'First pass')", [planId, demoEventId]);
      // One submitted review by the organizer, one they have only started, and
      // one somebody else submitted: only the first is theirs and finished.
      await pglite.query(
        `INSERT INTO reviews(id,event_id,plan_id,submission_id,reviewer_user_id,submitted_at) VALUES
         ($1,$4,$5,$6,$8,now()),($2,$4,$5,$7,$8,NULL),($3,$4,$5,$6,$9,now())`,
        [id("152"), id("153"), id("154"), demoEventId, planId, submissionIds[0], submissionIds[1], organizerId, coOrganizerId],
      );

      const roomA = id("161");
      const roomB = id("162");
      const roomC = id("163");
      const trackId = id("164");
      await pglite.query(
        "INSERT INTO rooms(id,event_id,name) VALUES($1,$4,'Main Stage'),($2,$4,'Embarcadero'),($3,$4,'Expo Stage')",
        [roomA, roomB, roomC, demoEventId],
      );
      await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'Agents')", [trackId, demoEventId]);
      const sessions: Array<[string, string, string | null, string | null, string | null, string | null, string]> = [
        // Two talks that both want the Main Stage at 10:15 — one room conflict.
        [id("171"), "Context Engineering", "2026-09-15T17:15:00Z", "2026-09-15T17:45:00Z", roomA, null, "draft"],
        [id("172"), "Evals as a Product Requirement", "2026-09-15T17:15:00Z", "2026-09-15T18:00:00Z", roomA, null, "draft"],
        // Back-to-back in the same room: must never flag.
        [id("173"), "Voice Agents Under 300ms", "2026-09-15T18:00:00Z", "2026-09-15T18:30:00Z", roomA, null, "published"],
        // One speaker in two rooms at 14:00, both on one track — a speaker
        // conflict and a track conflict, from the same pair.
        [id("174"), "Retrieval, Honestly", "2026-09-15T21:00:00Z", "2026-09-15T21:30:00Z", roomB, trackId, "draft"],
        [id("175"), "Agent Frameworks Are Obsolete", "2026-09-15T21:00:00Z", "2026-09-15T21:45:00Z", roomC, trackId, "draft"],
        // In the tray: unscheduled, so it is not a session that can collide.
        [id("176"), "Unplaced Keynote", null, null, null, null, "draft"],
      ];
      for (const [sessionId, title, startsAt, endsAt, roomId, track, status] of sessions) {
        await pglite.query(
          "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,room_id,track_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [sessionId, demoEventId, title, sessionId, startsAt, endsAt, roomId, track, status],
        );
      }
      for (const sessionId of [id("174"), id("175")]) {
        await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)", [demoEventId, sessionId, contactIds[0]]);
      }

      await pglite.query(
        `INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status) VALUES
         ($1,$5,$6,'submission_accepted','demo:a','skipped'),
         ($2,$5,$6,'submission_declined','demo:b','sent'),
         ($3,$5,$6,'submission_accepted','demo:c','queued'),
         ($4,$5,$6,'task_reminder','demo:d','skipped')`,
        [id("181"), id("182"), id("183"), id("184"), demoEventId, contactIds[0]],
      );

      await pglite.query(
        "INSERT INTO embeds(id,event_id,name,content_type,enabled) VALUES($1,$2,'Schedule','agenda',false)",
        [id("191"), demoEventId],
      );
      await pglite.query(
        "INSERT INTO email_templates(id,event_id,key,subject,body_html,updated_at) VALUES($1,$2,'submission_accepted','You are in','<p>Hi</p>','2026-01-02T03:04:05Z')",
        [id("201"), demoEventId],
      );

      const taskId = id("211");
      await pglite.query("INSERT INTO portal_tasks(id,event_id,name) VALUES($1,$2,'Send a headshot')", [taskId, demoEventId]);
      await pglite.query(
        "INSERT INTO task_completions(id,event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
        [id("212"), demoEventId, taskId, contactIds[1]],
      );

      await pglite.query(
        `INSERT INTO resource_pages(id,event_id,title,slug,published) VALUES
         ($1,$3,'Speaker handbook','handbook',true),($2,$3,'Recording release','release',false)`,
        [id("221"), id("222"), demoEventId],
      );
    }, 60_000);

    it("counts every fact the tour arms against, in one statement", async () => {
      const counter = statementCounter();
      const { contactsUpdatedAt, ...world } = await getTourWorldIn(counter.db, demoEventId, organizerId);
      expect(counter.count()).toBe(1);
      expect(contactsUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(world).toEqual({
        formFields: 3,
        formVersions: 2,
        submissionsTotal: 3,
        pendingCount: 2,
        acceptedCount: 1,
        reviewsByMe: 1,
        decisionEmailsQueued: 3,
        sessionsScheduled: 5,
        conflictCount: 3,
        publishedSessions: 1,
        embedEnabled: false,
        templateUpdatedAt: "2026-01-02T03:04:05.000Z",
        portalTaskCompletions: 1,
        resourcePagesPublished: 1,
      });
    });

    it("agrees with the agenda's own conflict engine, back-to-back pair included", async () => {
      const world = await getTourWorldIn(database, demoEventId, organizerId);
      const conflicts = detectConflicts(await getSchedulableSessionsIn(database, demoEventId));
      expect(world.conflictCount).toBe(conflicts.length);
      expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(["room", "speaker", "track"]);
    });

    it("keeps one organizer's reviews out of another's objective", async () => {
      const mine = await getTourWorldIn(database, demoEventId, organizerId);
      const theirs = await getTourWorldIn(database, demoEventId, coOrganizerId);
      expect(mine.reviewsByMe).toBe(1);
      expect(theirs.reviewsByMe).toBe(1);
    });

    it("reads the whole tour state, achievement log included, in one statement", async () => {
      await recordTourStepIn(database, organizerId, demoEventId, { stepId: "forms.publish", outcome: "completed" });
      await recordTourStepIn(database, organizerId, demoEventId, { stepId: "quest.outbox", outcome: "completed" });
      await recordTourStepIn(database, organizerId, demoEventId, { stepId: "agenda.auto-place", outcome: "skipped" });
      const counter = statementCounter();
      const state = await getTourStateIn(counter.db, demoEventId, organizerId);
      expect(counter.count()).toBe(1);
      expect(state?.completed).toEqual(["forms.publish"]);
      expect(state?.questsDone).toEqual(["quest.outbox"]);
      expect(state?.skipped).toEqual(["agenda.auto-place"]);
      expect(state?.world.conflictCount).toBe(3);
    });
  });

  describe("scope", () => {
    it("has no tour for a real event, which is how the shell knows", async () => {
      await expect(getTourStateIn(database, realEventId, organizerId)).resolves.toBeNull();
      await expect(getDemoTourBootstrapIn(database, realEventId, organizerId)).resolves.toBeNull();
    });

    it("hands the layout the ids and names the script's copy interpolates", async () => {
      const bootstrap = await getDemoTourBootstrapIn(database, demoEventId, organizerId);
      expect(bootstrap?.context.eventName).toBe("AI Engineer World’s Fair 2026");
      expect(bootstrap?.context.eventSlug).toContain("-demo-");
      expect(bootstrap?.context.organizationId).toBe(organizationId);
      expect(bootstrap?.context.cfpFormId).toBe(id("101"));
      expect(bootstrap?.provisionReady).toBe(true);
    });

    /**
     * Chapter 2 asks the organizer to add a question, and the builder refuses
     * a structural edit to any form somebody has already answered. The
     * bootstrap therefore nominates a form that is still editable, and it must
     * stop nominating this one the moment a real proposal lands on it —
     * otherwise the step routes to a screen whose control is locked and the
     * card waits forever.
     */
    it("nominates a form the builder would still let an organizer restructure", async () => {
      const bootstrapBefore = await getDemoTourBootstrapIn(database, demoEventId, organizerId);
      expect(bootstrapBefore?.context.editableFormId).toBe(id("101"));

      await pglite.query(
        `INSERT INTO submissions(id,event_id,form_id,code,status,source,title)
         VALUES($1,$2,$3,9001,'pending','cfp','A proposal somebody already sent')`,
        [id("901"), demoEventId, id("101")],
      );
      const bootstrapAfter = await getDemoTourBootstrapIn(database, demoEventId, organizerId);
      expect(bootstrapAfter?.context.cfpFormId).toBe(id("101"));
      expect(bootstrapAfter?.context.editableFormId).toBeNull();
      await pglite.query("DELETE FROM submissions WHERE id = $1", [id("901")]);
    });

    it("says the world is still being built while a phase is outstanding", async () => {
      await resetCursor({ phase: "agenda" });
      const bootstrap = await getDemoTourBootstrapIn(database, demoEventId, organizerId);
      expect(bootstrap?.provisionPhase).toBe("agenda");
      expect(bootstrap?.provisionReady).toBe(false);
    });
  });

  describe("cursor compare-and-set", () => {
    const advance = (expectedStepId: string, stepId: string, chapter = "command-deck") =>
      advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId,
        chapter,
        stepId,
        status: "active",
      });

    it("moves the cursor and starts the clock", async () => {
      const state = await advance("coldopen.hello", "dashboard.attention");
      expect(state.stepId).toBe("dashboard.attention");
      expect(state.status).toBe("active");
      const [row] = (await pglite.query<{ started_at: Date | null }>(
        "SELECT started_at FROM event_demo_tour WHERE event_id = $1",
        [demoEventId],
      )).rows;
      expect(row?.started_at).not.toBeNull();
    });

    it("lets exactly one of two advances from the same step win", async () => {
      await advance("coldopen.hello", "dashboard.attention");
      await expect(advance("coldopen.hello", "dashboard.palette")).rejects.toMatchObject({ code: "CONFLICT" });
      const state = await getTourStateIn(database, demoEventId, organizerId);
      expect(state?.stepId).toBe("dashboard.attention");
    });

    it("treats a redelivered advance as the success it already was", async () => {
      await advance("coldopen.hello", "dashboard.attention");
      const replayed = await advance("coldopen.hello", "dashboard.attention");
      expect(replayed.stepId).toBe("dashboard.attention");
    });

    it("refuses to start the tour while the world is still being built", async () => {
      await resetCursor({ phase: "portal" });
      await expect(advance("coldopen.hello", "dashboard.attention")).rejects.toMatchObject({ code: "CONFLICT" });
      // Pausing out of an unfinished provision is still allowed: the escape
      // hatch must never depend on the thing that failed.
      const paused = await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "cold-open",
        stepId: "coldopen.hello",
        status: "paused",
      });
      expect(paused.status).toBe("paused");
    });

    it("records the completion milestone once, and clears it on a restart", async () => {
      await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "curtain",
        stepId: "curtain.done",
        status: "complete",
      });
      const milestones = await listOrganizationOnboardingMilestonesIn(database, organizationId);
      expect(milestones.map((milestone) => milestone.milestone)).toContain("tour_completed");

      const restarted = await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "curtain.done",
        chapter: "cold-open",
        stepId: "coldopen.hello",
        status: "active",
      });
      expect(restarted.status).toBe("active");
      const [row] = (await pglite.query<{ completed_at: Date | null }>(
        "SELECT completed_at FROM event_demo_tour WHERE event_id = $1",
        [demoEventId],
      )).rows;
      expect(row?.completed_at).toBeNull();
    });

    it("refuses a cursor write for an event with no tour", async () => {
      await expect(advanceTourCursorIn(database, organizerId, realEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "cold-open",
        stepId: "dashboard.attention",
        status: "active",
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("the armed baseline", () => {
    it("is captured once and survives a reload that re-arms the same step", async () => {
      await armTourStepIn(database, organizerId, demoEventId, "agenda.resolve-conflict", { conflictCount: 3 });
      // The reload: the client re-arms, and the world has already moved on
      // because the player fixed the conflict before the page came back.
      const rearmed = await armTourStepIn(database, organizerId, demoEventId, "agenda.resolve-conflict", { conflictCount: 2 });
      expect(rearmed.armedBaseline).toEqual({ conflictCount: 3 });
      const state = await getTourStateIn(database, demoEventId, organizerId);
      expect(state?.armedStepId).toBe("agenda.resolve-conflict");
      expect(state?.armedBaseline).toEqual({ conflictCount: 3 });
    });

    it("re-baselines when a different step arms", async () => {
      await armTourStepIn(database, organizerId, demoEventId, "agenda.resolve-conflict", { conflictCount: 3 });
      const next = await armTourStepIn(database, organizerId, demoEventId, "agenda.publish", { publishedSessions: 1 });
      expect(next.armedBaseline).toEqual({ publishedSessions: 1 });
    });

    it("arms in the same write that moves the cursor", async () => {
      const state = await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "agenda",
        stepId: "agenda.resolve-conflict",
        status: "active",
        armedStepId: "agenda.resolve-conflict",
        armedBaseline: { conflictCount: 3 },
      });
      expect(state.armedStepId).toBe("agenda.resolve-conflict");
      expect(state.armedBaseline).toEqual({ conflictCount: 3 });
    });

    it("keeps the arm across a pause on the same step, and releases it on the next one", async () => {
      await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "agenda",
        stepId: "agenda.resolve-conflict",
        status: "active",
        armedStepId: "agenda.resolve-conflict",
        armedBaseline: { conflictCount: 3 },
      });
      const paused = await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "agenda.resolve-conflict",
        chapter: "agenda",
        stepId: "agenda.resolve-conflict",
        status: "paused",
      });
      expect(paused.armedBaseline).toEqual({ conflictCount: 3 });

      const moved = await advanceTourCursorIn(database, organizerId, demoEventId, {
        expectedStepId: "agenda.resolve-conflict",
        chapter: "agenda",
        stepId: "agenda.auto-place",
        status: "active",
      });
      expect(moved.armedStepId).toBeNull();
      expect(moved.armedBaseline).toBeNull();
    });

    it("drops a fact the current build no longer knows rather than failing a poll", async () => {
      await pglite.query(
        "UPDATE event_demo_tour SET armed_step_id = $2, armed_baseline = $3::jsonb WHERE event_id = $1",
        [demoEventId, "agenda.resolve-conflict", JSON.stringify({ conflictCount: 3, retiredFact: 9 })],
      );
      const state = await getTourStateIn(database, demoEventId, organizerId);
      expect(state?.armedBaseline).toEqual({ conflictCount: 3 });
    });
  });

  describe("the achievement log", () => {
    it("records a step once, and calls the duplicate a success", async () => {
      await expect(recordTourStepIn(database, organizerId, demoEventId, { stepId: "forms.publish", outcome: "completed" }))
        .resolves.toEqual({ recorded: true });
      await expect(recordTourStepIn(database, organizerId, demoEventId, { stepId: "forms.publish", outcome: "completed" }))
        .resolves.toEqual({ recorded: false });
      const [row] = (await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM event_tour_steps WHERE event_id = $1 AND step_id = 'forms.publish'",
        [demoEventId],
      )).rows;
      expect(row?.n).toBe(1);
    });

    it("never appends to an event that has no tour", async () => {
      await expect(recordTourStepIn(database, organizerId, realEventId, { stepId: "forms.publish", outcome: "completed" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("keeps a skipped objective out of the completed list", async () => {
      await recordTourStepIn(database, organizerId, demoEventId, { stepId: "judgement.score", outcome: "skipped" });
      const state = await getTourStateIn(database, demoEventId, organizerId);
      expect(state?.completed).not.toContain("judgement.score");
      expect(state?.skipped).toContain("judgement.score");
    });
  });

  /**
   * `event_demo_tour` holds one cursor and one armed baseline per *event*,
   * while `reviewsByMe` — the fact Chapter 4's scoring step arms on — is
   * counted per caller. A second organizer driving the first one's row would
   * be handed a baseline from work they did not do: their objective could
   * never fire, or the first organizer's step would auto-complete on their
   * behalf. So the demo context is shared and the cursor is not.
   */
  describe("a co-organizer of the same demo event", () => {
    it("sees the demo but never drives somebody else's cursor", async () => {
      const owner = await getDemoTourBootstrapIn(database, demoEventId, organizerId);
      const other = await getDemoTourBootstrapIn(database, demoEventId, coOrganizerId);

      // Both get the demo context — the ribbon, the badge, the palette.
      expect(owner?.isTourOwner).toBe(true);
      expect(other?.isTourOwner).toBe(false);
      expect(other?.context.eventSlug).toBe(owner?.context.eventSlug);

      // Only the owner may move it, arm it, or write to its log.
      await expect(advanceTourCursorIn(database, coOrganizerId, demoEventId, {
        expectedStepId: "coldopen.hello",
        chapter: "command-deck",
        stepId: "deck.attention",
        status: "active",
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(armTourStepIn(database, coOrganizerId, demoEventId, "judge.score", { reviewsByMe: 0 }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(recordTourStepIn(database, coOrganizerId, demoEventId, { stepId: "judge.score", outcome: "completed" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });

      const untouched = await getTourStateIn(database, demoEventId, organizerId);
      expect(untouched?.stepId).toBe("coldopen.hello");
      expect(untouched?.armedStepId).toBe(null);
      expect(untouched?.completed).toEqual([]);
    });
  });

  it("names every world fact in WORLD_FACT_KEYS", () => {
    expect([...WORLD_FACT_KEYS].sort()).toEqual(Object.keys(tourWorldSchema.shape).sort());
  });

  it("raises typed application errors, never bare ones", async () => {
    const failure = await advanceTourCursorIn(database, organizerId, demoEventId, {
      expectedStepId: "nowhere.at-all",
      chapter: "cold-open",
      stepId: "dashboard.attention",
      status: "active",
    }).catch((error: unknown) => error);
    expect(isAppError(failure)).toBe(true);
  });
});
