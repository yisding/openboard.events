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

All public pages retain a 60-second route and data revalidation bound. A
successful mutation is expected to appear on the next request across Worker
isolates within 10 seconds. If its on-demand signal fails, 60 seconds is the
recovery bound rather than the normal consistency mechanism.

| Public data | Canonical routes | Embed routes | Domain tag | Normal / recovery budget |
| --- | --- | --- | --- | --- |
| Event metadata and branding | every `/e/[slug]/**` surface | every enabled or disabled `/embed/[slug]/**` surface | `public:event:<eventId>:metadata` | 10 s / 60 s |
| Published schedule | agenda, sessions, itinerary | agenda, sessions, itinerary | `public:event:<eventId>:schedule` | 10 s / 60 s |
| Published speakers and headshots | speakers, gallery | speakers, gallery | `public:event:<eventId>:speakers` | 10 s / 60 s |
| Embed kill switch, style, and filters | n/a | one tag per canonical embed content type | `public:event:<eventId>:embed:<contentType>` | 10 s / 60 s |

The `/f/<fileId>` response is immutable. Asset freshness therefore means that
a logo, background, or headshot mutation stores a new file id and invalidates
the event or speaker data tag; cached HTML then points at the new immutable
object. Published objects themselves are never purged or overwritten.

Writers emit event-scoped domain invalidations. Session, placement, published
speaker, committed speaker CSV import, vocabulary, CFP/profile-writeback, and
erasure changes emit schedule and speaker tags as appropriate. Preview-only
CSV imports do not invalidate. Event detail/branding changes emit the shared
metadata tag. Embed settings emit only their content-type tag. No writer knows
or enumerates `/e` or `/embed` route aliases.

Deployment is additive: preview creates the two SQLite namespaces first, then
the deployed cache proof warms every alias, mutates through an authenticated
application route, and requires the new value inside the 10-second budget. If
the distributed components fail, roll the application back to the memory queue
and dummy tag cache while leaving the bindings and empty namespaces in place.
Do not publish a Durable Object deletion migration during incident rollback;
remove a class only after no deployed version references it.
