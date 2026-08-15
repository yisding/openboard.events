import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "./scripts/open-next-sharded-tag-cache.mjs";

// The adapter's concrete sharded-cache class carries its entire DO RPC type
// graph. The adjacent runtime/type shim preserves OpenNext's ordinary ESM
// bundle while exposing only the small factory contract application typechecks
// need; the OpenNext build validates the implementation itself.

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  // Time-based ISR must deduplicate across isolates, and on-demand
  // revalidation needs durable tag timestamps. One shard per soft/hard tag
  // class is sufficient for this event-scoped public site and minimizes DO
  // requests on the Workers Free plan.
  queue: doQueue,
  tagCache: doShardedTagCache({ baseShardSize: 1 }),
});
