import { runSubmissionsIn, SUBMISSIONS_PHASE_A } from "./submissions";
import type { PhaseCtx } from "./context";

/**
 * Phase 4 — the first twelve proposals.
 *
 * The twenty-four are split across two requests purely for time: each one runs
 * inside a transaction (`createSubmissionIn` takes a `TxDb`), and a single
 * transaction holding two dozen multi-statement submits is the kind of thing
 * that finds a Worker's CPU ceiling on a bad day. Splitting them costs one
 * extra round trip and buys a bounded phase.
 */
export function runSubmissionsAPhase(ctx: PhaseCtx): Promise<void> {
  return runSubmissionsIn(ctx, SUBMISSIONS_PHASE_A);
}
