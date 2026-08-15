import { and, eq } from "drizzle-orm";
import { db, withTx, type DbOrTx } from "@/db/client";
import { eventDemoTour } from "@/db/schema";
import { recordOrganizationAuditEventIn } from "@/features/organizations";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
import { AppError, isAppError } from "@/shared/lib/errors";
import type { EventId, OrganizationId, UserId } from "@/shared/contracts";
import {
  DEMO_PHASE_COUNT,
  DEMO_PHASE_LABELS,
  DEMO_RUNNABLE_PHASES,
  demoProvisionStateSchema,
  type DemoProvisionStateDTO,
  type DemoRunnablePhase,
} from "../../demo-schemas";
import type { DemoProvisionPhase } from "../../tour-schemas";
import { demoDates } from "./clock";
import { DEMO_DATASET_VERSION, demoEventId, demoSlug } from "./ids";
import { deleteDemoEventIn } from "./delete";
import { runEventPhase } from "./phases/01-event";
import { runPeoplePhase } from "./phases/02-people";
import { runFormsPhase } from "./phases/03-forms";
import { runSubmissionsAPhase } from "./phases/04-submissions-a";
import { runSubmissionsBPhase } from "./phases/05-submissions-b";
import { runEvaluationPhase } from "./phases/06-evaluation";
import { runAgendaPhase } from "./phases/07-agenda";
import { runPortalPhase } from "./phases/08-portal";
import { runResourcesPhase } from "./phases/09-resources";
import { runCommsPhase } from "./phases/10-comms";
import type { DemoTransaction, PhaseCtx, PhaseRunner } from "./phases/context";

/**
 * First Fair — the demo world's provisioning orchestrator (design §2.3, D4).
 *
 * Ten phases, one HTTP request each, advanced by compare-and-set, with the
 * clock frozen for the whole run. Each of those four words is load-bearing:
 *
 * - **Ten phases.** `withTx` opens a fresh Neon WebSocket pool per call, and
 *   one transaction spanning the roughly four hundred statements this world
 *   needs is a bet against a Worker's CPU and duration limits. Each phase is
 *   bounded, and only the phases whose writers demand a `TxDb` open a
 *   transaction at all.
 * - **One request each.** The organizer watches a progress bar with ten real
 *   steps on it instead of a spinner, and a phase that fails is a line that
 *   turns amber rather than a dead end.
 * - **Compare-and-set.** Two concurrent POSTs — a double-clicked button, a
 *   retry racing a slow response — cannot both advance: the loser's UPDATE
 *   matches zero rows, and it re-reads and reports the winner's state.
 * - **Frozen clock.** `now` is the cursor's `created_at`, captured once — and
 *   captured from the *committed event row*, not from the request that wrote
 *   it (see `demoNowFromEventStart`). If each phase read its own `new Date()`,
 *   a provision straddling local midnight or resumed after a failure could
 *   land the agenda on a different wall-clock day than the event window —
 *   which would also un-plant the conflicts Chapter 7 is built around, and
 *   push phase 7's sessions outside a window `saveSessionIn` refuses to
 *   overflow.
 *
 * Every phase is individually idempotent on `stableUuid`-namespaced ids, so a
 * lost response is free: the next POST either redoes an idempotent phase or
 * moves on. That is also why the orchestrator never writes the `failed` cursor
 * value the migration's CHECK allows — parking the cursor on the phase that
 * threw is what makes *"Try that step again"* a plain replay.
 */

/** Runners for the phases that build something, plus the terminal cursor. */
const PHASE_RUNNERS: Record<DemoRunnablePhase, PhaseRunner> = {
  // Wrapped rather than passed straight through: phase 1 returns the effective
  // frozen clock, and only the no-cursor branch below has any use for it.
  event: async (ctx) => { await runEventPhase(ctx); },
  people: runPeoplePhase,
  forms: runFormsPhase,
  submissions_a: runSubmissionsAPhase,
  submissions_b: runSubmissionsBPhase,
  // WP5: the review queue, the agenda's planted conflicts, the speaker
  // portal, the resource pages and the backdated delivery log.
  evaluation: runEvaluationPhase,
  agenda: runAgendaPhase,
  portal: runPortalPhase,
  resources: runResourcesPhase,
  comms: runCommsPhase,
};

/**
 * A total successor map rather than array indexing.
 * `noUncheckedIndexedAccess` plus a zero-warning lint budget makes
 * `PHASES[i + 1]!` a build failure, and it should be: an off-by-one in a phase
 * table is exactly the bug that silently skips a phase in production.
 */
const NEXT_PHASE: Record<DemoRunnablePhase, DemoProvisionPhase> = {
  event: "people",
  people: "forms",
  forms: "submissions_a",
  submissions_a: "submissions_b",
  submissions_b: "evaluation",
  evaluation: "agenda",
  agenda: "portal",
  portal: "resources",
  resources: "comms",
  comms: "ready",
};

function isRunnable(phase: DemoProvisionPhase): phase is DemoRunnablePhase {
  return (DEMO_RUNNABLE_PHASES as readonly DemoProvisionPhase[]).includes(phase);
}

type Cursor = {
  eventId: EventId;
  organizationId: OrganizationId;
  provisionPhase: DemoProvisionPhase;
  createdAt: Date;
};

function stateOf(cursor: Cursor): DemoProvisionStateDTO {
  const phase = cursor.provisionPhase;
  const runnableIndex = DEMO_RUNNABLE_PHASES.indexOf(phase as DemoRunnablePhase);
  return demoProvisionStateSchema.parse({
    eventId: cursor.eventId,
    eventSlug: demoSlug(cursor.eventId),
    phase,
    // 1-based and counting the phase currently being worked, so the screen
    // reads "7 of 10" while the agenda is being laid out — never "6 of 10"
    // beside a line that says it is building the grid.
    phaseIndex: runnableIndex >= 0 ? runnableIndex + 1 : DEMO_PHASE_COUNT,
    phaseCount: DEMO_PHASE_COUNT,
    label: DEMO_PHASE_LABELS[phase],
    done: phase === "ready",
  });
}

async function readCursorIn(dbOrTx: DbOrTx, eventId: EventId): Promise<Cursor | null> {
  const [row] = await dbOrTx.select({
    eventId: eventDemoTour.eventId,
    organizationId: eventDemoTour.organizationId,
    provisionPhase: eventDemoTour.provisionPhase,
    createdAt: eventDemoTour.createdAt,
  }).from(eventDemoTour).where(eq(eventDemoTour.eventId, eventId)).limit(1);
  if (!row) return null;
  return {
    eventId: row.eventId as EventId,
    organizationId: row.organizationId as OrganizationId,
    provisionPhase: row.provisionPhase as DemoProvisionPhase,
    createdAt: row.createdAt,
  };
}

/**
 * Creates the cursor, or reads back whichever concurrent request created it
 * first.
 *
 * The row cannot exist before its event: `event_demo_tour` carries a composite
 * `(event_id, organization_id)` foreign key into `events`, which is what stops
 * a cursor from ever naming an event in another tenant. So the very first
 * request runs phase one, takes back the clock the committed event row is
 * actually authored against, and stores *that* instant as the cursor's
 * `created_at` — from which point on it is the frozen clock every remaining
 * phase reads.
 */
async function createCursorIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  organizationId: OrganizationId,
  actorUserId: UserId,
  createdAt: Date,
  provisionPhase: DemoProvisionPhase,
): Promise<Cursor> {
  await dbOrTx.insert(eventDemoTour).values({
    eventId,
    organizationId,
    userId: actorUserId,
    datasetVersion: DEMO_DATASET_VERSION,
    provisionPhase,
    createdAt,
    updatedAt: createdAt,
  }).onConflictDoNothing({ target: eventDemoTour.eventId });
  const cursor = await readCursorIn(dbOrTx, eventId);
  if (!cursor) throw new AppError("INTERNAL", "The demo event's cursor could not be created");
  return cursor;
}

/**
 * The compare-and-set. `false` means somebody else advanced this cursor first —
 * not an error, just a request that arrived second.
 */
async function advancePhaseCasIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  from: DemoProvisionPhase,
  to: DemoProvisionPhase,
  /**
   * Set only by "Continue without it": the phase whose payload never landed,
   * recorded in the *same* statement that jumps the cursor so the CAS stays
   * one atomic write. Everything the tour needs to mark the affected chapters
   * unavailable hangs off this one column — without it, the jump to `ready`
   * erases the only record of how far the build got.
   */
  skippedAtPhase?: DemoRunnablePhase,
): Promise<boolean> {
  const [row] = await dbOrTx.update(eventDemoTour)
    .set({
      provisionPhase: to,
      ...(skippedAtPhase ? { skippedAtPhase } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(eventDemoTour.eventId, eventId), eq(eventDemoTour.provisionPhase, from)))
    .returning();
  return Boolean(row);
}

function contextFor(
  dbOrTx: DbOrTx,
  inTransaction: DemoTransaction,
  eventId: EventId,
  organizationId: OrganizationId,
  actorUserId: UserId,
  now: Date,
): PhaseCtx {
  return { dbOrTx, inTransaction, eventId, organizationId, actorUserId, now, dates: demoDates(now) };
}

export type DemoProvisionOptions = {
  /**
   * How a phase that needs a real transaction gets one. Defaults to `withTx`;
   * the suite passes its own connection so the phases can be exercised against
   * a test database, which `withTx` — which builds its own pool from
   * `DATABASE_URL` — cannot reach.
   */
  inTransaction?: DemoTransaction;
};

/**
 * Runs the next phase of this organization's demo world and returns where the
 * cursor now stands. Safe to call in a loop, safe to call twice, safe to call
 * after a lost response.
 */
export async function advanceDemoProvisioningIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
  options: DemoProvisionOptions = {},
): Promise<DemoProvisionStateDTO> {
  const inTransaction = options.inTransaction ?? withTx;
  const eventId = demoEventId(organizationId);

  const existing = await readCursorIn(dbOrTx, eventId);
  if (!existing) {
    // No cursor yet, so no frozen clock yet either — and no event for the
    // cursor's foreign key to point at. Phase one is what creates both.
    //
    // The clock stored on the cursor is the one phase one reports back, not
    // the `new Date()` this request started from. The two differ exactly when
    // an earlier attempt already committed the event row and died before
    // writing the cursor: `createEventIn` recovers that row without touching
    // its dates, so the wall clock of *this* request would silently desync
    // every later phase from the window phase 7 has to fit inside.
    const ctx = contextFor(dbOrTx, inTransaction, eventId, organizationId, actorUserId, new Date());
    const frozenNow = await runEventPhase(ctx);
    const created = await createCursorIn(dbOrTx, eventId, organizationId, actorUserId, frozenNow, NEXT_PHASE.event);
    return stateOf(created);
  }

  if (existing.provisionPhase === "ready") return stateOf(existing);
  if (!isRunnable(existing.provisionPhase)) {
    // `failed` is in the column's CHECK but is never written here; reaching it
    // means an older build or an operator parked the cursor. Reset clears it.
    throw new AppError("CONFLICT", "This demo event stopped part-way through. Reset it to build it again.");
  }

  const ctx = contextFor(dbOrTx, inTransaction, eventId, organizationId, actorUserId, existing.createdAt);
  await PHASE_RUNNERS[existing.provisionPhase](ctx);

  const next = NEXT_PHASE[existing.provisionPhase];
  const won = await advancePhaseCasIn(dbOrTx, eventId, existing.provisionPhase, next);
  if (!won) {
    // A concurrent request advanced first. Its phase run and this one wrote the
    // same idempotent rows; report where the cursor actually is.
    const current = await readCursorIn(dbOrTx, eventId);
    if (!current) throw new AppError("NOT_FOUND", "This organization has no demo event");
    return stateOf(current);
  }

  if (next === "ready") await recordCompletionIn(dbOrTx, organizationId, eventId, actorUserId);
  return stateOf({ ...existing, provisionPhase: next });
}

export const advanceDemoProvisioning = (
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<DemoProvisionStateDTO> => advanceDemoProvisioningIn(db, actorUserId, organizationId);

/**
 * The server half of the provisioning screen's *"Continue without it"*
 * (design §2.8): jump the cursor to `ready` without running the phase that
 * would not take.
 *
 * A tutorial that dead-ends on a failed phase is worse than a tutorial that is
 * one chapter short. The tour marks the chapters whose payload never landed as
 * unavailable, with an honest line, rather than pointing the player at an
 * empty screen — and `skipped_at_phase` is the one fact that makes that
 * possible. It is written in the same statement as the cursor jump, because a
 * cursor that says `ready` and no record of where the build stopped is
 * indistinguishable from a world that finished.
 */
export async function skipDemoProvisioningIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<DemoProvisionStateDTO> {
  const eventId = demoEventId(organizationId);
  const cursor = await readCursorIn(dbOrTx, eventId);
  if (!cursor) throw new AppError("NOT_FOUND", "This organization has no demo event");
  if (cursor.provisionPhase === "ready") return stateOf(cursor);

  const stoppedAt = isRunnable(cursor.provisionPhase) ? cursor.provisionPhase : undefined;
  const won = await advancePhaseCasIn(dbOrTx, eventId, cursor.provisionPhase, "ready", stoppedAt);
  if (won) await recordCompletionIn(dbOrTx, organizationId, eventId, actorUserId);
  const current = await readCursorIn(dbOrTx, eventId);
  if (!current) throw new AppError("NOT_FOUND", "This organization has no demo event");
  return stateOf(current);
}

export const skipDemoProvisioning = (
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<DemoProvisionStateDTO> => skipDemoProvisioningIn(db, actorUserId, organizationId);

/**
 * Reaching `ready` is the funnel event, and it is deliberately **not**
 * `event_created`: a demo must never look like a conversion. The audit entry is
 * the other half — an owner reading `/organizations/{id}/audit` should be able
 * to see exactly what the tutorial did on their behalf.
 */
async function recordCompletionIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  eventId: EventId,
  actorUserId: UserId,
): Promise<void> {
  await tryRecordOrganizationOnboardingMilestoneIn(dbOrTx, organizationId, "demo_provisioned", actorUserId);
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "demo.provisioned", null, {
    eventId,
    datasetVersion: DEMO_DATASET_VERSION,
  });
}

/**
 * Reset: throw the world away and build it again at the same deterministic id.
 *
 * Safe because the cascading DELETE is one statement that commits before
 * anything is rebuilt, so no child row can survive to collide with its
 * replacement and no tombstone can outlive it. Deliberately reachable by an
 * organizer rather than only an owner — resetting a sandbox is not a
 * destructive act in the way discarding it is — while `deleteDemoEventIn`'s own
 * predicate keeps it structurally incapable of touching a real event.
 */
export async function resetDemoIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
  options: DemoProvisionOptions = {},
): Promise<DemoProvisionStateDTO> {
  const eventId = demoEventId(organizationId);
  try {
    await deleteDemoEventIn(dbOrTx, organizationId, eventId);
  } catch (error) {
    // Nothing to throw away is not a failed reset — it is a reset whose delete
    // already committed before its response was lost, or an organizer who
    // pressed Reset from a stale screen after discarding the demo. Either way
    // the honest answer is to build the world, not to raise a 404 at somebody
    // who asked for exactly that.
    if (!isAppError(error) || error.code !== "NOT_FOUND") throw error;
  }
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "demo.reset", null, { eventId });
  return advanceDemoProvisioningIn(dbOrTx, actorUserId, organizationId, options);
}

export const resetDemo = (
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<DemoProvisionStateDTO> => resetDemoIn(db, actorUserId, organizationId);

/**
 * Where this organization's demo stands without touching it — what the fork
 * and the org home read to decide between *"Explore a finished conference"* and
 * *"Resume the tour"*. `null` means there is nothing to resume.
 */
export async function getDemoProvisionStateIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
): Promise<DemoProvisionStateDTO | null> {
  const cursor = await readCursorIn(dbOrTx, demoEventId(organizationId));
  return cursor ? stateOf(cursor) : null;
}

export const getDemoProvisionState = (organizationId: OrganizationId): Promise<DemoProvisionStateDTO | null> =>
  getDemoProvisionStateIn(db, organizationId);
