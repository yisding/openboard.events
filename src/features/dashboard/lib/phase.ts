import type { DashboardOverview } from "../index";
import { formAcceptsOrWillAccept } from "@/features/forms/index.availability";

/**
 * M56 — phase-aware reordering. An event has one lifecycle (CFP open →
 * review/decisions → onboarding → live → wrap) and at any moment one role has
 * one dominant job; this computes which phase the dashboard is in from data
 * the overview already carries, so surfacing it is reordering, never a new
 * query. Review and decisions are one phase here (`decisions`) because the
 * overview has no reviewer-scoring data to tell them apart from — that lives
 * on the Evaluation page, not this endpoint.
 *
 * `daysToEvent` is the only clock: it is already computed server-side in the
 * event timezone (never a client clock), so this stays a pure function of the
 * fetched overview with no new date math of its own.
 */
export type EventPhase = "cfp" | "decisions" | "onboarding" | "live" | "wrap";

// `forms` deliberately drops `status`: the raw column does not move when a
// close date elapses, so phase must read the derived `availability`.
type PhaseForm = Omit<DashboardOverview["forms"][number], "status">;
type PhaseInput = Pick<DashboardOverview, "event" | "statusCounts" | "kpis"> & { forms: readonly PhaseForm[] };

/** "Live" starts this many days before the event — final-days prep counts as event week. */
const LIVE_STARTS_DAYS_BEFORE = 2;
/** Beyond this many days after, the event is over and the job is wrap-up, not tracking. */
const WRAP_AFTER_DAYS = 7;

export function computeEventPhase(overview: PhaseInput): EventPhase {
  const { daysToEvent } = overview.event;
  if (daysToEvent < WRAP_AFTER_DAYS * -1) return "wrap";
  if (daysToEvent <= LIVE_STARTS_DAYS_BEFORE) return "live";
  if (overview.forms.some((form) => formAcceptsOrWillAccept(form.availability))) return "cfp";
  const awaitingDecision = overview.statusCounts.pending + overview.statusCounts.accept_queue + overview.statusCounts.decline_queue;
  if (awaitingDecision > 0) return "decisions";
  if (overview.kpis.acceptedSpeakers > 0) return "onboarding";
  // No open form, nothing awaiting a decision, nobody accepted yet: the event
  // has not really started — treat it the same as "waiting for submissions".
  return "cfp";
}

/** Which tab best serves the computed phase. */
export function defaultTabForPhase(phase: EventPhase): "today" | "speakers" {
  return phase === "onboarding" || phase === "live" ? "speakers" : "today";
}
