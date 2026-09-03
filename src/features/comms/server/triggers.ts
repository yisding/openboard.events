import { getCloudflareContext } from "@opennextjs/cloudflare";
import { log } from "@/shared/lib/log";
import { dispatchOutbox } from "./dispatcher";

/**
 * The normal delivery path for user-facing mail. Call it immediately after an
 * `enqueueEmail` has committed, handing it the request's `ctx.waitUntil`: the
 * drain then runs outside the response path and the email arrives in about a
 * second. The jobs Worker's outbox sweep runs only every fifteen minutes now
 * (`workers/jobs/wrangler.jsonc`) and is the durable recovery path for rows a
 * nudge missed — a failed provider call, a request that died, a row parked in
 * retry backoff. Every failure here is swallowed: the sweep is the guarantee,
 * so a nudge that cannot run is a non-event.
 */
export function nudgeOutbox(waitUntil: (promise: Promise<unknown>) => void): void {
  const drain = dispatchOutbox(10).catch((error: unknown) => {
    log({ level: "warn", msg: `outbox nudge failed: ${error instanceof Error ? error.message : String(error)}`, requestId: "-", feature: "comms" });
  });
  try {
    waitUntil(drain);
  } catch {
    // No Cloudflare context (tests, `next dev`): the promise still runs, and
    // the sweep picks up anything the process does not finish.
  }
}

/**
 * `nudgeOutbox` for route handlers that do not hold `ctx` themselves
 * (`defineHandler` callers). Resolves the Worker context and is a no-op
 * without one, so it is safe from tests and `next dev`.
 */
export function nudgeOutboxAfterCommit(): void {
  try {
    const ctx = getCloudflareContext().ctx;
    nudgeOutbox(ctx.waitUntil.bind(ctx));
  } catch {
    // No Worker context here; the recovery sweep drains the rows on its next pass.
  }
}
