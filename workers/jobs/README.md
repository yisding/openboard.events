# Jobs Worker

`sb-jobs` is a deliberately small scheduled dispatcher. Its primary transport
is the `WEB_JOBS` account-scoped Service Binding to the matching web Worker's
named `JobsEntrypoint`; scheduled work does not traverse the public Internet.

During the compatibility release, `APP_BASE_URL` and `CRON_SECRET` remain on
the jobs Worker only as a rollback adapter for an older web deployment that
does not expose the named entrypoint. A valid job response, including HTTP 500,
is never replayed through the fallback.

| Wrangler environment | Worker | Bound web Worker |
|---|---|---|
| local | `sb-jobs-local` | `sb-web-local` |
| preview | `sb-jobs-preview` | `sb-web-preview` |
| production | `sb-jobs` | `sb-web` |

One cron runs every minute. `outbox` runs each tick, `reminders` at minutes divisible by 15, and cleanup at 09:00 UTC. Airtable is deliberately not scheduled while M39 remains deferred: its route is only a contract stub, and a no-op must not look like successful production work. A missed tick self-heals on the next one because every real job is an idempotent bounded database scan.

Each downstream request has a 120-second deadline. Every due sibling is allowed to settle, then the aggregate `waitUntil()` promise rejects if any request failed. Cloudflare therefore records a failed Cron Trigger invocation instead of a false success. Dispatcher logs contain only the job name, transport, HTTP status, and duration; the web Worker captures the raw error once through the application error-tracking seam, and the dispatcher never reads or copies a response body into its logs.

Local scheduled test with both Worker configs and the Service Binding connected
(the OpenNext artifact must already exist):

```bash
pnpm build:worker
pnpm exec wrangler dev -c workers/jobs/wrangler.jsonc -c wrangler.jsonc --test-scheduled
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

Compatibility-adapter proof while it remains deployed (never paste the real
secret into this file):

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/jobs/outbox"
curl -i -X POST "$APP_BASE_URL/api/jobs/outbox" # must return 401
```

Deploy web first, then run `pnpm deploy:jobs:preview` or `pnpm deploy:jobs:production`. Confirm at least three consecutive successful invocations in **Workers & Pages → `sb-jobs[-preview]` → Triggers → Past Events**, and correlate each with `scheduled.job_complete` entries whose transport is `rpc`. Any `public-fallback`, failed Past Events status, `scheduled.job_failed`, or `scheduled.job_request_failed` entry blocks removal of the compatibility adapter; see `docs/runbooks/alerting.md`.
