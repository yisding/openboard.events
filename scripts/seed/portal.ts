import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M21 (WS-D).
 *
 * Seeds three tasks one per mode with one overdue, a file request, portal forms and two resource pages.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedPortal(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
