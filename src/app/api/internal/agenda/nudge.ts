import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nudgeOutbox } from "@/features/comms";

/**
 * Post-commit latency polish shared by the four agenda routes that can enqueue
 * schedule mail. The %1 outbox cron remains the guarantee — this only turns
 * "within a tick" into "within about a second" — so a missing Cloudflare context
 * (tests, `next dev`) is a no-op rather than an error.
 */
export function nudgeAfterEnqueue(): void {
  try {
    nudgeOutbox(getCloudflareContext().ctx.waitUntil.bind(getCloudflareContext().ctx));
  } catch {
    // No Worker context here; the cron picks the rows up on its next pass.
  }
}
