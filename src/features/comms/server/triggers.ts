import { log } from "@/shared/lib/log";
import { dispatchOutbox } from "./dispatcher";

/**
 * Best-effort latency polish on top of the %1 outbox cron, never a substitute
 * for it. Call it immediately after a user-facing `enqueueEmail` has committed,
 * handing it the request's `ctx.waitUntil`: the drain then runs outside the
 * response path and turns "email arrives within a cron tick" into "email
 * arrives in about a second". Every failure is swallowed — the cron is the
 * guarantee, so a nudge that cannot run is a non-event.
 */
export function nudgeOutbox(waitUntil: (promise: Promise<unknown>) => void): void {
  const drain = dispatchOutbox(10).catch((error: unknown) => {
    log({ level: "warn", msg: `outbox nudge failed: ${error instanceof Error ? error.message : String(error)}`, requestId: "-", feature: "comms" });
  });
  try {
    waitUntil(drain);
  } catch {
    // No Cloudflare context (tests, `next dev`): the promise still runs, and
    // the cron picks up anything the process does not finish.
  }
}
