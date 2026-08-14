# Jobs Worker

`sb-jobs` is a deliberately small scheduled dispatcher. Its only transport
is the `WEB_JOBS` account-scoped Service Binding to the matching web Worker's
named `JobsEntrypoint`; scheduled work does not traverse the public Internet.
The jobs Worker has no application variables or secrets. The entrypoint invokes
the closed job adapter inside the web Worker; the default/public Worker entrypoint
blocks that internal namespace before OpenNext routing, and the old
internet-addressable `/api/jobs/*` callbacks do not exist.

| Wrangler environment | Worker | Bound web Worker |
|---|---|---|
| local | `sb-jobs-local` | `sb-web-local` |
| preview | `sb-jobs-preview` | `sb-web-preview` |
| production | `sb-jobs` | `sb-web` |

One cron runs every minute. `outbox` runs each tick, `reminders` at minutes
divisible by 15, and `cleanup` at 09:00 UTC. During the finite version-1 R2
staging migration, the separate `r2-migration` job also runs each tick so its
copy/checksum/inventory checkpoint converges before legacy parsing is removed;
the compatibility-removal release removes that temporary job. Airtable remains
deferred and is not part of the RPC contract. A missed tick self-heals on the
next one because every real job is an idempotent bounded database scan.

Each RPC call has a 120-second caller-side deadline. Every due sibling is allowed to settle,
then the aggregate `waitUntil()` promise rejects if any request failed.
Cloudflare therefore records a failed Cron Trigger invocation instead of a false success. Dispatcher
logs contain only the job name, transport, HTTP status, and duration; the web Worker captures the
raw error once through the application error-tracking seam, and the dispatcher never reads or
copies a response body into its logs.

Local scheduled test with both Worker configs and the Service Binding connected
(the OpenNext artifact must already exist):

```bash
pnpm build:worker
pnpm exec wrangler dev -c workers/jobs/wrangler.jsonc -c wrangler.jsonc --test-scheduled
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

Deploy web first, then run `pnpm deploy:jobs:preview` or `pnpm deploy:jobs:production`.
Confirm successful invocations in **Workers & Pages → `sb-jobs[-preview]` → Triggers → Past
Events**, and correlate them with `scheduled.job_complete` RPC entries. A failed Past Events
status, `scheduled.job_failed`, or `scheduled.job_request_failed` is actionable; see
`docs/runbooks/alerting.md`.
