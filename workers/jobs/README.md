# Jobs Worker

`sb-jobs` is a deliberately small scheduled dispatcher. Its only transport
is the `WEB_JOBS` account-scoped Service Binding to the matching web Worker's
named `JobsEntrypoint`; scheduled work does not traverse the public Internet.
The jobs Worker's only application variable is `AIRTABLE_CRON`, read by the
dispatcher itself before it ever calls `WEB_JOBS` (see below). It carries no
secrets. The entrypoint invokes the closed job adapter inside the web Worker;
the default/public Worker entrypoint blocks that internal namespace before
OpenNext routing, and the old internet-addressable `/api/jobs/*` callbacks do
not exist.

| Wrangler environment | Worker | Bound web Worker |
|---|---|---|
| local | `sb-jobs-local` | `sb-web-local` |
| preview | `sb-jobs-preview` | `sb-web-preview` |
| production | `sb-jobs` | `sb-web` |

One cron runs every minute. `outbox` runs each tick, `reminders` at minutes
divisible by 15, `airtable` at `:05/:20/:35/:50` UTC (`minute % 15 === 5`,
deliberately staggered off `reminders`' tick), and `cleanup` at 09:00 UTC. A
missed tick self-heals on the next one because every real job is an
idempotent bounded database scan.

`airtable` syncs every connected event's Airtable base (one-way push, keyed
on the `Openboard ID` merge field so a redundant push can never duplicate a
record) and reaps any sync run left `running` past its lease. It is gated
behind `AIRTABLE_CRON`, read in the dispatcher (`workers/jobs/dispatch.ts`),
**not** inside the job route: with the flag unset or `"0"`, `jobsForScheduledTime`
never includes `"airtable"`, so `WEB_JOBS.runJob("airtable")` is never called,
no heartbeat is written, and `/api/health` correctly reports the integration
as never having run rather than as a false "fresh" success. The hand-curled
route below cannot undo that either: a tick whose stats say only
`airtableSkippedDisabled` is not heartbeat-worthy, so `definePrivateJobRoute`
returns it as a successful no-op without touching `scheduled_job_heartbeats`.
`AIRTABLE_CRON` ships `"1"` in every environment; it remains the kill switch
for scheduled sync — set it back to `"0"` in both wrangler configs in the
same deploy to pause cron pressure (see `docs/airtable.md`).
The event settings panel's manual "Sync now" button is unaffected either way;
it calls the sync engine directly and ignores this flag entirely.

`cleanup` is seven independent sweeps behind one job name — R2 orphans, the
data retention sweep, the stalled-file-export nudge, expired-export pruning,
operational-error pruning, `airtable_sync_runs` history older than 30 days,
and abandoned (tokenless-purpose, `pending`, 24h+ old) Airtable connections.
They settle rather than short-circuit: a tick that pruned four hundred rows
and failed one sweep reports the four hundred and names the sweep that
failed, instead of discarding both. The export nudge takes a bounded batch
and reports the remainder as deferred, so a backlog waits for the next tick
instead of running this one past its CPU budget.

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

That drives whatever the tick's own UTC clock says is due — the outbox always,
reminders on a quarter hour, airtable five minutes off the quarter hour
(`AIRTABLE_CRON` ships `"1"` on `workers/jobs/wrangler.jsonc`'s dev config), cleanup
at 09:00 — so it is not a way to run one job in isolation. For that, run the
web app with `pnpm dev` and call its private route directly; the entrypoint
that hides these paths is the deployed Worker's, not the Next route:

```bash
curl -X POST -H 'x-openboard-private-job: JobsEntrypoint' \
  http://localhost:3000/worker-jobs/airtable
```

Deploy web first, then run `pnpm deploy:jobs:preview` or `pnpm deploy:jobs:production`.
Confirm successful invocations in **Workers & Pages → `sb-jobs[-preview]` → Triggers → Past
Events**, and correlate them with `scheduled.job_complete` RPC entries. A failed Past Events
status, `scheduled.job_failed`, or `scheduled.job_request_failed` is actionable; see
`docs/runbooks/alerting.md`.
