import { runSubmissionsIn, SUBMISSIONS_PHASE_B } from "./submissions";
import type { PhaseCtx } from "./context";

/**
 * Phase 5 — the remaining twelve proposals, including the two genuine drafts.
 *
 * The drafts are deliberately last, and not only for pacing.
 * `createSubmissionIn` promotes an existing draft when a CFP submit arrives
 * from the same speaker on the same form; creating a draft before that
 * speaker's finished proposals would mean the next one silently swallowed it
 * instead of adding a row. Ordering is the fix, and the seed makes the same
 * choice for the same reason.
 */
export function runSubmissionsBPhase(ctx: PhaseCtx): Promise<void> {
  return runSubmissionsIn(ctx, SUBMISSIONS_PHASE_B);
}
