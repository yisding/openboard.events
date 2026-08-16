import type { ScheduledSessionDTO } from "@/shared/contracts";
import { statusBadgeLabel } from "@/shared/ui/status-badge";

/**
 * The two ways a promoted session can stop telling the truth about its abstract.
 *
 * Both are invisible from the `sessions` row alone, and both used to be found
 * out publicly:
 *
 * - **`hidden`** — the session says "Published", but `published_sessions_v`
 *   (drizzle/0045) carries a promoted session only while its abstract is
 *   `accepted`. A speaker's withdrawal, or a reversed decision, takes the talk
 *   and its speaker off every public surface without touching `sessions`.
 * - **`orphaned`** — the same abstract change, on a session that was not
 *   reaching the public anyway. Nothing is lying yet, but the talk is gone.
 * - **`title_drift`** — the abstract's title was edited after promotion.
 *   Nothing propagates it, so the agenda keeps showing the title the talk had
 *   on the day it was promoted.
 *
 * One session reports one divergence: a withdrawn abstract is the bigger fact,
 * and a stale title on a talk that is no longer happening is noise.
 */
export type AbstractDivergence =
  | { kind: "hidden"; abstractStatus: LinkedStatus }
  | { kind: "orphaned"; abstractStatus: LinkedStatus }
  | { kind: "title_drift"; abstractTitle: string };

type LinkedStatus = NonNullable<ScheduledSessionDTO["linkedSubmission"]>["status"];

export type DivergenceSession = Pick<ScheduledSessionDTO, "title" | "status" | "startsAt" | "linkedSubmission">;

export function abstractDivergence(session: DivergenceSession): AbstractDivergence | null {
  const abstract = session.linkedSubmission;
  if (!abstract) return null;
  if (abstract.status !== "accepted") {
    // Exactly `published_sessions_v`'s predicate. A published session with no
    // time was never public, so it is told the plainer story instead.
    const wasPublic = session.status === "published" && session.startsAt !== null;
    return { kind: wasPublic ? "hidden" : "orphaned", abstractStatus: abstract.status };
  }
  if (abstract.title.trim() !== session.title.trim()) {
    return { kind: "title_drift", abstractTitle: abstract.title };
  }
  return null;
}

export type DivergenceNotice = {
  /** Chip text. Short enough for a table cell and a tray row. */
  label: string;
  /** The whole story, for a tooltip, an alert or an accessible description. */
  detail: string;
  tone: "danger" | "warning";
};

/**
 * One vocabulary for every surface that shows a divergence, so the List view,
 * the grid card, the trays and the edit dialog cannot describe the same fact
 * three different ways.
 */
export function divergenceNotice(divergence: AbstractDivergence): DivergenceNotice {
  if (divergence.kind === "title_drift") {
    return {
      label: "Title differs from the abstract",
      detail: `The abstract now reads “${divergence.abstractTitle}”. Editing an abstract never renames its session, so the two have drifted apart.`,
      tone: "warning",
    };
  }
  const status = statusBadgeLabel(divergence.abstractStatus).toLowerCase();
  if (divergence.kind === "hidden") {
    return {
      label: "Not on the public schedule",
      detail: `This session is marked published, but its abstract is ${status}, so the public schedule and speaker gallery leave it out. Accept the abstract again, or unpublish the session.`,
      tone: "danger",
    };
  }
  return {
    label: `Abstract ${status}`,
    detail: `This session's abstract is ${status}. Publishing it will not put it on the public schedule until the abstract is accepted again.`,
    tone: "warning",
  };
}

/** Every session whose abstract has moved on without it. */
export function divergedSessions<T extends DivergenceSession>(sessions: readonly T[]): T[] {
  return sessions.filter((session) => abstractDivergence(session) !== null);
}
