import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M17 (WS-C), step 2a.
 *
 * Seeds 12 speakers with headshot file_assets; four downstream modules render against them.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedContacts(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
