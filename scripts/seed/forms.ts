import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M12 (WS-B1).
 *
 * Seeds form A open and form B closed, snapshots produced by compileFormSnapshot and never hand-written.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedForms(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
