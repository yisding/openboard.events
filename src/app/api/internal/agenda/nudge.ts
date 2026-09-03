import { nudgeOutboxAfterCommit } from "@/features/comms";

/**
 * Post-commit drain shared by the agenda routes that can enqueue schedule mail.
 * The outbox sweep runs only every fifteen minutes, so this is what turns
 * "within a tick" into "within about a second"; a missing Cloudflare context
 * (tests, `next dev`) is a no-op rather than an error.
 */
export function nudgeAfterEnqueue(): void {
  nudgeOutboxAfterCommit();
}
