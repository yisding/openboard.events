import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M19 (WS-C).
 *
 * Seeds one plan, three criteria, the seeded reviewer's assignment and partial scores.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedEvaluation(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
