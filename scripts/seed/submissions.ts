import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M17 (WS-C).
 *
 * Seeds ~25 submissions across all 7 statuses, two real drafts, the null-column probe and the XSS probe.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedSubmissions(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
