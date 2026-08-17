import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  advanceDemoProvisioningIn,
  DEMO_RUNNABLE_PHASES,
  demoEventId,
  getDemoTourBootstrapIn,
  getTourWorldIn,
  type TourWorld,
  type WorldFactKey,
} from "@/features/onboarding";
import {
  SESSIONS,
  SET_PIECE_TARGET_SLOT,
  SET_PIECE_TRAY_SESSION_KEY,
} from "@/features/onboarding/server/demo/dataset";
import { TOUR_STEPS } from "@/features/onboarding/tour/script";
import { createOrganizationIn } from "@/features/organizations";
import {
  eventIdSchema,
  organizationIdSchema,
  userIdSchema,
  type ContactId,
  type EventId,
  type OrganizationId,
  type SessionId,
  type SubmissionId,
  type UserId,
} from "@/shared/contracts";
import { applyProductMigrations } from "../../scripts/lib/product-migrations";

/**
 * First Fair — every world objective in the script, driven through the real
 * writer that an organizer's own click would reach.
 *
 * D1 says an objective is verified against **server world state**, never
 * against a click. That buys cross-tab, cross-device and post-refresh
 * completion for free — and it costs one thing, which is what this file pays:
 * the world snapshot and the script have to agree about what "the organizer
 * did it" looks like in SQL. A fact that never moves, moves the wrong way, or
 * moves only when a *different* action is taken is a tutorial that hangs on a
 * step the player has already completed, and no unit test of either half can
 * see it. Only driving the actual writer against an actual provisioned demo
 * can.
 *
 * The coverage claim is structural rather than a hand-kept list: `DRIVERS` is
 * asserted to have exactly one entry per `via: "world"` step in `TOUR_SCRIPT`,
 * so adding an objective without teaching this file how a human satisfies it
 * fails here rather than in front of an organizer.
 *
 * Note what is deliberately absent: `emitTourSignal`. The two latency
 * optimisations are client-side `CustomEvent`s and are never the authority —
 * nothing in this file can emit one, and every objective still crosses its
 * threshold. That is the server half of §3.3's "poll is the authority" claim;
 * `tour/poll-only.test.tsx` owns the client half.
 */

let pglite: PGlite;
let database: DbOrTx;

// `transitionStatus` and `notifyQueues` are the two decision writers that
// still bind `db`/`withTx` directly rather than taking a `DbOrTx` — and they
// are exactly the writers Chapter 5 is about, so the alternative to this mock
// is hand-rolling SQL and testing a re-implementation instead of the product.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    db: new Proxy({}, { get: (_target, property) => Reflect.get(database as object, property, database) }),
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => work(database as TxDb),
  };
});

const { notifyQueues, transitionStatus, submitReviewIn, getActivePlanIn, listReviewQueueIn } =
  await import("@/features/submissions");
const { compileAndPublishIn, createFieldIn, getFormForBuilderIn } = await import("@/features/forms");
const { bulkSetPublishedIn, promoteSubmissionIn, saveSessionIn } = await import("@/features/agenda");
const { saveResourcePageIn } = await import("@/features/portal");
const { completeTaskManualIn } = await import("@/features/portal/task-runtime/server/mutations");
const { saveTemplateIn } = await import("@/features/comms/server/admin-mutations");
const { updateEmbedConfigIn } = await import("@/features/public/server/embed-config-mutations");
const { listEmbedConfigsIn } = await import("@/features/public/server/embed-config-queries");

type Driver = (context: { eventId: EventId; organizationId: OrganizationId; actor: UserId }) => Promise<void>;

/** The expectation a delta encodes, as an assertion over the two snapshots. */
function crossed(before: TourWorld, after: TourWorld, fact: WorldFactKey, delta: string): boolean {
  const a = before[fact];
  const b = after[fact];
  if (delta === "changed") return JSON.stringify(a) !== JSON.stringify(b);
  if (typeof a !== "number" || typeof b !== "number") return false;
  return delta === "increased" ? b > a : b < a;
}

async function firstRow<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<Row> {
  const result = await pglite.query<Row>(text, [...params]);
  const row = result.rows[0];
  if (!row) throw new Error(`no row for: ${text}`);
  return row;
}


const DRIVERS: Record<string, Driver> = {
  /**
   * Ch2 — "Add a question to the lightning form."
   *
   * Deliberately driven through the id the *server* nominates, not through a
   * query of this test's own devising: `context.editableFormId` is what the
   * step's route resolves to, and the whole reason that key exists is that
   * `createFieldIn` calls `assertStructuralAllowed(hasNonDraftSubmissions,
   * true)` and the demo's own call for speakers carries two dozen answered
   * proposals. Pointing the step at the CFP — which the script did until this
   * ran — puts the organizer on a screen whose Add question control answers
   * `FORM_LOCKED`, and the card waits forever.
   */
  "call.add-question": async ({ eventId, actor }) => {
    const bootstrap = await getDemoTourBootstrapIn(database, eventId, actor);
    const formId = bootstrap?.context.editableFormId;
    if (!formId) throw new Error("the demo provisioned no form the builder would let an organizer restructure");
    const form = await getFormForBuilderIn(database, eventId, formId);
    const section = form.sections[0];
    if (!section) throw new Error("the lightning-talks form has no section to add a question to");
    await createFieldIn(database, eventId, formId, {
      sectionId: section.id,
      label: "Have you given this talk before?",
      fieldType: "textarea",
    }, form.updatedAt);
  },

  /** Ch2 — "Publish the version." One immutable snapshot per publish. */
  "call.publish": async ({ eventId }) => {
    const row = await firstRow<{ id: string }>(
      "SELECT id FROM forms WHERE event_id = $1 AND context = 'cfp' ORDER BY created_at, id LIMIT 1",
      [eventId],
    );
    await compileAndPublishIn(database, eventId, row.id as never);
  },

  /** Ch4 — "Score one." Round 1 is the organizer's own, with zero pre-scored reviews. */
  "judge.score": async ({ eventId, actor }) => {
    const plan = await getActivePlanIn(database, eventId);
    if (!plan) throw new Error("the demo provisioned no active evaluation round");
    const queue = await listReviewQueueIn(database, eventId, actor, plan.id);
    const target = queue.rows.find((row) => row.scoredAt === null);
    if (!target) throw new Error("round 1 assigned the organizer nothing to score");
    await submitReviewIn(database, eventId, plan.id, target.submissionId, actor, {
      overallScore: 4,
      criterionScores: Object.fromEntries(plan.criteria.map((criterion) => [criterion.id, 4])),
      comment: "Clear thesis, and the demo holds up.",
    });
  },

  /** Ch5 — "Move them to the accept queue." Pending shrinks; nothing is sent. */
  "decide.queue": async ({ eventId, actor }) => {
    const rows = await pglite.query<{ id: string }>(
      "SELECT id FROM submissions WHERE event_id = $1 AND status = 'pending' ORDER BY code LIMIT 3",
      [eventId],
    );
    const ids = rows.rows.map((row) => row.id as SubmissionId);
    expect(ids.length, "Chapter 5 asks for three pending proposals").toBe(3);
    const result = await transitionStatus(eventId, ids, "accept_queue", "pending", actor);
    expect(result.changed).toHaveLength(3);
  },

  /** Ch5 — "Press Notify, then confirm." The rows are real; the mail is not. */
  "decide.confirm": async ({ eventId, actor }) => {
    const result = await notifyQueues(eventId, undefined, actor);
    expect(result.emailsQueued, "the decision run must produce real outbox rows, not a no-op").toBeGreaterThan(0);
  },

  /** Ch6 — the field trip. A speaker completes a task in their own portal. */
  "trip.portal": async ({ eventId }) => {
    const assignment = await firstRow<{ task_id: string; contact_id: string; submission_id: string | null }>(
      `SELECT v.task_id, v.contact_id, v.submission_id
         FROM task_assignments_v v
         JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id
        WHERE v.event_id = $1
          AND t.completion_mode = 'manual'
          AND NOT EXISTS (
            SELECT 1 FROM task_completions c
             WHERE c.event_id = v.event_id AND c.task_id = v.task_id AND c.contact_id = v.contact_id)
        ORDER BY v.task_id, v.contact_id LIMIT 1`,
      [eventId],
    );
    await completeTaskManualIn(
      database as TxDb,
      eventId,
      assignment.contact_id as ContactId,
      assignment.task_id,
      assignment.submission_id,
    );
  },

  /**
   * Ch7 — "Put Voice Agents Under 300ms at 10:15." The tray shrinks and the
   * grid grows.
   *
   * Driven **from the provisioned staging**, by the name the card uses,
   * rather than by "whatever happens to be unscheduled". That is the whole
   * point of this driver: the step tells the organizer to open one named talk
   * from the tray, so if provisioning put that talk on the grid there is
   * nothing to open, `sessionsScheduled` never moves, and the card waits out
   * its ten-minute yield in front of somebody who did exactly as they were
   * told. A driver that grabs any unscheduled row passes happily through that
   * world — this one cannot, because it asserts the named row is in the tray
   * before it touches anything.
   */
  "grid.place": async ({ eventId, actor }) => {
    const setPiece = SESSIONS.find((session) => session.key === SET_PIECE_TRAY_SESSION_KEY);
    if (!setPiece) throw new Error(`the dataset has no session keyed ${SET_PIECE_TRAY_SESSION_KEY}`);
    const target = await firstRow<{ id: string; row_version: number; starts_at: Date | null; room_id: string | null }>(
      "SELECT id, row_version, starts_at, room_id FROM sessions WHERE event_id = $1 AND title = $2",
      [eventId, setPiece.title],
    );
    expect(
      target.starts_at,
      `Chapter 7 says "open it from the tray", so ${setPiece.title} must be provisioned unscheduled`,
    ).toBeNull();
    expect(target.room_id, "an unscheduled session holds no room either").toBeNull();

    // The slot the card names, found through the talks already sitting in it
    // — deliberately an occupied room at an occupied minute, because that is
    // the trap Chapter 7 springs and `grid.resolve` below is what disarms it.
    const occupant = SESSIONS.find((session) =>
      session.placement?.roomKey === SET_PIECE_TARGET_SLOT.roomKey
      && session.placement.dayOffset === SET_PIECE_TARGET_SLOT.dayOffset
      && session.placement.start === SET_PIECE_TARGET_SLOT.start);
    if (!occupant) throw new Error("the set-piece's target slot is empty — there is no conflict to spring");
    const slot = await firstRow<{ starts_at: Date; ends_at: Date; room_id: string }>(
      "SELECT starts_at, ends_at, room_id FROM sessions WHERE event_id = $1 AND title = $2",
      [eventId, occupant.title],
    );

    await saveSessionIn(database, eventId, {
      id: target.id,
      expectedVersion: target.row_version,
      title: setPiece.title,
      roomId: slot.room_id,
      startsAt: new Date(slot.starts_at).toISOString(),
      endsAt: new Date(slot.ends_at).toISOString(),
      status: "draft",
    }, actor);
  },

  /**
   * Ch7 — "Give it a room of its own."
   *
   * Same minute, different room, which is the move the card names and the one
   * that keeps a talk on the day it was announced for.
   * It also isolates the assertion: a room move cannot create or clear a
   * speaker or track collision, so a decrease here is unambiguously the room
   * clash being resolved.
   */
  "grid.resolve": async ({ eventId, actor }) => {
    const clash = await firstRow<{
      id: string; row_version: number; title: string; starts_at: Date; ends_at: Date; free_room_id: string;
    }>(
      `SELECT a.id, a.row_version, a.title, a.starts_at, a.ends_at,
              (SELECT r.id FROM rooms r
                WHERE r.event_id = a.event_id
                  AND NOT EXISTS (
                    SELECT 1 FROM sessions o
                     WHERE o.event_id = a.event_id AND o.room_id = r.id AND o.id <> a.id
                       AND o.starts_at < a.ends_at AND a.starts_at < o.ends_at)
                ORDER BY r.sort_order, r.id LIMIT 1) AS free_room_id
         FROM sessions a JOIN sessions b
           ON b.event_id = a.event_id AND b.id <> a.id AND b.room_id = a.room_id
          AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
        WHERE a.event_id = $1 AND a.room_id IS NOT NULL
        ORDER BY a.starts_at, a.id LIMIT 1`,
      [eventId],
    );
    await saveSessionIn(database, eventId, {
      id: clash.id,
      expectedVersion: clash.row_version,
      title: clash.title,
      roomId: clash.free_room_id,
      startsAt: new Date(clash.starts_at).toISOString(),
      endsAt: new Date(clash.ends_at).toISOString(),
      status: "draft",
    }, actor);
  },

  /** Ch8 — "Publish the agenda." The first row the outside world can see. */
  "live.publish": async ({ eventId }) => {
    const rows = await pglite.query<{ id: string }>(
      "SELECT id FROM sessions WHERE event_id = $1 AND status = 'draft' AND starts_at IS NOT NULL ORDER BY starts_at LIMIT 5",
      [eventId],
    );
    const result = await bulkSetPublishedIn(database, eventId, rows.rows.map((row) => row.id as SessionId), true);
    expect(result.changed).toBeGreaterThan(0);
  },

  /**
   * Ch8 — "Turn on the schedule embed."
   *
   * The page load comes first deliberately: `listEmbedConfigsIn` creates any
   * missing row **enabled**, so if the demo did not provision its five embeds
   * disabled, merely arriving at the step's own route would satisfy the
   * objective before the organizer touched the control — and, because the
   * baseline is captured on arrival, would then never satisfy it at all.
   * Phase 1 provisions them off; this asserts that arriving changes nothing
   * and only the toggle does.
   */
  "live.embed": async ({ eventId }) => {
    const configs = await listEmbedConfigsIn(database, eventId);
    expect(configs.some((config) => config.enabled), "a demo's embeds stay off until Chapter 8").toBe(false);
    const agenda = configs.find((config) => config.contentType === "agenda");
    if (!agenda) throw new Error("the embeds page produced no agenda configuration");
    await updateEmbedConfigIn(database, eventId, agenda.id, { enabled: true });
  },

  /** Ch9 — "Change a subject line." */
  "mission.subject": async ({ eventId }) => {
    const template = await firstRow<{ subject: string; body_html: string; enabled: boolean; updated_at: Date }>(
      "SELECT subject, body_html, enabled, updated_at FROM email_templates WHERE event_id = $1 AND key = 'submission_accepted'",
      [eventId],
    );
    await saveTemplateIn(database, eventId, "submission_accepted", {
      subject: `${template.subject} — see you in San Francisco`,
      bodyHtml: template.body_html,
      enabled: template.enabled,
      expectedUpdatedAt: new Date(template.updated_at).toISOString(),
    });
  },

  /** Side quest — publish the resource page the demo leaves unpublished. */
  "quest.speaker-resources": async ({ eventId }) => {
    const page = await firstRow<{ id: string; title: string; slug: string; body_html: string }>(
      "SELECT id, title, slug, body_html FROM resource_pages WHERE event_id = $1 AND NOT published LIMIT 1",
      [eventId],
    );
    await saveResourcePageIn(database, eventId, {
      id: page.id,
      title: page.title,
      slug: page.slug,
      bodyHtml: page.body_html,
      published: true,
    });
  },

  /** Side quest — Auto-place the rest of the tray. */
  "quest.auto-place": async ({ eventId }) => {
    const promotable = await pglite.query<{ id: string }>(
      `SELECT s.id FROM submissions s
        WHERE s.event_id = $1 AND s.status = 'accepted'
          AND NOT EXISTS (SELECT 1 FROM sessions x WHERE x.submission_id = s.id)
        ORDER BY s.code LIMIT 1`,
      [eventId],
    );
    const promoted = promotable.rows[0];
    if (promoted) await promoteSubmissionIn(database, eventId, promoted.id as SubmissionId);
    const unscheduled = await firstRow<{ id: string; row_version: number; title: string }>(
      "SELECT id, row_version, title FROM sessions WHERE event_id = $1 AND starts_at IS NULL ORDER BY title LIMIT 1",
      [eventId],
    );
    // A genuinely free slot: the far end of the last thing already placed,
    // which the event's own window is guaranteed to still contain.
    const tail = await firstRow<{ latest: Date }>(
      "SELECT max(ends_at) AS latest FROM sessions WHERE event_id = $1 AND ends_at IS NOT NULL",
      [eventId],
    );
    const startsAt = new Date(tail.latest);
    await saveSessionIn(database, eventId, {
      id: unscheduled.id,
      expectedVersion: unscheduled.row_version,
      title: unscheduled.title,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      status: "draft",
    }, null);
  },
};

const WORLD_STEPS = TOUR_STEPS
  .filter((step): step is typeof step & { objective: { via: "world"; fact: WorldFactKey; delta: string } } =>
    step.objective?.via === "world");

describe("the tour's golden path, driven through the real writers", () => {
  let actor: UserId;
  let organizationId: OrganizationId;
  let eventId: EventId;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const users = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["olive@first-fair.test", "Olive Organizer"],
    );
    actor = userIdSchema.parse(users.rows[0]?.id);
    organizationId = organizationIdSchema.parse(
      (await createOrganizationIn(database, actor, { name: "First Fair", slug: "first-fair" })).id,
    );
    const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);
    for (let phase = 0; phase < DEMO_RUNNABLE_PHASES.length; phase += 1) {
      await advanceDemoProvisioningIn(database, actor, organizationId, { inTransaction });
    }
    eventId = eventIdSchema.parse(demoEventId(organizationId));
  }, 300_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("knows how a human satisfies every world objective the script declares", () => {
    // The guard against this suite quietly covering nothing.
    expect(WORLD_STEPS.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(DRIVERS).sort()).toEqual(WORLD_STEPS.map((step) => step.id).sort());
  });

  it("moves every objective's fact, in the direction the script promises", async () => {
    const unmoved: string[] = [];
    for (const step of WORLD_STEPS) {
      const driver = DRIVERS[step.id];
      if (!driver) throw new Error(`no driver for ${step.id}`);
      const before = await getTourWorldIn(database, eventId, actor);
      await driver({ eventId, organizationId, actor });
      const after = await getTourWorldIn(database, eventId, actor);
      if (!crossed(before, after, step.objective.fact, step.objective.delta)) {
        unmoved.push(
          `${step.id}: ${step.objective.fact} should have ${step.objective.delta}, `
          + `but went ${JSON.stringify(before[step.objective.fact])} → ${JSON.stringify(after[step.objective.fact])}`,
        );
      }
    }
    expect(unmoved).toEqual([]);
  }, 300_000);

  it("still sends nothing, however much of the tour the organizer completes", async () => {
    const rows = await pglite.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM communication_logs WHERE event_id = $1 GROUP BY status",
      [eventId],
    );
    const byStatus = Object.fromEntries(rows.rows.map((row) => [row.status, row.n]));
    // Chapter 5 genuinely queues decision emails — that is the point of the
    // chapter, and a tutorial that quietly disabled the outbox would be a lie.
    // Rail 2 (the dispatcher's `SkipEmail`) is what makes it safe and
    // `comms/server/demo-suppression.test.ts` owns that half; what this file
    // can assert is the structural half: rows were produced, every address
    // they carry is unroutable, and not one has ever reached a provider.
    expect((byStatus.queued ?? 0) + (byStatus.sent ?? 0) + (byStatus.skipped ?? 0) + (byStatus.failed ?? 0))
      .toBeGreaterThan(0);
    // MTP-18 §4/26. Provisioning used to backdate six `sent` rows and one
    // `failed` one so the log looked lived-in; nothing had been delivered —
    // the addresses below prove that — but the status column an organizer
    // reads claimed otherwise on the one screen the safety audit inspects.
    // A demo event may hold rows waiting to be drained; it may never hold a
    // row that says mail went out.
    expect(byStatus.sent ?? 0, "a demo event never claims a send").toBe(0);
    expect(byStatus.failed ?? 0, "a demo event never claims a delivery attempt").toBe(0);
    const external = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM communication_logs log
         JOIN contacts contact ON contact.id = log.contact_id
        WHERE log.event_id = $1 AND contact.email NOT LIKE '%.invalid'`,
      [eventId],
    );
    expect(external.rows[0]?.n ?? 0, "rail 1: every address a demo outbox row carries is RFC 2606 unroutable").toBe(0);
    const provider = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND provider_message_id IS NOT NULL",
      [eventId],
    );
    expect(provider.rows[0]?.n ?? 0, "nothing in a demo event has ever reached a provider").toBe(0);
  });

  it("never writes an onboarding checkpoint, however far the tour goes", async () => {
    const progress = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM event_onboarding_progress WHERE event_id = $1",
      [eventId],
    );
    expect(progress.rows[0]?.n ?? 0, "Trap A: a demo must never look like a half-built real event").toBe(0);
  });
});
