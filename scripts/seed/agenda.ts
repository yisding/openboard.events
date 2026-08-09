import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M28 (WS-E).
 *
 * Seeds ~15 sessions, three unscheduled, the two named conflict pairs and one back-to-back pair that must not flag.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedAgenda(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
