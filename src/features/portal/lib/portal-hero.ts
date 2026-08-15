import { daysToEvent } from "@/shared/lib/time";
import { formOpenState } from "@/features/forms/index.availability";
import type { MyTaskDTO, PortalSubmissionRow } from "@/features/portal";

/**
 * M59 — "Portal home leads with one next step" (experience-design.md,
 * Surfacing §4). One pure function computing which of four moments to show,
 * so the priority order is a unit-testable fact rather than buried in JSX
 * conditionals. Priority, most urgent first:
 *
 * 1. Acceptance celebration — the caller already decided this fires (it owns
 *    the one-shot "seen" write); this function only renders what the caller
 *    told it happened.
 * 2. An overdue task, then the soonest-due incomplete one — a due date beats
 *    an open draft, since the deadline consequence (a missed task) is worse.
 * 3. A resumable draft, only while its form is still open — an expired
 *    draft's deadline has nothing left to countdown to.
 * 4. Quiet/caught-up — the celebration-adjacent state experience-design.md
 *    names ("When nothing is due, the hero becomes the celebration/status
 *    surface").
 */
export type PortalHero =
  | { kind: "celebration" }
  | { kind: "task"; task: MyTaskDTO }
  | { kind: "draft"; submission: PortalSubmissionRow; daysLeft: number | null }
  | { kind: "quiet"; hasAcceptedSubmission: boolean };

function mostUrgentTask(tasks: MyTaskDTO[]): MyTaskDTO | null {
  const open = tasks.filter((task) => !task.completed);
  if (open.length === 0) return null;
  const overdue = open.filter((task) => task.overdue);
  const pool = overdue.length > 0 ? overdue : open;
  // Earliest due date first; a task with no due date at all is the least
  // urgent of the open ones, so it sorts last.
  return [...pool].sort((a, b) => {
    if (a.dueAt === b.dueAt) return 0;
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  })[0] ?? null;
}

export function computePortalHero(input: {
  showCelebration: boolean;
  submissions: PortalSubmissionRow[];
  myTasks: MyTaskDTO[];
  timezone: string;
  now?: Date;
}): PortalHero {
  if (input.showCelebration) return { kind: "celebration" };

  const task = mostUrgentTask(input.myTasks);
  if (task) return { kind: "task", task };

  // A resumable draft: has a form (not a manually-created row) and that form is
  // actually open. Withdrawn/expired drafts are not "the next step" — they are
  // dead ends, and pointing a speaker at one reads as a bug.
  //
  // Testing `closesAt` alone only covered half of that. The authority is
  // `status = 'open' AND …` (0038_form_open_wall_clock.sql), so an organizer
  // using "Stop accepting submissions" on a CFP with no close date flips
  // `status` and leaves `closes_at` NULL — and every speaker with a draft got a
  // primary "Resume your submission" call to action that lands on
  // `FormClosedNotice`. Ask `formOpenState`, the shared twin of
  // `is_form_open()`, which the edit gate already uses.
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const draft = input.submissions.find((row) => row.status === "Draft"
    && row.formId !== null
    && formOpenState({ status: row.formStatus, opensAt: row.formOpensAt, closesAt: row.formClosesAt }, nowIso).open);
  if (draft) {
    return {
      kind: "draft",
      submission: draft,
      // `time.ts`'s `daysToEvent` is generic calendar-day-distance math
      // despite its name (`differenceInCalendarDays` between two zoned
      // instants) — pointed here at the form's own `closesAt`, not the event
      // start, which is the distinction experience-design.md's
      // draft-resurrection bullet calls out ("not `daysToEvent`, which
      // counts to the event start"): the function is reused, the argument
      // that would make it wrong is not.
      daysLeft: draft.formClosesAt ? daysToEvent(now, new Date(draft.formClosesAt), input.timezone) : null,
    };
  }

  return { kind: "quiet", hasAcceptedSubmission: input.submissions.some((row) => row.status === "Accepted") };
}
