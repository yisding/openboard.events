# Public cache contract

OpenBoard's public event pages use Next.js ISR on the Cloudflare Worker. The
incremental entries live in the environment's R2 bucket under
`NEXT_INC_CACHE_R2_PREFIX`; this is a cache, not the source of record.

## Platform ownership

OpenNext's three cache roles are configured explicitly:

- the R2 incremental cache stores ISR pages and cached data;
- `DOQueueHandler` deduplicates time-based revalidation across Worker isolates;
- `DOShardedTagCache` stores on-demand tag/path invalidation timestamps.

The queue and tag cache use SQLite-backed Durable Objects, which are available
on the Workers Free plan. Local, preview, and production Workers each bind their
own namespaces. Wrangler bindings are deliberately repeated under every named
environment because Durable Object bindings are not inherited.

Cache interception, the regional cache, and Cache API purging remain disabled.
There is therefore no outer cache that can serve an entry after the incremental
and tag caches declare it stale.

## Freshness and recovery

Public pages currently retain their 60-second route revalidation bound. A
mutation requests on-demand invalidation; if that signal fails, the time bound
is the recovery path rather than the normal consistency mechanism. Domain tags
and per-surface service levels are layered on this durable foundation.

Deployment is additive: preview creates the two SQLite namespaces first and
proves a warm/mutate/read cycle before production promotion. If the distributed
components fail, roll the application back to the memory queue and dummy tag
cache while leaving the bindings and empty namespaces in place. Do not publish
a Durable Object deletion migration during incident rollback; remove a class
only after no deployed version references it.
