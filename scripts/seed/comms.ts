import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M34 (WS-F).
 *
 * Seeds seedDefaultTemplates (the only producer of email_templates rows), reminder rules and a pre-populated log.
 *
 * Typed no-op until its owner fills it in: the orchestrator composes whatever
 * exists, so a missing feature module is a skipped line, never a crash.
 */
export async function seedComms(ctx: SeedCtx): Promise<void> {
  ctx.log("skipped — not implemented");
}
