import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M11 (WS-B1).
 *
 * Seeds events, tracks, rooms, formats, tags, users, event_members — plus the standing empty event.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedEvents(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
