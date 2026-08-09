# Platform & Integrations Design — openboard

Owner: platform/integrations architect. This document is subordinate to `PLAN.md` and uses
the canonical environment inventory in [`../environments.md`](../environments.md). Module
work orders own implementation detail; this file owns the cross-service boundaries.

## 0. Binding decisions

1. The repository is one Next.js app at the root. It is not a workspace or monorepo.
2. There are two Cloudflare deployables: `sb-web` and `workers/jobs` (`sb-jobs`).
3. `sb-web` owns every application capability, including DB queries, R2 access, Resend, ICS,
   and Airtable. `sb-jobs` is a dumb scheduled HTTP trigger with zero app imports.
4. The jobs worker runs one `* * * * *` cron and POSTs secret-guarded
   `/api/jobs/{outbox|reminders|airtable|cleanup}` routes on the web worker.
5. The app starts on Workers Free. Workers Paid is a measured fallback, not a prerequisite.
6. Runtime data lives in three Neon databases: `sb-dev`, `sb-test`, and `sb-prod`.
7. R2 buckets are isolated between preview and production.
8. Outbound email is sent only by the comms dispatcher running inside `sb-web`.

## 1. Runtime topology

```text
/
├── src/                         Next.js UI, route handlers, features, DB and shared code
├── drizzle/                     SQL migrations
├── scripts/                     seed, migration and invariant tooling
├── workers/jobs/                scheduled HTTP trigger; no application imports
├── wrangler.jsonc               sb-web local + named preview/production environments
├── open-next.config.ts          OpenNext cache configuration
└── .github/workflows/           validation and, when added, protected deployment
```

`sb-web` contains the application job functions. Domain writes enqueue durable
`communication_logs` rows in the same transaction as the state transition. The jobs worker
only wakes the matching web routes; Postgres supplies durable state and idempotency.

This boundary prevents generated OpenNext code from needing a custom `scheduled()` wrapper
and prevents the jobs worker from receiving database, R2, email, session, or Airtable
credentials.

## 2. Cloudflare Workers and OpenNext

### 2.1 Plan selection and measurable limits

Workers Free currently allows a 3 MB compressed Worker and 10 ms of CPU per request;
Workers Paid allows a 10 MB compressed Worker and a much larger CPU allowance. The current
scaffold's `wrangler deploy --dry-run` output is `1122.48 KiB` gzip, so payment is not a
current deployment requirement.

Policy:

- start on Workers Free;
- warn when the compressed artifact reaches 2.5 MB;
- measure deployed SSR, auth, and database routes rather than assuming they fit 10 ms;
- upgrade before judge deployment if bundle or CPU evidence approaches a Free limit;
- after upgrading, warn at 8 MiB beneath the Paid 10 MB limit.

Cron Triggers, R2, two workers, and this project's expected traffic fit their Free
allowances. A Workers Paid subscription is independent of Cloudflare's Free/Pro/Business
zone plans.

### 2.2 Runtime constraints

| Constraint | Design response |
|---|---|
| Workers runtime, not a Node server | `nodejs_compat`; no native addons, `sharp`, bcrypt, node-canvas, or TCP-only clients |
| No long-lived process or reliable memory queue | Postgres outbox + idempotent cron scans; `ctx.waitUntil` is a latency nudge only |
| Runtime bindings are not ambient `process.env` | One lazy, zod-validated `getEnv()` accessor; no other `src/**` file reads `process.env` |
| OpenNext-generated bundle can grow late | Exact dependency pins, Worker build in CI, and measured gzip budget |
| Default Next image optimization has no backend here | `images.unoptimized=true`; client downscale and R2 storage |
| Worker responses are not automatically correctness-safe caches | Authenticated and mutable surfaces are `force-dynamic`; cache only published reads |
| `runtime='edge'` selects the wrong Next runtime path | Repo-wide invariant forbids it |

### 2.3 Worker configuration

Canonical production web shape:

```jsonc
{
  "name": "sb-web",
  "main": ".open-next/worker.js",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "r2_buckets": [
    { "binding": "FILES", "bucket_name": "sb-files" },
    { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "sb-files" }
  ],
  "observability": { "enabled": true },
  "vars": { "APP_BASE_URL": "https://<actual-web-host>", "EMAIL_MODE": "send" }
}
```

Canonical production jobs shape:

```jsonc
{
  "name": "sb-jobs",
  "main": "index.ts",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["* * * * *"] },
  "observability": { "enabled": true },
  "vars": { "APP_BASE_URL": "https://<actual-web-host>" }
}
```

Preview uses `sb-web-preview`, `sb-jobs-preview`, and `sb-files-preview`. Exact deployed URLs
must be copied from Wrangler output; a guessed `<account>.workers.dev` hostname is not valid
configuration. See `environments.md` for the complete inventory and placement.

### 2.4 Caching and framing

- Admin, portal, CFP, auth, job routes, and every mutation are `force-dynamic` and private.
- Public schedule, speakers, embeds, and published JSON may use
  `s-maxage=60, stale-while-revalidate=300` after an event-scoped cache test proves isolation.
- State-changing deadline and submission-limit checks always execute in the DB transaction.
- `/embed/*` receives `Content-Security-Policy: frame-ancestors *` and no
  `X-Frame-Options`; all other app pages use `X-Frame-Options: DENY`.
- Time-based OpenNext R2 incremental caching is spike-gated. The fallback is force-dynamic
  public HTML plus a small `caches.default` wrapper for published JSON/embed responses.

## 3. Environments and deployment

The canonical matrix is:

| Environment | Database | Workers | Bucket | Email |
|---|---|---|---|---|
| local | `sb-dev` | local dev servers | local R2 or `sb-files-dev` spike bucket | `log` |
| preview/test | `sb-test` | `sb-web-preview` + `sb-jobs-preview` | `sb-files-preview` | `log`, or allowlisted test send |
| production/judge | `sb-prod` | `sb-web` + `sb-jobs` | `sb-files` | `send`, no allowlist |

Deployment order is migrate with `DATABASE_URL_DIRECT` → deploy web → deploy jobs → run
post-deploy smoke. Deploying web before jobs prevents a new cron route from targeting an old
web artifact. Migrations remain additive/backward-compatible while either old worker version
may still receive traffic.

CI validation order is clean install → generated Wrangler types → typecheck/lint/invariants
→ unit/PGlite tests → Next build → OpenNext build + gzip measurement → Playwright against
the isolated preview and `sb-test`. Production deploy credentials live in a protected GitHub
environment, not ordinary workflow variables.

## 4. Neon and database access

- `DATABASE_URL` is the pooled runtime endpoint used by `sb-web`.
- `DATABASE_URL_DIRECT` is local/CI migration-only and is never installed on a Worker.
- `NEON_TEST_URL` belongs to GitHub Actions and targets only `sb-test`.
- `neon-http` handles reads and single-statement writes.
- WebSocket `Pool` transactions are confined to the audited `withTx()` paths named in
  `PLAN.md`; a pool is created and closed per request.
- Corrected migrations apply to a disposable database first, then `sb-dev`, `sb-test`, and
  `sb-prod`.
- Test/seed reset commands must refuse a production target.

## 5. File storage on R2

### 5.1 Bindings and credentials

`FILES` serves, HEAD-checks, and deletes objects through the Worker binding.
`NEXT_INC_CACHE_R2_BUCKET` is the OpenNext cache binding. Browser direct uploads require
bucket-scoped S3 credentials on `sb-web` so the app can sign requests; those credentials do
not belong on `sb-jobs`.

Within an environment, `FILES`, `NEXT_INC_CACHE_R2_BUCKET`, and `R2_BUCKET_NAME` must name
the same bucket. Preview and production never share a bucket or S3 credentials.

### 5.2 Object and access policy

Keys are server-generated and event-scoped:

```text
events/{eventId}/{kind}/{uuid}/{sanitizedFilename}
```

| Kind | Visibility | Maximum | Allowed types |
|---|---|---:|---|
| logo/background | public | 5 MB | PNG, JPEG, WebP |
| headshot | public | 5 MB | PNG, JPEG, WebP |
| slide | private | 100 MB | PDF, PPT, PPTX |
| attachment/upload | private by default | 25 MB | request-policy allowlist |

The app creates a pending upload, returns a short-lived presigned PUT, and finalizes only
after a binding HEAD verifies existence and size. Image finalization also checks magic
bytes. A passed finalize creates/marks the `file_assets` record ready; failures delete or
reject the object. Direct browser upload CORS allows exact environment origins, `PUT, GET`,
and `content-type`.

Public `/f/{fileId}` responses use the server-validated MIME type, `nosniff`, and immutable
cache headers. Private downloads require event/contact authorization and a short-lived GET.
The cleanup job removes abandoned pending objects in bounded batches.

## 6. Email, scheduling, and Resend

### 6.1 Single send path

Only `src/features/comms/server/resend.ts` may call Resend. It runs inside `sb-web` when
`POST /api/jobs/outbox` dispatches rows. Domain features never send directly: they insert a
`communication_logs` outbox row through `enqueueEmail()` in the same transaction as the
domain change.

`EMAIL_MODE=log` renders and persists a send without contacting Resend. `EMAIL_MODE=send`
contacts Resend; if an allowlist exists, nonmatching recipients are permanently skipped.
Production uses real send with no allowlist. `EMAIL_FALLBACK_UI` is local/preview-only and
never weakens production OTP verification.

### 6.2 Outbox and cron

The jobs worker uses UTC minute modulo:

- outbox every minute;
- reminders/task-assigned every 15 minutes;
- Airtable every 10 minutes only when the deferred bonus is enabled;
- cleanup once daily.

It POSTs the relevant web routes with `x-cron-secret: <CRON_SECRET>`. Both workers receive
the same `CRON_SECRET` within an environment, and preview/production secrets differ.

The dispatcher claims bounded batches with `FOR UPDATE SKIP LOCKED`, lock expiry, retry
backoff, and unique idempotency keys. It rebuilds context from entity IDs and rechecks truth
at send time. Reminder scans derive eligible assignments from the live views and insert only
the latest eligible rung, permanently skipping superseded rungs.

### 6.3 Templates and delivery proof

There are eight fixed keys: seven domain templates plus `portal_login`. Subjects and bodies
accept only validated `{{dot.path}}` variables. Values are escaped, organizer-authored HTML
is sanitized on save, missing values fail loudly, and the rendered subject/body are stored
before the provider call.

Resend setup is not complete when its dashboard says “verified.” CP1 requires a production
sender probe whose Gmail `Authentication-Results` shows aligned SPF, DKIM, and DMARC passes.
CP4 requires fresh Gmail and Outlook OTP delivery and the invite lifecycle below.

## 7. Calendar invites

- Generate RFC 5545 in a small pure module using UTC `Z` timestamps, CRLF lines, escaping,
  and 75-octet folding. Do not add an ICS package or VTIMEZONE.
- Keep one stable UID per `(contact, session)` and increment SEQUENCE on each change.
- REQUEST/CANCEL includes exactly one ATTENDEE matching the message recipient.
- Stamp the organizer email on first send and reuse it byte-for-byte for that UID.
- Attach `invite.ics` and provide Google, Outlook, tokenized download, and per-speaker feed
  links.
- Tokenized routes verify purpose, contact, event, expiry, and current access; raw bearer
  tokens are never logged or stored.
- Prove REQUEST → reschedule/update-in-place → CANCEL in real Gmail and Outlook clients.

## 8. Airtable export (deferred bonus)

M39 stays paused until the server-backed judging loop is green. When enabled, `sb-web`
performs one-way, idempotent export through `fetch`; the jobs worker only triggers the route.
Use an Airtable personal access token scoped to record writes and schema reads. Export
Speakers, Submissions, Sessions, Task Status, and Comms Log in batches of 10, at no more
than four requests/second, keyed by `PG ID` with content-hash skipping and a persisted
watermark. Re-verify `performUpsert` merge behavior against the provisioned base before
writing sync code.

## 9. Public API (deferred bonus)

- Version under `/api/v1`.
- Unkeyed routes expose only the published schedule/speaker read models.
- Private routes use event-scoped, hashed API keys with explicit scopes; there is no global
  `OPENBOARD_API_KEY`.
- Public GETs may be cached only after event isolation is proven. Keyed/private responses
  are `private, no-store` and never vary security solely by a cache-ignored header.
- CORS allowlists origins; write methods are out of scope.

## 10. Provisioning and verification checklist

1. Build OpenNext and record the Wrangler dry-run gzip size.
2. Deploy `sb-web-preview`; prove `/api/health` performs a real `sb-test` round-trip.
3. Deploy `sb-jobs-preview`; prove correct secret returns 200 and wrong/missing secret 401.
4. Run the deployed `withTx`, sanitizer, auth, Resend-idempotency, cache, presigned-R2/CORS,
   PGlite-schema, embed-header, and preview-URL spikes recorded in M01.
5. Install the inventory from `environments.md` with separate preview/production values.
6. Prove R2 MIME/size/finalize behavior and public/private serving headers.
7. Prove Resend authentication alignment and the Gmail/Outlook calendar lifecycle.
8. Run post-deploy security smoke: event isolation, no test auth in production, private
   no-store responses, scoped calendar tokens, and job-route secret checks.

## 11. Scope walls

No Queues, Workflows, Durable Objects, D1, service bindings, calendar OAuth, WebSockets/SSE,
server-side image processing, per-agent permanent databases, or custom domain is required
for the minimum hackathon path. Add none of them while an earlier recovery gate is red.
