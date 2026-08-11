import type { DashboardOverview } from "../index";

/**
 * M60 — "Milestone acknowledgments... small dashboard moments that make the
 * tool feel like a colleague" (experience-design.md). Pure and derived
 * entirely from the overview the dashboard already fetches — no new query,
 * same discipline as `computeEventPhase` (M56).
 *
 * Each milestone is a one-time fact about the *whole* event, not an ongoing
 * queue — that is what separates this from `AttentionQueue`: an attention
 * item disappears once its count hits zero, a milestone appears once a
 * threshold is crossed and stays true. The component that renders these is
 * what remembers "already acknowledged" (localStorage, keyed by event and
 * milestone id), because that is a per-browser UI preference, not a fact
 * about the event.
 */
export type MilestoneId = "cfp_closed" | "decisions_sent" | "scheduling_complete";

export type Milestone = { id: MilestoneId; title: string; detail: string; href: string };

type MilestoneInput = Pick<DashboardOverview, "event" | "forms" | "statusCounts" | "kpis">;

export function computeMilestones(overview: MilestoneInput): Milestone[] {
  const milestones: Milestone[] = [];
  const base = `/events/${overview.event.id}`;

  // CFP closed: every form has left "open" (closed by date or by hand) and
  // at least one submission exists — an event with no forms yet, or one
  // whose only form is still open, has nothing to acknowledge.
  const totalSubmitted = overview.forms.reduce((sum, form) => sum + form.submitted, 0);
  if (overview.forms.length > 0 && overview.forms.every((form) => form.status !== "open") && totalSubmitted > 0) {
    milestones.push({
      id: "cfp_closed",
      title: "Call for speakers closed",
      detail: `${totalSubmitted} submission${totalSubmitted === 1 ? "" : "s"} received.`,
      href: `${base}/abstracts`,
    });
  }

  // All decisions sent: nothing left pending or queued, and at least one
  // submission has actually been decided — an empty event trivially
  // satisfies "zero queued" without this having happened yet.
  const { pending, accept_queue: acceptQueue, decline_queue: declineQueue, accepted, declined } = overview.statusCounts;
  const decided = accepted + declined;
  if (decided > 0 && pending === 0 && acceptQueue === 0 && declineQueue === 0) {
    milestones.push({
      id: "decisions_sent",
      title: "Every decision is sent",
      detail: `${accepted} accepted, ${declined} declined — nothing left waiting.`,
      href: `${base}/abstracts`,
    });
  }

  // Scheduling complete: every accepted speaker has a slot. Not literally
  // "zero conflicts" (the overview carries no conflict count — inventing one
  // here would be a fact this function does not actually have), but the
  // adjacent milestone this data honestly supports.
  if (overview.kpis.acceptedSpeakers > 0 && overview.kpis.unscheduledAccepted === 0) {
    milestones.push({
      id: "scheduling_complete",
      title: "Everyone accepted is on the schedule",
      detail: `${overview.kpis.scheduledSessions} session${overview.kpis.scheduledSessions === 1 ? "" : "s"} placed.`,
      href: `${base}/agenda`,
    });
  }

  return milestones;
}
