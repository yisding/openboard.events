# Platform & Integrations Design — Sessionboard Clone (AI Engineer Hackathon)

Owner: platform/integrations architect. Consumers: every feature agent (event-config/CFP,
form-builder, speaker-portal, abstracts-review, agenda-embeds, dashboard-comms).
Deadline: Wed Aug 12, 10 PM PT. Stack is fixed: Next.js App Router + shadcn/Tailwind, Neon
Postgres, OpenNext on Cloudflare Workers, Zustand, TanStack Query, feature folders.

Everything here is a **decision**, not an option list. Items marked **NEEDS-VERIFY** are
version-sensitive and go on the Day-0 spike checklist (§10) — each has a named fallback so a
failed verify costs an hour, not a redesign.

---

## 0. Repo & runtime topology (the platform skeleton every agent builds inside)

```
/                          pnpm workspace, turbo optional (plain pnpm -r is fine)
├── apps/web               Next.js App Router app → built with @opennextjs/cloudflare,
│                          deployed as Worker "sb-web". ALL UI + server actions + API routes.
├── workers/jobs           Plain TypeScript Worker "sb-jobs" (wrangler, no framework).
│                          Owns: cron scheduled handler, outbox email dispatcher, reminder
│                          scan, Airtable sync, R2 orphan cleanup. Also exports a fetch
│                          handler with secret-guarded /run/* endpoints for on-demand runs.
├── packages/contracts     Zod schemas + enums + DTO types shared by ALL agents
│                          (submission status enum, Session/Speaker/Task DTOs, condition-rule
│                          shape, template variable contexts). No runtime deps besides zod.
├── packages/core          Shared runtime code (imported by apps/web AND workers/jobs):
│   ├── db/                drizzle schema + drizzle-orm client factories (neon-http + neon-ws)
│   ├── env.ts             typed AppEnv + zod validation + getEnv() accessor
│   ├── time.ts            THE ONLY timezone module (see §6.4)
│   ├── email/             template rendering, layout, outbox enqueue/dispatch
│   ├── ics.ts             hand-rolled RFC 5545 builder (see §6)
│   ├── storage.ts         R2 presign/finalize/serve helpers (see §4)
│   ├── airtable.ts        export client (see §7)
│   └── sanitize.ts        ONE html sanitizer for all rich text (rehype-sanitize allowlist)
└── .github/workflows/     CI (see §3.3)
```

Two deployables only. `sb-web` (the OpenNext worker) and `sb-jobs` (cron/queue-style work).
Both talk to the same Neon database and the same R2 bucket. **No service bindings between
them** — coupling is via Postgres rows (outbox/job tables) plus one shared-secret HTTP
endpoint for "run now" (§5.4). This keeps the OpenNext build artifact completely decoupled
from job scheduling, which is the single biggest de-risking decision in this doc: we never
have to graft a `scheduled` handler onto the generated `.open-next/worker.js` (possible, but
version-sensitive — see NEEDS-VERIFY-1 note in §1.4).

Cloudflare plan: **Workers Paid ($5)** from day 0. Buys: 10 MiB compressed worker size (vs
3 MiB free), 30 s CPU per invocation, higher limits everywhere. Non-negotiable given a Next
app's server bundle.

---

## 1. OpenNext on Cloudflare Workers — constraints, gotchas, how the design avoids them

Adapter: `@opennextjs/cloudflare` (latest stable at project start; pin exact version in
lockfile on day 0 and do not bump mid-hackathon). Next.js: latest 15.x stable that the
adapter's docs list as supported — **NEEDS-VERIFY (V1)**: check the adapter's supported
Next version matrix before `create-next-app`, and pin.

### 1.1 Hard constraints and how we live with them

| Constraint | Consequence | Our design response |
|---|---|---|
| Workers runtime, not Node. `nodejs_compat` polyfills most of `node:*` but native addons and some libs fail | sharp, bcrypt, node-canvas, anything with .node bindings are out | No server-side image processing (§4.5); Web Crypto for hashing/signing (`jose` for tokens); no bcrypt (magic-link auth, no passwords) |
| Worker bundle ≤ 10 MiB compressed (paid) | A fat server bundle fails deploy late and painfully | Server deps allowlist (§1.3); CI step fails the build if `.open-next` worker gz size > 8 MiB (early warning) |
| No long-lived processes, no `setInterval`, isolate may die after response | In-process schedulers and in-memory queues are impossible | All deferred work = Postgres outbox rows + `sb-jobs` cron (§5); post-response work uses `ctx.waitUntil` only for best-effort nudges, never for correctness |
| CPU limit 30 s/invocation (wall-clock is generous while awaiting I/O) | Big batch jobs can't run in one request | Every job processes bounded batches (50 emails, 300 Airtable records) with watermarks; next cron tick resumes |
| No raw TCP to Postgres (comfortably) | `pg` driver is wrong | `@neondatabase/serverless`: neon-http driver for single-statement queries (fast, stateless), neon WebSocket `Pool` for interactive transactions (submission-limit check, outbox claim). Pool created per-request, `ctx.waitUntil(pool.end())`. Neon **pooled** connection string (PgBouncer) for the WS driver |
| Bindings/env are not ambient `process.env` | Libraries reading `process.env` at import time break | Single accessor `getEnv()` in `packages/core/env.ts`: in web, wraps `getCloudflareContext().env`; in jobs, the `env` param. Zod-validated once, lazily. No other code touches env. (`initOpenNextCloudflareForDev()` in `next.config.ts` makes bindings work under `next dev`.) |
| Default Next image optimization has no backend on Workers | `next/image` 500s or no-ops | `images: { unoptimized: true }` globally + client-side downscale before upload (§4.5). Do NOT wire the Cloudflare Images loader (paid zone feature, config rabbit hole) |
| Responses generated by a Worker are NOT edge-cached automatically | "It's on Cloudflare so it's fast" is false for SSR | Explicit caching strategy §1.2; static assets (`/_next/static`, `public/`) are served via Workers Assets and cached properly out of the box |
| Do not set `export const runtime = 'edge'` anywhere | That's the Vercel edge runtime path; OpenNext runs the Node runtime on Workers | Lint rule (grep in CI) forbidding `runtime = 'edge'` |

### 1.2 Caching / ISR decision

The classic OpenNext-on-Cloudflare gotcha is ISR/revalidation. Decision — **two-tier, minimal
moving parts**:

1. **Everything authenticated or correctness-critical is `dynamic = 'force-dynamic'`**: all
   admin routes, speaker portal, the CFP wizard (deadline/limit state must never be stale),
   all POST/server actions. Neon over neon-http from a Worker is ~10–40 ms per query; SSR is
   fast enough without caching. This is the bug-resistant default.
2. **Public read-only surfaces use time-based ISR, revalidate = 60**: `/e/[slug]/schedule`,
   `/e/[slug]/speakers`, `/embed/*` variants, and the public JSON API (`Cache-Control:
   public, s-maxage=60, stale-while-revalidate=300` set directly on route-handler
   responses + Cache API wrapper, see below). 60 s staleness satisfies the brief's
   "auto-update" embeds and earns the speed bonus.

Configuration for tier 2: `open-next.config.ts` with the **R2 incremental cache** override
(bucket binding `NEXT_INC_CACHE_R2_BUCKET` on the same bucket, separate prefix) and the
**in-memory revalidation queue**. We use **time-based revalidate only — no `revalidateTag`,
no `revalidatePath`** — so we need **no D1 tag cache and no Durable Object queue**. Memory
queue's per-isolate duplication risk only means an occasional duplicate regeneration, which
is harmless.

**NEEDS-VERIFY (V2)**, day 0: deploy a page with `export const revalidate = 60` and confirm
it regenerates on the deployed worker (exact override import paths from the adapter docs for
our pinned version). **Fallback** (1 hour): drop ISR entirely; make tier-2 pages
force-dynamic and wrap only the JSON API + embed routes in a 20-line `withEdgeCache(handler,
{ttlSeconds})` util using `caches.default` keyed on URL. Public HTML then costs one Neon
round-trip — still comfortably fast.

Judge-facing correctness rule regardless of tier: any *state-changing* check (form open,
deadline, submission limit) happens in the POST handler against the DB. Caching can only ever
make a *page shell* stale, never accept a late submission.

### 1.3 Bundle-size discipline (server allowlist)

Client-only (dynamic import, never in server graph): TipTap, dnd-kit, recharts/charts, any
zip lib. Banned entirely: moment/moment-timezone, `airtable` npm SDK (old, callback-based,
heavy — we use fetch, §7), `xlsx` (CSV only), `ical-generator` (+tz plugins; we hand-roll,
§6), lodash (use lodash-es per-fn or nothing). Server deps that are fine: drizzle-orm,
@neondatabase/serverless, zod, jose, date-fns + date-fns-tz (pure JS), aws4fetch (~2 KB),
rehype/unified sanitize chain.

### 1.4 wrangler configuration (both workers)

`apps/web/wrangler.jsonc` (shape; exact keys per adapter docs at pinned version —
**NEEDS-VERIFY V1** covers this):

```jsonc
{
  "name": "sb-web",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-06-01",            // any recent date; ≥2024-09-23 required for modern nodejs_compat
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "r2_buckets": [
    { "binding": "FILES", "bucket_name": "sb-files" },
    { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "sb-files" } // prefix-isolated by adapter
  ],
  "observability": { "enabled": true },
  "vars": { "APP_BASE_URL": "https://sb-web.<acct>.workers.dev", "EMAIL_MODE": "send" }
}
```

`workers/jobs/wrangler.jsonc`:

```jsonc
{
  "name": "sb-jobs",
  "main": "src/index.ts",
  "compatibility_date": "2025-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["* * * * *"] },        // ONE cron; internal minute-modulo dispatch (§5.4)
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "sb-files" }],
  "observability": { "enabled": true }
}
```

One cron expression sidesteps the per-worker cron-count limit entirely (limit is small —
around 3 — **not worth verifying** because the modulo design doesn't care).

Note on the road not taken: the adapter does support wrapping the generated worker with a
custom entrypoint that adds `scheduled`/`queue` handlers to `sb-web` itself. We deliberately
don't — it couples cron code to the OpenNext build output shape, which is the most
version-churned part of the adapter. Separate worker = plain, boring, stable.

### 1.5 Framing headers (embeds) — set here because it's a platform header concern

In `next.config.ts` `headers()`:
- `/embed/:path*` → `Content-Security-Policy: frame-ancestors *` and **no** X-Frame-Options.
- Everything else → `X-Frame-Options: DENY`, plus standard security headers.
The auto-resize snippet (`public/embed.js`, ~30 lines: injects iframe, listens for
`postMessage({type:'sb:height'})`) is a static asset; the embed layout posts its height on
resize via `ResizeObserver`.

### 1.6 Local dev → preview → prod pipeline

- **Local**: `pnpm dev:web` = `next dev` (with `initOpenNextCloudflareForDev()` bindings via
  miniflare — R2 binding is a local simulation; presigned-URL code paths need `--remote` or
  the real bucket, so storage dev uses a `sb-files-dev` bucket with real credentials).
  `pnpm dev:jobs` = `wrangler dev` on workers/jobs (`--test-scheduled` lets you hit
  `/__scheduled?cron=*+*+*+*+*` to fire the cron locally).
- **Worker-runtime smoke test**: `pnpm preview` = `opennextjs-cloudflare build && wrangler
  dev` on the built output — run before any deploy that touches server code paths; this is
  where "works in next dev, breaks in workerd" bugs surface.
- **Prod deploy**: `pnpm deploy:web` = `opennextjs-cloudflare build && wrangler deploy`;
  `pnpm deploy:jobs` = `wrangler deploy` in workers/jobs. Deployed to `*.workers.dev`
  subdomains (fine for judging; custom domain optional on the last day, never earlier — DNS
  changes near a deadline are self-harm; EXCEPT the email domain, §5.1, day 0).
- **Preview URLs per PR**: `wrangler versions upload` produces a preview URL for `sb-web`
  without touching prod traffic. **NEEDS-VERIFY (V3)** that the OpenNext artifact behaves on
  version preview URLs (it's just a worker, expected yes). Fallback: a second worker
  `sb-web-staging` deployed from main; PRs deploy there. With 4.5 days and mostly-parallel
  agents merging to main, staging-on-main is honestly the primary flow; per-PR previews are
  gravy.

### 1.7 Database lifecycle

- Drizzle ORM + drizzle-kit. Migrations are SQL files in `packages/core/db/migrations`,
  generated by `drizzle-kit generate`, applied by `drizzle-kit migrate`.
- Two Neon databases: `sb-dev` (everyone shares; agents seed freely) and `sb-prod`.
  No per-PR Neon branches — ceremony we don't need this week.
- CI applies migrations to prod **before** deploying workers (§3.3 order: migrate → deploy
  jobs → deploy web). Migrations must be additive/back-compatible during the hackathon
  (drop/rename only via a follow-up migration after both workers are deployed).
- Neon settings for judging week: **disable scale-to-zero** (suspend timeout = 0/off) on
  `sb-prod`, min compute 0.25 CU. Kills the ~500 ms cold-start that would otherwise eat the
  speed-bonus first impression.

---

## 2. Environment & secrets

### 2.1 The one accessor

`packages/core/env.ts` defines `AppEnv` (zod-validated). Nothing else reads env vars or
bindings. Web gets it from `getCloudflareContext().env`; jobs from the handler's `env` arg.
Local dev: `.dev.vars` in each deployable (gitignored, `.dev.vars.example` committed).
Prod: `wrangler secret put` per worker (secrets must be set on BOTH workers where used).

### 2.2 Full variable/binding inventory

| Name | Kind | Used by | Purpose |
|---|---|---|---|
| `DATABASE_URL` | secret | web, jobs | Neon **pooled** connection string (PgBouncer endpoint) |
| `DATABASE_URL_DIRECT` | secret | CI only | Neon direct (non-pooled) URL for drizzle-kit migrate |
| `SESSION_SECRET` | secret | web | HMAC key for session cookies + magic-link tokens (jose HS256) |
| `RESEND_API_KEY` | secret | jobs (sender), web (nothing — web only enqueues) | Resend API |
| `EMAIL_FROM` | var | jobs | e.g. `AI Engineer CFP <cfp@mail.example.dev>` — must be on the verified domain |
| `EMAIL_MODE` | var | jobs | `send` \| `log`. `log` marks outbox rows sent without calling Resend (dev/seed safety) |
| `EMAIL_ALLOWLIST` | var | jobs | Optional comma list; if set, recipients not matching → status `skipped`. Set on dev, empty on prod |
| `AIRTABLE_API_KEY` | secret | jobs | Personal access token, scopes: `data.records:write`, `schema.bases:read` (+ `schema.bases:write` if provision script used) |
| `AIRTABLE_BASE_ID` | var | jobs | Target base |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | secret | web | S3-compat credentials for presigning only (uploads/downloads never proxy through us) |
| `R2_BUCKET_NAME` | var | web | `sb-files` (`sb-files-dev` in dev) |
| `JOBS_RUN_SECRET` | secret | web, jobs | Bearer token guarding `sb-jobs` `/run/*` endpoints |
| `APP_BASE_URL` | var | web, jobs | Absolute URL for links in emails/ICS/embeds |
| `FILES` | R2 binding | web, jobs | Streaming serve (§4.4), finalize HEAD checks, orphan cleanup |
| `NEXT_INC_CACHE_R2_BUCKET` | R2 binding | web | OpenNext ISR cache (drop if V2 fallback taken) |
| `ASSETS` | assets binding | web | OpenNext static assets |

`wrangler types` generates `Env` interfaces for both workers in CI; type drift between
wrangler.jsonc and code fails the build.

---

## 3. External services: failure modes & fallbacks

### 3.1 Service table

| Service | Used for | Failure mode | Blast radius | Fallback / mitigation |
|---|---|---|---|---|
| Cloudflare Workers | All compute | Platform outage (rare) | Total | None needed; accept. Keep `wrangler rollback` ready (previous versions retained) |
| Neon Postgres | Primary store | Outage; connection exhaustion; cold start | Total (by design — single source of truth) | Pooled endpoint + per-request pools; scale-to-zero disabled for judging; that's the whole budget. No cross-DB fallback |
| Cloudflare R2 | Files (headshots/slides/logos), ISR cache | Presign clock skew; CORS misconfig; outage | Uploads/serving degrade; app core unaffected | Upload errors surface inline with retry; serving route returns placeholder avatar on miss; ISR cache failure → page renders dynamically (adapter falls through) |
| Resend | All outbound email | 4xx (bad payload/domain), 429, 5xx, suppression | Emails delayed — never lost | Outbox retries w/ exponential backoff (§5.3); comms log UI proves send state to judges; `EMAIL_MODE=log` for demos without sends; DKIM/SPF verified day 0 |
| Airtable | Bonus one-way export | 429 (5 rps), schema drift, token expiry | Zero user-facing impact | Sync is async, idempotent, watermark-resumable; failures recorded on `airtable_sync_state` and shown in admin ("last sync 12:04, 3 errors"); app never waits on it |
| Cloudflare Cron | Outbox drain, reminders, sync | Missed/late tick | Emails/reminders late by minutes | Every job is an idempotent scan over DB state ("what is due and unsent?"), so a missed tick self-heals on the next one. `/run/*` manual trigger as belt-and-braces |
| GitHub + Actions | CI/CD | Actions outage near deadline | Can't deploy | All deploy commands runnable from a laptop (`pnpm deploy:*` with `CLOUDFLARE_API_TOKEN` in local env). Practice once |
| Cloudflare Turnstile (optional) | CFP spam guard | Widget fails | Public form friction | Fail-open: if token verify errors, accept submission and flag it. Only add if time remains |

### 3.2 Deliverability specifics (judges WILL test with real inboxes)

- Day 0: add sending domain to Resend, publish SPF/DKIM/DMARC DNS records, verify. Send
  test invites to a Gmail and an Outlook.com account (pairs with V5, §6).
- From address on the verified domain; `reply-to` an organizer address.
- Every email has a plain-text part (§5.5) — spam-score hygiene.
- Comms log UI (dashboard-comms area) shows provider message id + status per send, so a
  spam-foldered email is provably "sent", not a bug.

### 3.3 CI (GitHub Actions, single workflow)

PR: install → `wrangler types` + typecheck → vitest (contracts, ics, condition evaluator,
template renderer, conflict engine are the unit-test hotspots) → `opennextjs-cloudflare
build` (catches bundle/compat breakage) → optional `wrangler versions upload` preview.
Main: all of the above → `drizzle-kit migrate` against `DATABASE_URL_DIRECT` →
`wrangler deploy` sb-jobs → `opennextjs-cloudflare build && wrangler deploy` sb-web.
Secrets in GH: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL_DIRECT`. ~40 lines of YAML; no
environments/approvals ceremony.

---

## 4. File storage on R2

One bucket (`sb-files`), one metadata table (`file_asset`), one module
(`packages/core/storage.ts`). Feature agents never touch R2 APIs directly.

### 4.1 Object key scheme

`evt_{eventId}/{kind}/{fileId}/{sanitizedFilename}` — fileId is a UUID; filename sanitized
(NFC-normalize, strip path separators/control chars, ≤128 chars, keep extension). Keys are
unguessable (UUID segment) but authorization never relies on that.

### 4.2 Kind policy table (enforced server-side at presign AND finalize)

| kind | mime allowlist | max size | access |
|---|---|---|---|
| `logo`, `background` | image/png, jpeg, webp, svg *(svg served with `Content-Disposition: attachment`? No — svg allowed but sanitized is a rabbit hole → **svg excluded**, png/jpeg/webp only)* | 5 MB | public |
| `headshot` | image/png, jpeg, webp | 5 MB | public (gallery) |
| `slide` | pdf, ppt(x), key, zip | 100 MB | private (speaker owner + organizers) |
| `attachment` (CFP/file-request docs) | pdf, png, jpeg, docx, zip | 25 MB | private |

### 4.3 Upload flow — presigned PUT, never through the Worker

1. Client calls server action `createUpload({eventId, kind, filename, mime, sizeBytes, ownerRefs})`.
2. Server validates against the policy table + caller's authz; inserts `file_asset` row
   `status='pending'`; presigns a **PUT** URL with `aws4fetch` (15-min expiry, Content-Type
   signed into the request).
3. Client `PUT`s the file directly to R2 (progress via XHR), then calls
   `finalizeUpload(fileId)`.
4. Server HEADs the object via the `FILES` binding: exists, size ≤ policy (the authoritative
   size check — we do not rely on presign constraining length), and for images sniffs magic
   bytes via a ranged GET (first 16 bytes). Pass → `status='ready'`; fail → delete object,
   `status='rejected'` with reason.

Bucket CORS (set day 0 via `wrangler r2 bucket cors put`): allow `PUT,GET` from
`APP_BASE_URL` + `http://localhost:3000`, headers `content-type`, max-age 3600. Forgetting
CORS is the #1 "uploads mysteriously fail only in the browser" trap.

**NEEDS-VERIFY (V4)**: aws4fetch-presigned PUT against R2 from a browser including the
Content-Type signed header (10-minute spike). Fallback: proxy uploads ≤25 MB through a route
handler using the R2 binding (fine on paid plan request-body limits) and keep presign only
for slides; worst case slides also proxy (100 MB < paid body limit) at some CPU cost.

Orphans: `sb-jobs` nightly task deletes `pending` rows older than 24 h + their objects.

### 4.4 Serving

- **Public kinds** (`logo`, `background`, `headshot`): `GET /f/{fileId}/{filename}` route
  handler in web → authz-free for public kinds → streams from `FILES` binding with
  `Cache-Control: public, max-age=31536000, immutable` + ETag. File contents are immutable
  by construction: "replace headshot" creates a NEW fileId and repoints the profile column —
  so aggressive caching is always correct and gallery/embeds are fast.
- **Private kinds**: server action `getDownloadUrl(fileId)` → authz check
  (`canReadFile(session, file)` — organizers of the event; owning speaker; task-scoped) →
  presigned GET, 1-h expiry. Admin "download all files" bundles are OUT of platform scope
  (feature agents may add client-side zip from individual URLs; no server zip streaming).

### 4.5 Images

No server-side processing anywhere (Workers can't run sharp; Cloudflare Images is a paid
zone add-on we skip). Headshots/logos are downscaled client-side before upload (canvas,
max edge 1024 px for headshots / 600 px logos, JPEG/WebP q≈0.85) in a shared
`downscaleImage()` util in the upload component. `next/image` runs `unoptimized` with
explicit width/height (CLS-safe). This is the whole strategy; it removes an entire class of
runtime/compat risk for the cost of ~40 client lines.

---

## 5. Email architecture (Resend) + scheduling on Cloudflare

### 5.1 Provider decision

**Resend** (explicitly blessed in the brief). Fetch-based SDK works on Workers — but we call
the REST API with plain `fetch` anyway (fewer deps, we control idempotency headers).
Cloudflare Email Routing/Workers-send was considered and rejected: no attachment ergonomics,
weaker deliverability story, no dashboard for debugging during judging.

**Only `sb-jobs` talks to Resend.** The web app never sends email inline — it writes outbox
rows. This gives one choke point for retries, idempotency, allowlisting, and logging.

### 5.2 Scheduling decision: Cron-scan + transactional outbox (not Queues, not Workflows)

- **Cloudflare Workflows** (`step.sleepUntil` per reminder): elegant, but state snapshotted
  at enqueue time goes stale (task completed, due date moved, speaker declined) — exactly
  the staleness bug class the analyses flag; plus it's the newest API surface = highest
  NEEDS-VERIFY density. Rejected.
- **Cloudflare Queues**: adds a producer/consumer moving part and still needs an outbox for
  transactional enqueue; a queue between "row committed" and "send" buys nothing at our
  volume. Rejected.
- **Cron Triggers + idempotent DB scan**: chosen. Every tick asks Postgres "what should have
  been sent by now and wasn't?" — stateless, restart-safe, self-healing after downtime,
  trivially testable, and still earns the Cloudflare-infra bonus. Latency ceiling for
  "immediate" mail is 60 s, and §5.4's nudge endpoint makes it ~1 s in practice.

### 5.3 The outbox model — one table, dual-purpose (outbox AND audit log)

```sql
CREATE TABLE communication_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL,
  speaker_id       uuid,                          -- nullable: admin alerts
  recipient_email  text NOT NULL,
  template_key     text NOT NULL,                 -- enum in contracts (7 keys + form-level)
  payload          jsonb NOT NULL,                -- entity REFS (ids) + minimal snapshot; re-resolved at send
  idempotency_key  text NOT NULL UNIQUE,          -- see recipes below
  status           text NOT NULL DEFAULT 'queued',-- queued|sending|sent|failed|skipped
  attempts         int  NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_error       text,
  provider_message_id text,
  subject_rendered text,
  ics_uid          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX ON communication_log (status, next_attempt_at);
CREATE INDEX ON communication_log (event_id, speaker_id, created_at DESC); -- comms-history UI
```

**Enqueue** (`enqueueEmail()` in core): inserted **in the same interactive transaction** as
the domain write (neon WS Pool) with `ON CONFLICT (idempotency_key) DO NOTHING`. Domain
event fires exactly when its row commits — no committed-but-never-queued and no
queued-but-rolled-back states.

Idempotency-key recipes (the double-send firewall):
- `submission_received:{submissionId}`
- `decision:{submissionId}:{accepted|declined}:{notifiedRevision}` (revision bumps only on an
  explicit re-notify action; status flip-flops reuse the key → silently deduped)
- `task_assigned:{assignmentId}`
- `task_reminder:{assignmentId}:{ruleOffset}` (one send per assignment per ladder rung, ever)
- `schedule:{sessionId}:{speakerId}:seq{sequence}` (ICS SEQUENCE, §6)
- `form_confirmation:{submissionId}`

**Dispatch** (jobs worker, every minute): claim → send → mark, with claims done in ONE SQL
statement so the neon-http driver suffices:

```sql
UPDATE communication_log SET status='sending', locked_until = now() + interval '3 minutes',
       attempts = attempts + 1
WHERE id IN (
  SELECT id FROM communication_log
  WHERE (status='queued' AND next_attempt_at <= now())
     OR (status='sending' AND locked_until < now())          -- crashed dispatcher recovery
  ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

Per claimed row: (1) **send-time re-check** — payload holds ids, not truth; `task_reminder`
re-reads the assignment (completed/deleted → `skipped`), `schedule_*` re-reads the session
(unscheduled → convert to cancel flow), decision emails re-read submission status;
(2) render (§5.5); (3) `EMAIL_MODE`/allowlist gate; (4) POST to Resend **with
`Idempotency-Key: {idempotency_key}` header** so a crash between provider-accept and our
`sent` mark can't double-send on reclaim — **NEEDS-VERIFY (V6)**: Resend idempotency-header
support on the send endpoint; fallback: rely on the 3-min lock + mark-sent-immediately
(residual double-send window is a crash inside a ~2 s span — acceptable, and the log shows
it); (5) mark `sent` (+provider id) or `failed` with backoff
`next_attempt_at = now() + least(2^attempts, 60) minutes`, max 6 attempts → terminal
`failed`, visible in the comms log UI.

### 5.4 Cron layout & the immediacy nudge

`sb-jobs` scheduled handler, single `* * * * *` cron, dispatch by minute modulo:

| Cadence | Task |
|---|---|
| every minute | outbox dispatch (§5.3) |
| minute % 15 == 0 | reminder scan: for each enabled `reminder_rule` (default ladder T-7d, T-1d, +1d overdue) × open task assignments in window → `enqueueEmail` with `ON CONFLICT DO NOTHING` |
| minute % 10 == 5 | Airtable incremental sync (§7) |
| daily 09:00 UTC | R2 orphan cleanup (§4.3); failed-email digest log line |

Fetch handler on `sb-jobs`: `POST /run/{outbox|reminders|airtable}` guarded by
`Authorization: Bearer JOBS_RUN_SECRET`. After enqueueing user-facing mail (e.g. CFP
confirmation), web does `ctx.waitUntil(fetch(jobs + '/run/outbox'))` — best-effort; if it
fails, the minute cron delivers. Admin UI "Sync to Airtable now" button hits `/run/airtable`.

### 5.5 Templates & variable system

- `email_template` table (per event): `key` (the 7 fixed triggers from the dashboard-comms
  analysis + per-form confirmation), `subject`, `body_html` (organizer-edited rich text),
  `enabled`. Seeded defaults on event creation.
- **Variable contract lives in `packages/contracts/email.ts`**: for each template key, a zod
  schema of its context (e.g. `schedule_assigned` ⇒ `{speaker, event, session, ics, portal}`
  shapes). One source of truth for: save-time validation (extract `{{path}}` tokens; any
  token not in the key's schema → save rejected with the offending token), the variable-picker
  UI, and send-time rendering.
- **Renderer** (`packages/core/email/render.ts`, ~80 lines, hand-rolled): mustache-subset —
  `{{dot.path}}` only, NO conditionals/loops/partials, HTML-escape always (no triple-stache).
  The one list-shaped variable (`tasks.outstanding_list`) is pre-rendered server-side into
  safe HTML by the context builder, not by template logic. Send-time rule: any null/missing
  variable ⇒ the send **fails loudly** (`failed`, "missing variable speaker.first_name") —
  never ships "Hi {{first_name}}".
- Layout: one fixed HTML shell (inline CSS, event logo via public `/f/` URL, footer w/
  unsubscribe link for reminder-class templates). Plain-text part generated by a small
  strip-HTML util. Both parts sent to Resend (`html` + `text`).
- Suppression: `speaker.unsubscribed_at` honored by the dispatcher for reminder-class keys
  only (`task_reminder`); transactional decision/schedule mail always sends.
- Rich-text bodies pass through `packages/core/sanitize.ts` on save (same allowlist as all
  other organizer rich text).

---

## 6. Calendar invites (ICS)

### 6.1 Generation — hand-rolled `packages/core/ics.ts`, UTC-only

Decision: **no ICS library**. `ical-generator` needs timezone plugins (moment-timezone —
banned for bundle size) for VTIMEZONE emission, and Workers compat of the lib family is
exactly the kind of thing we don't want to debug Tuesday night. Instead: ~200 lines, zero
deps, fully unit-tested:

- All times emitted as **UTC basic format** (`DTSTART:20261012T160000Z`). **No VTIMEZONE
  blocks, ever.** Gmail/Outlook/Apple all convert UTC to the viewer's local zone perfectly;
  this deletes the single most bug-prone part of RFC 5545 (the analyses' #1 flagged trap).
  The *email body* states the human time in the event timezone ("Oct 12, 9:00 AM PDT") via
  `time.ts`.
- Emits: `VCALENDAR` (PRODID, VERSION:2.0, METHOD), `VEVENT` with `UID`, `SEQUENCE`,
  `DTSTAMP`, `DTSTART/DTEND`, `SUMMARY`, `DESCRIPTION` (portal link), `LOCATION`
  (room · venue · city), `STATUS:CONFIRMED|CANCELLED`, `ORGANIZER;CN=` (mailto at our
  sending domain — required for Gmail to treat it as a real invite), `ATTENDEE;CN=...;
  PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{speaker}`, `URL`.
- Correctness details unit-tested with golden fixtures: CRLF line endings, 75-octet line
  folding (fold on bytes, continuation space), text escaping (`\,` `\;` `\n` `\\`), UTF-8.

### 6.2 Invite state machine

`calendar_invite` table: `(speaker_id, session_id)` unique → `ics_uid` (stable:
`sess-{sessionId}-spk-{speakerId}@{email-domain}`), `sequence int` (monotonic), `last_method`
(`REQUEST|CANCEL`), `last_sent_at`.

Triggers (fired by agenda module's domain events through `enqueueEmail`):
- Session scheduled & published with this speaker → sequence=0, METHOD:REQUEST
  (`schedule_assigned` template).
- Time/room change → sequence+1, METHOD:REQUEST, same UID (`schedule_changed`). Same-UID +
  higher SEQUENCE is what makes Gmail/Outlook update in place instead of duplicating.
- Unscheduled / unpublished / speaker removed / submission withdrawn → sequence+1,
  METHOD:CANCEL, STATUS:CANCELLED.
- Debounce: enqueue keyed `schedule:{sessionId}:{speakerId}:seq{n}`; the agenda module bumps
  `schedule_revision` once per drag-drop *commit* (not per pixel), so a burst of edits
  collapses naturally; dispatcher re-reads current session state at send time anyway.

### 6.3 Delivery — attachment + links, feed as a bonus surface

Each schedule email carries, redundantly (defense in depth across picky clients):
1. **`.ics` attachment**, filename `invite.ics`, content type `text/calendar; charset=utf-8;
   method=REQUEST`. **NEEDS-VERIFY (V5, day 0-1)**: send via Resend to real Gmail + Outlook
   accounts; confirm (a) attachment content-type is controllable in Resend's API, (b) Gmail
   shows the event chip/RSVP. Resend cannot compose a true `multipart/alternative` with an
   inline `text/calendar` part, so rendering depends on client attachment handling —
   likely fine, must be seen.
2. **"Add to Google Calendar" link** (`calendar.google.com/calendar/render?action=TEMPLATE&
   dates=...Z/...Z&...`) and **"Add to Outlook" deeplink** — pure URL construction, works
   regardless of (1). This is the guaranteed-pass fallback for "Gmail, Outlook" in the brief.
3. **Tokenized ICS download link** → `GET /api/ics/session/{token}.ics` (single VEVENT,
   METHOD:PUBLISH) — covers "iCal"/Apple and any client where (1) is ugly.
4. **Per-speaker feed URL** shown in the portal ("subscribe to all your sessions"):
   `GET /api/ics/speaker/{token}.ics` — VCALENDAR, **no METHOD** (subscription semantics),
   all *published* sessions for that speaker, same UIDs as the invites (clients dedupe),
   `X-WR-CALNAME: {event name} — {speaker}`, `Cache-Control: private, max-age=300`,
   `Content-Disposition: inline`. Calendar apps poll it unauthenticated: token is a 128-bit
   random value stored **hashed** (SHA-256) on the speaker row, revocable, single-audience
   (an ICS token grants nothing but ICS). Route is in web app; force-dynamic.

### 6.4 Timezone rules (platform-wide law, enforced by module shape)

`packages/core/time.ts` exports exactly three functions and the module doc forbids other
date math imports outside it:
- `zonedInputToUtc(localISO, ianaZone): Date` — for admin datetime inputs (event tz).
- `formatInZone(utc, ianaZone, fmt): string` — all human rendering (admin/public: event tz,
  labeled "PDT"; email bodies: event tz; ICS: bypasses this, UTC).
- `daysToEvent(nowUtc, eventStartUtc, ianaZone): number` — calendar-day diff computed in
  event tz (dashboard greeting off-by-one guard).
Implementation: date-fns + date-fns-tz (pure JS, uses the runtime's full ICU — present on
Workers). All DB columns `timestamptz`. Grouping-by-day for agenda/schedule uses
`formatInZone(_, tz, 'yyyy-MM-dd')` as the bucket key — never `DATE(starts_at)` in SQL.

---

## 7. Airtable export (bonus)

### 7.1 Shape

**One-way, incremental, idempotent push** from Postgres, running only in `sb-jobs`
(cron minute%10==5 + manual `/run/airtable`). Zero reads from Airtable into app logic.

Exported tables: `Events`, `Submissions` (flattened: title, status, track name, tags joined,
speaker names joined, rating avg, form name, submitted_at), `Speakers`, `Sessions`
(accepted/published only), `TaskAssignments` (speaker, task, status, due, completed_at),
`CommunicationLog` (recipient, template, status, sent_at). Every table gets a `PG ID`
single-line-text field.

### 7.2 Mechanics

- Client: plain `fetch` against the REST API (the `airtable` npm SDK is banned — old,
  callback-based, and we need custom throttle/idempotency anyway). ~120 lines in
  `packages/core/airtable.ts`.
- **Upsert without a mapping table**: `PATCH /v0/{base}/{table}` with
  `performUpsert: { fieldsToMergeOn: ["PG ID"] }`, 10 records per request. This makes
  re-runs naturally idempotent and removes the postgres-id→airtable-record-id state table.
  **NEEDS-VERIFY (V7)**: upsert-by-merge-field behaves as expected (15-min spike). Fallback:
  classic `airtable_record_map` table + create-vs-update branching (adds ~40 lines).
- Throttle: ≤4 req/s (limit is 5) via `await sleep(250)` between requests; on 429, sleep
  30 s and resume. Batch budget per cron run: 300 records, then persist watermark and stop
  (stays far under CPU limits; next tick resumes).
- Incrementality: `airtable_sync_state` row per table: `last_synced_watermark timestamptz`,
  `last_run_at`, `last_status`, `last_error`. Query = rows with `updated_at >
  watermark ORDER BY updated_at LIMIT batch`; watermark advances only after the batch
  commits to Airtable. (Every exported table already carries `updated_at` — platform
  requirement on schema design.)
- Deletes: **not propagated** (documented append/update-only; a `Status` field shows
  `withdrawn`/`declined` rather than disappearing). Cheap honesty beats delete-sync bugs.
- Provisioning: `scripts/airtable-provision.ts` creates tables/fields via the Meta API if
  missing (PAT needs `schema.bases:write`). If Meta API friction appears, fallback is a
  README with the manual base recipe — 10 minutes by hand, done once.
- Failure isolation: sync never runs in a user request; errors land on `airtable_sync_state`
  and render as a status chip in admin Settings → Integrations.

---

## 8. Public JSON API (bonus, platform conventions)

Read-only, no auth, published-data-only, versioned prefix:
`GET /api/v1/events/{slug}` · `/api/v1/events/{slug}/sessions` · `/speakers` · `/schedule`
(grouped by day in event tz). Implementation rule: these routes call the SAME
`getPublishedSchedule()/getPublishedSpeakers()` contracts the embeds use (draft-leak
prevention lives in one query, per the agenda analysis). Responses zod-serialized from
`packages/contracts` DTOs; `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
(+ `withEdgeCache` if V2 falls back). CORS: `Access-Control-Allow-Origin: *` on `/api/v1/*`
only. Errors: `{error: {code, message}}`, correct status codes. That's the whole API story —
it drops out of the embed work nearly free.

Abuse guard for the public POST surfaces (CFP submit, magic-link request): Cloudflare WAF
rate-limiting rules (dashboard, 10 req/min/IP on `/api/auth/*` and CFP submit) — zero code.

---

## 9. Platform module contracts (what feature agents import)

| Import | Signature (sketch) | Used by |
|---|---|---|
| `core/db` | `getDb(env)` (neon-http), `withTx(env, fn)` (neon-ws Pool, interactive tx) | everyone |
| `core/email` | `enqueueEmail(tx, {eventId, templateKey, recipient, speakerId?, payload, idempotencyKey})` | CFP, abstracts (notify), portal (tasks), agenda (schedule), comms UI |
| `core/ics` | `buildInvite(opts)`, `buildFeed(opts)` — pure functions | jobs dispatcher, ICS routes |
| `core/time` | the three functions (§6.4) | everyone |
| `core/storage` | `createUpload()`, `finalizeUpload()`, `getDownloadUrl()`, `serveFile()` | CFP, portal, event-config |
| `core/sanitize` | `sanitizeHtml(html): string` — single allowlist | every rich-text save path |
| `core/airtable` | (jobs-only) `runSync(env, budget)` | jobs |
| `contracts/*` | zod schemas: status enums, DTOs, condition-rule shape, template contexts | everyone, both sides of every boundary |

Rules of the road (CI-grepped where cheap): no `process.env` outside `core/env`; no
`new Date()` formatting outside `core/time`; no `dangerouslySetInnerHTML` except the one
`RichText` component that renders sanitized output; no direct Resend/Airtable/R2 calls
outside `core/*`; every table carries `event_id` + `updated_at`.

---

## 10. Day-0 spike checklist (all NEEDS-VERIFY items, ordered, ~half a day total)

| # | Verify | Time | Fallback (pre-decided) |
|---|---|---|---|
| V1 | Pin `@opennextjs/cloudflare` + supported Next version; hello-world deploy to workers.dev; confirm wrangler.jsonc key shapes + `getCloudflareContext()` | 45 min | n/a (foundational; do first) |
| V2 | `revalidate = 60` page actually regenerates on deployed worker with r2IncrementalCache + memory queue | 30 min | force-dynamic + `withEdgeCache` Cache-API util for JSON/embeds only |
| V3 | `wrangler versions upload` preview URL works on OpenNext artifact | 15 min | staging worker deployed from main |
| V4 | Browser presigned PUT to R2 via aws4fetch (incl. CORS + signed content-type) | 30 min | proxy uploads through route handler with R2 binding |
| V5 | Resend: `.ics` attachment with `text/calendar; method=REQUEST` content-type → Gmail & Outlook render an invite | 45 min | lead with Google/Outlook deeplink buttons + ICS download link (already in the email design) |
| V6 | Resend `Idempotency-Key` header on /emails | 10 min | lock-window-only dedupe (documented residual risk) |
| V7 | Airtable `performUpsert.fieldsToMergeOn: ["PG ID"]` | 15 min | `airtable_record_map` table |
| V8 | Neon WS Pool interactive transaction from deployed Worker (`withTx` smoke test) | 20 min | single-statement CTE patterns for the two critical atomic checks (submission limit, outbox claim already single-statement) |
| — | Resend domain DNS (SPF/DKIM) submitted for verification | 15 min | must-do, not a verify |

Anything failing its verify adopts the fallback the same hour; no re-litigation.

---

## 11. What this design deliberately does NOT do (scope walls)

- No Cloudflare Workflows, Queues, Durable Objects (beyond whatever the pinned OpenNext
  config transparently requires — target: none), D1, KV, Hyperdrive, Email Workers.
- No calendar-provider OAuth (ICS covers the brief's "Gmail, Outlook, iCal" verbatim).
- No server-side image transforms, no SVG uploads, no virus scanning.
- No websockets/SSE — "real-time" = TanStack Query refetch (focus + 15–30 s intervals).
- No Airtable reads, no delete-sync, no two-way anything.
- No multi-region, no custom domain until the final day (except the email domain, day 0).
- No per-PR database branches; two Neon DBs total.
