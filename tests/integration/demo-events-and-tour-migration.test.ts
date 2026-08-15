import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const tenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const milestones = readFileSync(new URL("../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
const demoEventsAndTour = readFileSync(new URL("../../drizzle/0044_demo_events_and_tour.sql", import.meta.url), "utf8");

const organizationId = "d4400000-0000-4000-8000-000000000001";
const otherOrganizationId = "d4400000-0000-4000-8000-000000000002";
const legacyEventId = "d4400000-0000-4000-8000-000000000011";
const userId = "d4400000-0000-4000-8000-000000000021";

/**
 * The transition 0044 isolates: `events.is_demo` plus the two tour tables and
 * the widened milestone vocabulary. Everything downstream of First Fair —
 * mail suppression, the plan-slot exemption, the provisioning cursor's
 * compare-and-set, the achievement log — rests on the constraints asserted
 * here, so they are worth pinning independently of the writers that use them.
 *
 * One database, one pre-migration event, and a fresh event per assertion that
 * needs to mutate or delete one: spinning up PGlite per test costs ~7 s each,
 * which is most of the runtime of a suite that is otherwise all constraints.
 */
describe("demo events and tour migration (0044)", () => {
  let database: PGlite;
  let nextEvent = 0;

  async function freshEvent(): Promise<string> {
    nextEvent += 1;
    const id = `d4400000-0000-4000-8000-0000000001${nextEvent.toString().padStart(2, "0")}`;
    await database.query(
      `INSERT INTO events(id,name,slug,organization_id,timezone,starts_at,ends_at)
       VALUES($1,$2,$2,$3,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [id, `conf-${nextEvent}`, organizationId],
    );
    return id;
  }

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(base);
    await database.exec(tenancy);
    await database.exec(milestones);
    await database.query(
      "INSERT INTO organizations(id,name,slug) VALUES($1,'Northline','northline'),($2,'Other Org','other-org')",
      [organizationId, otherOrganizationId],
    );
    await database.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Organizer')", [userId]);
    // Inserted before the migration, so the backfill assertion below is real.
    await database.query(
      `INSERT INTO events(id,name,slug,organization_id,timezone,starts_at,ends_at)
       VALUES($1,'Legacy Conf','legacy-conf',$2,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [legacyEventId, organizationId],
    );
    await database.exec(demoEventsAndTour);
  }, 60_000);

  afterAll(async () => database.close());

  it("backfills every pre-existing event as a real one", async () => {
    const rows = await database.query<{ is_demo: boolean }>("SELECT is_demo FROM events WHERE id=$1", [legacyEventId]);
    expect(rows.rows[0]?.is_demo).toBe(false);
  });

  it("defaults a fresh cursor to phase one of a not-yet-started tour", async () => {
    const eventId = await freshEvent();
    await database.query(
      "INSERT INTO event_demo_tour(event_id,organization_id,user_id) VALUES($1,$2,$3)",
      [eventId, organizationId, userId],
    );
    const rows = await database.query<{
      dataset_version: number; provision_phase: string; tour_state: string; chapter: string; armed_baseline: unknown;
    }>("SELECT dataset_version,provision_phase,tour_state,chapter,armed_baseline FROM event_demo_tour WHERE event_id=$1", [eventId]);
    expect(rows.rows[0]).toMatchObject({
      dataset_version: 1,
      provision_phase: "event",
      tour_state: "not_started",
      chapter: "cold-open",
      armed_baseline: null,
    });
  });

  it("refuses a provisioning phase or tour state outside the vocabulary the runners implement", async () => {
    const eventId = await freshEvent();
    await database.query(
      "INSERT INTO event_demo_tour(event_id,organization_id,user_id) VALUES($1,$2,$3)",
      [eventId, organizationId, userId],
    );
    await expect(database.query("UPDATE event_demo_tour SET provision_phase='sessions' WHERE event_id=$1", [eventId]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(database.query("UPDATE event_demo_tour SET tour_state='abandoned' WHERE event_id=$1", [eventId]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("refuses a cursor that names an event in a different tenant", async () => {
    const eventId = await freshEvent();
    await expect(database.query(
      "INSERT INTO event_demo_tour(event_id,organization_id,user_id) VALUES($1,$2,$3)",
      [eventId, otherOrganizationId, userId],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("takes the cursor and the achievement log with the event, so a reset leaves no tombstone", async () => {
    const eventId = await freshEvent();
    await database.query(
      "INSERT INTO event_demo_tour(event_id,organization_id,user_id) VALUES($1,$2,$3)",
      [eventId, organizationId, userId],
    );
    await database.query(
      "INSERT INTO event_tour_steps(event_id,step_id) VALUES($1,'agenda.resolve-conflict')",
      [eventId],
    );
    await database.query("DELETE FROM events WHERE id=$1", [eventId]);

    const cursors = await database.query<{ n: number }>("SELECT count(*)::int AS n FROM event_demo_tour WHERE event_id=$1", [eventId]);
    const steps = await database.query<{ n: number }>("SELECT count(*)::int AS n FROM event_tour_steps WHERE event_id=$1", [eventId]);
    expect([cursors.rows[0]?.n, steps.rows[0]?.n]).toEqual([0, 0]);
  });

  it("makes recording an objective twice a no-op rather than a conflict", async () => {
    const eventId = await freshEvent();
    await database.query("INSERT INTO event_tour_steps(event_id,step_id) VALUES($1,'forms.publish')", [eventId]);
    await database.query(
      "INSERT INTO event_tour_steps(event_id,step_id,outcome) VALUES($1,'forms.publish','skipped') ON CONFLICT DO NOTHING",
      [eventId],
    );
    const rows = await database.query<{ outcome: string }>("SELECT outcome FROM event_tour_steps WHERE event_id=$1", [eventId]);
    expect(rows.rows.map((row) => row.outcome)).toEqual(["completed"]);
  });

  it("refuses an outcome the finale cannot count", async () => {
    await expect(database.query(
      "INSERT INTO event_tour_steps(event_id,step_id,outcome) VALUES($1,'forms.publish','abandoned')",
      [legacyEventId],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("admits the three First Fair milestones and still refuses an invented one", async () => {
    await database.query(
      `INSERT INTO organization_onboarding_milestones(organization_id,milestone)
       VALUES($1,'demo_provisioned'),($1,'tour_completed'),($1,'real_event_after_demo')`,
      [organizationId],
    );
    const rows = await database.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM organization_onboarding_milestones WHERE organization_id=$1",
      [organizationId],
    );
    expect(rows.rows[0]?.n).toBe(3);

    await expect(database.query(
      "INSERT INTO organization_onboarding_milestones(organization_id,milestone) VALUES($1,'demo_deleted')",
      [organizationId],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
