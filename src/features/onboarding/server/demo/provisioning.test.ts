import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createOrganizationIn } from "@/features/organizations";
import { organizationIdSchema, userIdSchema, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../../scripts/lib/product-migrations";
import { getActiveOrganizationOnboardingForUserIn } from "../progress";
import { DEMO_RUNNABLE_PHASES, type DemoRunnablePhase } from "../../demo-schemas";
import { FORMS, SPEAKERS, SUBMISSIONS, TRACKS } from "./dataset";
import { demoEventId, demoSlug } from "./ids";
import { unavailableTourChapters } from "../../tour/script";
import { getDemoTourBootstrapIn } from "../tour";
import { advanceDemoProvisioningIn, getDemoProvisionStateIn, resetDemoIn, skipDemoProvisioningIn } from "./provisioning";

/**
 * First Fair — the provisioning orchestrator, against a real database.
 *
 * Four properties are tested here because all four are the difference between
 * "a demo world appears" and "a demo world appears exactly once, however the
 * network behaves":
 *
 * 1. **Every phase is idempotent.** Parameterised over all ten phases, so a
 *    phase added later cannot quietly skip the check.
 * 2. **A half-finished phase heals on replay** rather than needing a rollback
 *    across the whole world — the same insert-then-heal discipline
 *    `createEventIn` already documents.
 * 3. **Two concurrent advances produce one advance.** A double-clicked button
 *    is a replay, not a second conference.
 * 4. **No `event_onboarding_progress` row is ever written.** This is the single
 *    most important assertion in the suite: a demo checkpoint would redirect
 *    the organizer back into the setup wizard forever.
 */

const TENANT_TABLES = [
  "tracks", "rooms", "session_formats", "tags", "email_templates",
  "contacts", "forms", "form_sections", "form_fields", "form_versions",
  "routing_rules", "submissions", "submission_participants", "submission_answers",
  "submission_tags", "event_members",
] as const;

describe("demo provisioning", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let ownerUserId: UserId;

  /**
   * The suite's own connection stands in for `withTx`. `withTx` builds a Neon
   * WebSocket pool out of `DATABASE_URL`, which no test database can answer —
   * which is exactly why the runner is an argument rather than an import.
   */
  const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);

  async function countsFor(eventId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of TENANT_TABLES) {
      const result = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE event_id = $1`,
        [eventId],
      );
      counts[table] = result.rows[0]?.n ?? 0;
    }
    const events = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM events WHERE id = $1", [eventId]);
    counts.events = events.rows[0]?.n ?? 0;
    return counts;
  }

  async function newOrganization(slug: string): Promise<OrganizationId> {
    const organization = await createOrganizationIn(database, ownerUserId, { name: slug, slug });
    return organizationIdSchema.parse(organization.id);
  }

  async function parkCursorAt(eventId: string, phase: DemoRunnablePhase): Promise<void> {
    await pglite.query("UPDATE event_demo_tour SET provision_phase = $2 WHERE event_id = $1", [eventId, phase]);
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["first-fair-owner@test.dev", "First Fair Owner"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  describe("the world it builds", () => {
    let organizationId: OrganizationId;
    let eventId: EventId;

    beforeAll(async () => {
      organizationId = await newOrganization("first-fair-world");
      eventId = demoEventId(organizationId);
      for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }
    }, 180_000);

    it("reaches `ready` after exactly ten requests and reports itself done", async () => {
      const state = await getDemoProvisionStateIn(database, organizationId);
      expect(state).toMatchObject({ phase: "ready", done: true, phaseCount: 10, eventId });
      expect(state?.eventSlug).toBe(demoSlug(eventId));
    });

    it("flags the event as a demo inside the INSERT, and gives it a per-tenant slug", async () => {
      const row = await pglite.query<{ is_demo: boolean; slug: string; organization_id: string; timezone: string }>(
        "SELECT is_demo, slug, organization_id, timezone FROM events WHERE id = $1",
        [eventId],
      );
      expect(row.rows[0]?.is_demo).toBe(true);
      expect(row.rows[0]?.organization_id).toBe(organizationId);
      expect(row.rows[0]?.slug).toContain("-demo-");
      expect(row.rows[0]?.timezone).toBe("America/Los_Angeles");
    });

    it("names the event for the year its own dates land in, not a hard-coded one", async () => {
      const row = await pglite.query<{ name: string; starts_at: Date }>(
        "SELECT name, starts_at FROM events WHERE id = $1",
        [eventId],
      );
      const startsAt = new Date(String(row.rows[0]?.starts_at));
      expect(startsAt.getTime()).toBeGreaterThan(Date.now());
      expect(row.rows[0]?.name).toMatch(/^AI Engineer World’s Fair \d{4}$/);
    });

    it("upserts the demo's formats over the platform defaults instead of duplicating them by name", async () => {
      const formats = await pglite.query<{ name: string; default_duration_mins: number }>(
        "SELECT name, default_duration_mins FROM session_formats WHERE event_id = $1 ORDER BY sort_order",
        [eventId],
      );
      // Seven, not eleven: `Keynote`, `Talk`, `Workshop` and `Panel` already
      // existed from `seedEventDefaultsIn` and were updated in place rather
      // than duplicated. The fifth default, `Break`, has no demo counterpart
      // and survives untouched — deleting a format an organizer may well want
      // on their agenda would be a worse trade than one extra row.
      expect(formats.rows.map((row) => row.name)).toEqual([
        "Keynote", "Talk", "Workshop", "Panel", "Break", "Lightning Talk", "The Great AI Debate",
      ]);
      // The real AI Engineer World’s Fair signature slot, not the platform's
      // rounder default.
      expect(formats.rows.find((row) => row.name === "Talk")?.default_duration_mins).toBe(18);
    });

    it("builds eighteen unroutable speakers, no users and no headshots", async () => {
      const contacts = await pglite.query<{ email: string; headshot_file_id: string | null }>(
        "SELECT email, headshot_file_id FROM contacts WHERE event_id = $1",
        [eventId],
      );
      expect(contacts.rows).toHaveLength(SPEAKERS.length);
      expect(contacts.rows.every((row) => row.email.endsWith(".demo.invalid"))).toBe(true);
      expect(contacts.rows.every((row) => row.headshot_file_id === null)).toBe(true);

      const synthetic = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE '%.demo.invalid'",
      );
      expect(synthetic.rows[0]?.n).toBe(0);
    });

    it("publishes both forms at version two, so the organizer's own publish is version three", async () => {
      const forms = await pglite.query<{ id: string; current_version: number; status: string }>(
        "SELECT id, current_version, status FROM forms WHERE event_id = $1 ORDER BY internal_name",
        [eventId],
      );
      expect(forms.rows).toHaveLength(FORMS.length);
      expect(forms.rows.every((row) => row.current_version === 2)).toBe(true);
      expect(forms.rows.map((row) => row.status).sort()).toEqual(["closed", "open"]);

      const versions = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM form_versions WHERE event_id = $1",
        [eventId],
      );
      expect(versions.rows[0]?.n).toBe(FORMS.length * 2);
    });

    it("asks exactly the questions the dataset describes, conditional one included", async () => {
      const fields = await pglite.query<{ key: string; visibility: unknown; review_visibility: string }>(
        `SELECT f.key, f.visibility, f.review_visibility
           FROM form_fields f JOIN forms ON forms.id = f.form_id
          WHERE f.event_id = $1 AND forms.internal_name = $2 AND f.deleted_at IS NULL`,
        [eventId, "Speak at AI Engineer World’s Fair"],
      );
      const cfp = FORMS.find((form) => form.key === "cfp");
      expect(fields.rows.map((row) => row.key).sort()).toEqual([...(cfp?.fields ?? [])].map((field) => field.key).sort());

      const workshop = fields.rows.find((row) => row.key === "workshop_duration");
      expect(workshop?.visibility).toMatchObject({ match: "all" });
      // The blind-review pair: one question opted into proposal content, one
      // left at the fail-closed default.
      expect(fields.rows.find((row) => row.key === "approach")?.review_visibility).toBe("content");
      expect(fields.rows.find((row) => row.key === "company")?.review_visibility).toBe("identity");
    });

    it("routes Security-track proposals without an organizer clicking anything", async () => {
      const rules = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM routing_rules WHERE event_id = $1 AND enabled",
        [eventId],
      );
      expect(rules.rows[0]?.n).toBe(1);
    });

    it("collects twenty-four proposals across every status, backdated over five weeks", async () => {
      const rows = await pglite.query<{ status: string; created_at: Date; submitted_at: Date | null }>(
        "SELECT status, created_at, submitted_at FROM submissions WHERE event_id = $1",
        [eventId],
      );
      expect(rows.rows).toHaveLength(SUBMISSIONS.length);
      expect(new Set(rows.rows.map((row) => row.status)).size).toBe(7);
      expect(rows.rows.filter((row) => row.status === "draft")).toHaveLength(2);
      // A draft was never sent, so it must not carry a submitted_at that every
      // downstream sort trusts.
      expect(rows.rows.every((row) => (row.status === "draft") === (row.submitted_at === null))).toBe(true);

      const authored = rows.rows.map((row) => new Date(String(row.created_at)).getTime());
      expect(Math.max(...authored)).toBeLessThan(Date.now());
      // Five weeks of arrivals, not twenty-four rows in one second.
      expect(Math.max(...authored) - Math.min(...authored)).toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
    });

    it("pins every proposal's answers to the snapshot the speaker saw", async () => {
      const answers = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM submission_answers WHERE event_id = $1",
        [eventId],
      );
      expect(answers.rows[0]?.n).toBeGreaterThan(SUBMISSIONS.length * 3);
      const versions = await pglite.query<{ form_version: number | null }>(
        "SELECT DISTINCT form_version FROM submissions WHERE event_id = $1",
        [eventId],
      );
      expect(versions.rows.map((row) => row.form_version)).toEqual([2]);
    });

    it("never writes a setup checkpoint, so the organizer is never dragged back into the wizard", async () => {
      const progress = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM event_onboarding_progress WHERE event_id = $1",
        [eventId],
      );
      expect(progress.rows[0]?.n).toBe(0);
      await expect(getActiveOrganizationOnboardingForUserIn(database, organizationId, ownerUserId)).resolves.toBeNull();
    });

    it("records the demo milestone and not the conversion one, and leaves the usage counter alone", async () => {
      const milestones = await pglite.query<{ milestone: string }>(
        "SELECT milestone FROM organization_onboarding_milestones WHERE organization_id = $1",
        [organizationId],
      );
      const recorded = milestones.rows.map((row) => row.milestone);
      expect(recorded).toContain("demo_provisioned");
      expect(recorded).not.toContain("event_created");

      const usage = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM organization_usage_counters WHERE organization_id = $1 AND metric = 'events'",
        [organizationId],
      );
      expect(usage.rows[0]?.n).toBe(0);
    });

    it("leaves an audit trail an owner can read", async () => {
      const audit = await pglite.query<{ action: string }>(
        "SELECT action FROM organization_audit_log WHERE organization_id = $1",
        [organizationId],
      );
      expect(audit.rows.map((row) => row.action)).toContain("demo.provisioned");
    });

    it("writes no queued outbox row while building the world", async () => {
      const queued = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND status = 'queued'",
        [eventId],
      );
      expect(queued.rows[0]?.n).toBe(0);
    });
  });

  describe("replay safety", () => {
    let organizationId: OrganizationId;
    let eventId: EventId;

    beforeAll(async () => {
      organizationId = await newOrganization("first-fair-replay");
      eventId = demoEventId(organizationId);
    }, 60_000);

    /**
     * Every phase, run twice, with the cursor wound back in between. The loop
     * is generated from `DEMO_RUNNABLE_PHASES` rather than written out so a
     * phase added later is covered the moment it is registered.
     */
    it.each(DEMO_RUNNABLE_PHASES.map((phase, index) => [index, phase] as const))(
      "runs phase %i (%s) twice and lands on identical row counts",
      async (_index, phase) => {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
        const afterFirst = await countsFor(eventId);

        await parkCursorAt(eventId, phase);
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
        const afterSecond = await countsFor(eventId);

        expect(afterSecond).toEqual(afterFirst);
      },
      120_000,
    );

    it("finishes the run in `ready` after the replays", async () => {
      await expect(getDemoProvisionStateIn(database, organizationId)).resolves.toMatchObject({ phase: "ready" });
    });
  });

  describe("a phase that stopped half-way", () => {
    it("heals on replay instead of needing a rollback across the whole world", async () => {
      const organizationId = await newOrganization("first-fair-heal");
      const eventId = demoEventId(organizationId);
      for (let step = 0; step < 3; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }
      const whole = await countsFor(eventId);

      // Simulate an abort part-way through people and forms: five speakers and
      // one entire form never landed.
      await pglite.query(
        "DELETE FROM contacts WHERE id IN (SELECT id FROM contacts WHERE event_id = $1 ORDER BY email LIMIT 5)",
        [eventId],
      );
      await pglite.query(
        "DELETE FROM forms WHERE event_id = $1 AND internal_name = $2",
        [eventId, "Expo Stage Lightning Talks"],
      );

      await pglite.query("UPDATE event_demo_tour SET provision_phase = 'people' WHERE event_id = $1", [eventId]);
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });

      expect(await countsFor(eventId)).toEqual(whole);
    }, 120_000);
  });

  describe("two requests racing each other", () => {
    it("advances the cursor once, and both callers are told where it actually is", async () => {
      const organizationId = await newOrganization("first-fair-race");
      const eventId = demoEventId(organizationId);
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      const before = await getDemoProvisionStateIn(database, organizationId);

      const [first, second] = await Promise.all([
        advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction }),
        advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction }),
      ]);

      expect(first.phase).toBe(second.phase);
      const after = await getDemoProvisionStateIn(database, organizationId);
      expect(after?.phase).toBe(first.phase);
      // Exactly one step, not two: the loser's UPDATE matched no row.
      expect((after?.phaseIndex ?? 0) - (before?.phaseIndex ?? 0)).toBe(1);

      const contacts = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id = $1",
        [eventId],
      );
      expect(contacts.rows[0]?.n).toBe(SPEAKERS.length);
    }, 60_000);
  });

  describe("the frozen clock", () => {
    it("keeps every later phase on the instant the first one ran, not on its own", async () => {
      const organizationId = await newOrganization("first-fair-clock");
      const eventId = demoEventId(organizationId);
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });

      // Wind the cursor's created_at back a fortnight. Every phase from here
      // authors against *that* instant, which is what stops a resumed provision
      // from disagreeing with the event window it already wrote.
      //
      // The event window moves with it, because phase 1 has already committed
      // one computed from the live clock and the scenario being simulated is
      // "this provision started a fortnight ago", not "somebody edited the
      // cursor". Leaving the window where it is simulates nothing real and
      // makes the agenda phase place sessions two months outside their own
      // event — which `saveSessionIn` rightly refuses, and which would have
      // this test reporting a bounds violation instead of a clock one.
      await pglite.query(
        "UPDATE event_demo_tour SET created_at = now() - interval '14 days' WHERE event_id = $1",
        [eventId],
      );
      await pglite.query(
        `UPDATE events SET starts_at = starts_at - interval '14 days',
                           ends_at = ends_at - interval '14 days'
          WHERE id = $1`,
        [eventId],
      );
      for (let step = 1; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }

      const form = await pglite.query<{ closes_at: Date }>(
        "SELECT closes_at FROM forms WHERE event_id = $1 AND internal_name = $2",
        [eventId, "Speak at AI Engineer World’s Fair"],
      );
      const closesAt = new Date(String(form.rows[0]?.closes_at));
      // +12 days from a `now` that is itself 14 days in the past.
      expect(closesAt.getTime()).toBeLessThan(Date.now());
    }, 180_000);

    it("recovers the clock from the committed event when phase 1 replays days later", async () => {
      const organizationId = await newOrganization("first-fair-clock-replay");
      const eventId = demoEventId(organizationId);
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });

      // The failure this guards: phase 1's event INSERT commits, everything
      // after it in that request dies, and no cursor is ever written. Deleting
      // the cursor and winding the committed window back reproduces exactly
      // that — an orphaned event authored two days before the retry arrives.
      await pglite.query("DELETE FROM event_demo_tour WHERE event_id = $1", [eventId]);
      await pglite.query(
        `UPDATE events SET starts_at = starts_at - interval '2 days',
                           ends_at = ends_at - interval '2 days'
          WHERE id = $1`,
        [eventId],
      );
      const window = await pglite.query<{ starts_at: Date; ends_at: Date }>(
        "SELECT starts_at, ends_at FROM events WHERE id = $1",
        [eventId],
      );

      for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }

      // Phase 7 places sessions inside the event window, and `saveSessionIn`
      // refuses anything outside it — so reaching `ready` at all is the proof
      // that the rebuilt world agrees with the window it inherited.
      expect((await getDemoProvisionStateIn(database, organizationId))?.phase).toBe("ready");
      const after = await pglite.query<{ starts_at: Date; ends_at: Date }>(
        "SELECT starts_at, ends_at FROM events WHERE id = $1",
        [eventId],
      );
      expect(new Date(String(after.rows[0]?.starts_at)).getTime())
        .toBe(new Date(String(window.rows[0]?.starts_at)).getTime());
      const scheduled = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions
          WHERE event_id = $1 AND starts_at IS NOT NULL
            AND (starts_at < $2 OR ends_at > $3)`,
        [eventId, window.rows[0]?.starts_at, window.rows[0]?.ends_at],
      );
      expect(scheduled.rows[0]?.n).toBe(0);
    }, 180_000);
  });

  describe("reset", () => {
    it("throws the world away and rebuilds it at the same id, with nothing left over", async () => {
      const organizationId = await newOrganization("first-fair-reset");
      const eventId = demoEventId(organizationId);
      for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }
      const before = await countsFor(eventId);

      const state = await resetDemoIn(database, ownerUserId, organizationId, { inTransaction });
      expect(state.eventId).toBe(eventId);
      expect(state.phase).toBe("people");
      for (let step = 1; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }

      expect(await countsFor(eventId)).toEqual(before);
      const tracks = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM tracks WHERE event_id = $1",
        [eventId],
      );
      expect(tracks.rows[0]?.n).toBe(TRACKS.length);
      const cursors = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM event_demo_tour WHERE event_id = $1",
        [eventId],
      );
      expect(cursors.rows[0]?.n).toBe(1);
    }, 240_000);
  });

  describe("reset with nothing to reset", () => {
    it("builds the world rather than raising a 404 at somebody who asked for exactly that", async () => {
      const organizationId = await newOrganization("first-fair-reset-empty");
      const state = await resetDemoIn(database, ownerUserId, organizationId, { inTransaction });
      expect(state).toMatchObject({ phase: "people", eventId: demoEventId(organizationId) });
    }, 60_000);
  });

  describe("\"continue without it\"", () => {
    it("jumps a stuck provision to ready rather than dead-ending the player", async () => {
      const organizationId = await newOrganization("first-fair-skip");
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });

      const state = await skipDemoProvisioningIn(database, ownerUserId, organizationId);
      expect(state).toMatchObject({ phase: "ready", done: true });
      const milestones = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM organization_onboarding_milestones WHERE organization_id = $1 AND milestone = 'demo_provisioned'",
        [organizationId],
      );
      expect(milestones.rows[0]?.n).toBe(1);
    }, 60_000);

    it("remembers where the build stopped, so the tour can drop what never landed", async () => {
      const organizationId = await newOrganization("first-fair-skip-phase");
      const eventId = demoEventId(organizationId);
      for (let step = 0; step < 6; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }
      expect((await getDemoProvisionStateIn(database, organizationId))?.phase).toBe("agenda");

      await skipDemoProvisioningIn(database, ownerUserId, organizationId);

      // Jumping to `ready` is what makes the sandbox usable; losing *where* it
      // stopped is what used to make the promise beside the button ("the parts
      // that needed this step will say so") impossible to keep.
      const row = await pglite.query<{ provision_phase: string; skipped_at_phase: string | null }>(
        "SELECT provision_phase, skipped_at_phase FROM event_demo_tour WHERE event_id = $1",
        [eventId],
      );
      expect(row.rows[0]).toEqual({ provision_phase: "ready", skipped_at_phase: "agenda" });
      const bootstrap = await getDemoTourBootstrapIn(database, eventId, ownerUserId);
      expect(bootstrap?.skippedAtPhase).toBe("agenda");
      // Everything the agenda phase and the phases after it would have written
      // is missing, so those chapters are the ones the tour must not offer.
      expect([...unavailableTourChapters(bootstrap?.skippedAtPhase ?? null)].sort())
        .toEqual(["field-trip", "go-live", "mission-control", "the-grid"]);
    }, 120_000);

    it("leaves the stop phase null on a world that built in full", async () => {
      const organizationId = await newOrganization("first-fair-skip-complete");
      const eventId = demoEventId(organizationId);
      for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }
      await skipDemoProvisioningIn(database, ownerUserId, organizationId);
      const bootstrap = await getDemoTourBootstrapIn(database, eventId, ownerUserId);
      expect(bootstrap?.skippedAtPhase).toBe(null);
      expect(unavailableTourChapters(bootstrap?.skippedAtPhase ?? null)).toEqual([]);
    }, 180_000);
  });

  /**
   * Provisioning is triggered by one organizer and hands *other* people event
   * access as a side effect. That access has to be the weakest role that can
   * hold a round-one assignment: an `organizer` row would give an org-level
   * reviewer — who cannot even list the organization's members — the demo
   * event's whole organizer surface, including the name/email directory of
   * every member of the organization.
   */
  describe("bonus reviewers", () => {
    it("grants review access, never organizer access, to other organization members", async () => {
      const organizationId = await newOrganization("first-fair-bonus-roles");
      const eventId = demoEventId(organizationId);
      const colleague = await pglite.query<{ id: string }>(
        "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
        ["first-fair-org-reviewer@test.dev", "Org-level reviewer"],
      );
      const colleagueUserId = userIdSchema.parse(colleague.rows[0]?.id);
      await pglite.query(
        "INSERT INTO organization_members(user_id,organization_id,role) VALUES($1,$2,'reviewer')",
        [colleagueUserId, organizationId],
      );

      for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
        await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
      }

      const members = await pglite.query<{ user_id: string; role: string }>(
        "SELECT user_id, role FROM event_members WHERE event_id = $1",
        [eventId],
      );
      const roles = new Map(members.rows.map((row) => [row.user_id, row.role]));
      expect(roles.get(ownerUserId)).toBe("owner");
      expect(roles.get(colleagueUserId)).toBe("reviewer");

      // The access was granted for a reason: they really do hold work.
      const assignments = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM review_assignments WHERE reviewer_user_id = $1",
        [colleagueUserId],
      );
      expect(assignments.rows[0]?.n).toBeGreaterThan(0);
    }, 180_000);
  });

  describe("an organization with no demo", () => {
    it("reports nothing to resume", async () => {
      const organizationId = await newOrganization("first-fair-empty");
      await expect(getDemoProvisionStateIn(database, organizationId)).resolves.toBeNull();
      const cursor = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM event_demo_tour WHERE event_id = $1",
        [demoEventId(organizationId)],
      );
      expect(cursor.rows[0]?.n).toBe(0);
    });
  });

  it("keeps two organizations' demo events completely disjoint", async () => {
    const first = await newOrganization("first-fair-tenant-a");
    const second = await newOrganization("first-fair-tenant-b");
    expect(demoEventId(first)).not.toBe(demoEventId(second));
    expect(demoSlug(demoEventId(first))).not.toBe(demoSlug(demoEventId(second)));

    await advanceDemoProvisioningIn(database, ownerUserId, first, { inTransaction });
    await advanceDemoProvisioningIn(database, ownerUserId, second, { inTransaction });
    await advanceDemoProvisioningIn(database, ownerUserId, first, { inTransaction });
    await advanceDemoProvisioningIn(database, ownerUserId, second, { inTransaction });

    const emails = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM contacts WHERE event_id IN ($1, $2)",
      [demoEventId(first), demoEventId(second)],
    );
    expect(emails.rows[0]?.n).toBe(SPEAKERS.length * 2);
  }, 120_000);
});
