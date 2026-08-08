# M08 — Jobs worker + `/api/jobs/*` skeleton

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED-PARTIAL** guarded no-op routes, job contracts, dispatcher, canonical preview/production config, and exact-URL deploy commands exist. Remaining: deployed worker→web proof, per-environment secrets on both workers, tail evidence, and AC-gated stub swaps. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API). **Executor differs from the catalog's WS-A origin** — M08 was moved from the architect to WS-F (PLAN §4 note and §6 WS-F order). Zero app imports in `workers/jobs/`. |
| **Scheduled** | **Sat AM** — the first thing WS-F builds, before M34 (PLAN §6 WS-F order, §7 Sat AM). |
| **Size** | S (≈2h) |
| **Paths owned** | `workers/jobs/index.ts`, `workers/jobs/wrangler.jsonc`, `workers/jobs/README.md`, `src/app/api/jobs/_lib.ts`, `src/app/api/jobs/outbox/route.ts`, `src/app/api/jobs/reminders/route.ts`, `src/app/api/jobs/airtable/route.ts`, `src/app/api/jobs/cleanup/route.ts`. Package scripts `deploy:jobs`/`dev:jobs` are added by [M01](./M01-scaffold-ci-deploy.md); this module only fills the worker they point at. |

## Objective
A second deployed Cloudflare Worker (`sb-jobs`) runs one `* * * * *` cron and, by minute-modulo, POSTs `x-cron-secret`-guarded job routes on `sb-web`. The four job routes exist in the Next app and return a typed `JobResult` JSON envelope; each delegates to a feature-exported job function, or to a local no-op stub until [M34](./M34-comms-outbox-dispatcher.md)/[M36](./M36-reminder-scan.md)/[M39](./M39-airtable-export.md) land. When done, a cron tick is visible in Workers Logs every minute and `curl -H 'x-cron-secret: …' -XPOST …/api/jobs/outbox` returns `{"job":"outbox","ok":true,…}` on the deployed preview.

## Dependencies
- **Hard (blocks start):** [M01](./M01-scaffold-ci-deploy.md) — the pinned Next+OpenNext app deployed to workers.dev with a working `wrangler.jsonc` shape, `pnpm deploy:web`, and a Cloudflare account/API token that can deploy a second worker (spike S1 + check C2 green).
- **Soft (start against stub/fixture):**
  - Feature job functions do not exist yet. Code against these exact signatures and ship **local no-op stubs** in `src/app/api/jobs/_lib.ts` until the real ones land:
    `dispatchOutbox(budget: number): Promise<JobStats>` ([M34](./M34-comms-outbox-dispatcher.md), Sat PM) ·
    `scanReminders(): Promise<JobStats>` ([M36](./M36-reminder-scan.md), Sun) ·
    `runAirtableSync(budget: number): Promise<JobStats>` ([M39](./M39-airtable-export.md), Tue) ·
    `cleanupOrphans(): Promise<JobStats>` ([M07](./M07-r2-storage.md) exports the orphan-cleanup fn; if absent Tue, leave the stub).
    **Swap step:** replace the stub import in the route file with the feature barrel import (`@/features/comms`, `@/features/airtable`, `@/shared/server/r2`) — one line per route, no other change.
  - `getEnv()` from [M04](./M04-shared-libs.md) may not yet expose `CRON_SECRET`. Until it does, read it through `getEnv()` anyway and open an **architect-labeled additive PR** adding `CRON_SECRET: z.string().min(16)` to `env.ts`. Never read `process.env` in `src/**` (CI grep).

## Provides (interfaces others consume)
- `POST /api/jobs/outbox` · `POST /api/jobs/reminders` · `POST /api/jobs/airtable` · `POST /api/jobs/cleanup` — all guarded by header `x-cron-secret: <CRON_SECRET>`; 401 otherwise. Consumed only by the `sb-jobs` cron and trusted manual curl in WS-F demos. The admin "Sync to Airtable" button uses M39's authenticated internal admin route, which calls `runAirtableSync` directly; browser code never receives `CRON_SECRET`.
- Response envelope. **`JobName` and `JobStats` live in `src/shared/contracts/jobs.ts`** ([M02](./M02-shared-contracts.md)'s Provides table has a `jobs.ts` row) — **not** here: [M34](./M34-comms-outbox-dispatcher.md)'s `dispatchOutbox`, [M36](./M36-reminder-scan.md)'s `scanReminders` and [M39](./M39-airtable-export.md)'s `runAirtableSync` all return `JobStats`, and `src/features/**` importing from `src/app/**` inverts the dependency direction `eslint-plugin-boundaries` enforces as a **CI failure** (PLAN §2: `app/` is the thin leaf). This module owns only `JobResult` and `defineJobRoute` in `_lib.ts`:
  ```ts
  // src/shared/contracts/jobs.ts  (M02)
  export type JobName = 'outbox' | 'reminders' | 'airtable' | 'cleanup';
  export type JobStats = Record<string, number>;

  // src/app/api/jobs/_lib.ts  (this module)
  import type { JobName, JobStats } from '@/shared/contracts';
  export type JobResult = { job: JobName; ok: boolean; stats: JobStats; ms: number; error?: string };
  export function defineJobRoute(job: JobName, run: () => Promise<JobStats>): { POST: (req: Request) => Promise<Response> };
  ```
  `defineJobRoute` is the only place the secret is compared and the only place a job's exception is turned into `{ok:false,error}` + HTTP 500. Consumed by all four route files.
- Deployed worker `sb-jobs` (`pnpm deploy:jobs`). Consumed by [M34](./M34-comms-outbox-dispatcher.md) (every-minute drain), [M36](./M36-reminder-scan.md) (%15), [M39](./M39-airtable-export.md) (%10).

## Step-by-step implementation

1. **Contract-first slice — the route envelope + stubs.** Create `src/app/api/jobs/_lib.ts` with `JobResult`/`defineJobRoute` exactly as above, importing `JobName`/`JobStats` from `@/shared/contracts` (if the `jobs.ts` contracts file does not exist yet, that is a one-line architect-labeled additive PR — do **not** declare the two types locally, or three features end up importing from `app/`), plus four exported no-op stubs `stubOutbox`, `stubReminders`, `stubAirtable`, `stubCleanup` each returning `{ noop: 1 }`. `defineJobRoute` must: read `getEnv().CRON_SECRET`; compare against `req.headers.get('x-cron-secret')` with a constant-time compare (loop over char codes, no early return); on mismatch return `401` with `{"error":{"code":"UNAUTHORIZED"}}` and **no** job execution; else `const t0 = Date.now()`, run, return `JobResult` with `ms`. Wrap `run()` in try/catch → `{ok:false,error:String(e)}` + status 500, and `console.log(JSON.stringify(result))` on both paths (structured log via [M04](./M04-shared-libs.md)'s `log.ts` if it exists).
   **Done when:** `pnpm tsc --noEmit` passes and `_lib.ts` exports compile with no imports from `src/features/**`.
2. **The four route files.** `src/app/api/jobs/{outbox,reminders,airtable,cleanup}/route.ts`, each 4 lines: `export const dynamic = 'force-dynamic';` then `export const { POST } = defineJobRoute('outbox', stubOutbox);`. **Never** `export const runtime = 'edge'` (CI grep bans it repo-wide).
   **Done when:** `curl -X POST localhost:3000/api/jobs/outbox` → 401; with the correct `x-cron-secret` header → `200 {"job":"outbox","ok":true,"stats":{"noop":1},"ms":<n>}`.
3. **The jobs worker.** `workers/jobs/index.ts` — plain TypeScript, **zero imports from `src/`** (lint/CI check: the file's only import is its own `Env` type):
   ```ts
   export interface Env { APP_BASE_URL: string; CRON_SECRET: string }
   const post = (env: Env, job: string) =>
     fetch(`${env.APP_BASE_URL}/api/jobs/${job}`, { method: 'POST', headers: { 'x-cron-secret': env.CRON_SECRET } })
       .then(async r => console.log(JSON.stringify({ job, status: r.status, body: await r.text() })))
       .catch(e => console.log(JSON.stringify({ job, error: String(e) })));
   export default {
     async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
       const d = new Date(controller.scheduledTime); const m = d.getUTCMinutes();
       const jobs = ['outbox'];                                   // every minute
       if (m % 15 === 0) jobs.push('reminders');                  // %15 — task_assigned + reminder ladder
       if (m % 10 === 5) jobs.push('airtable');                   // %10 (offset 5, never collides with %15)
       if (d.getUTCHours() === 9 && m === 0) jobs.push('cleanup'); // daily 09:00 UTC
       ctx.waitUntil(Promise.all(jobs.map(j => post(env, j))));
     },
     async fetch() { return new Response('sb-jobs', { status: 200 }); },
   };
   ```
   **Done when:** `wrangler dev --test-scheduled` in `workers/jobs/` + `curl 'localhost:8787/__scheduled?cron=*+*+*+*+*'` prints one `{"job":"outbox","status":200,…}` log line.
4. **`workers/jobs/wrangler.jsonc`.** Safe local defaults plus named `preview` and `production` environments. Preview deploys as `sb-jobs-preview`; production deploys as `sb-jobs`. `scripts/deploy-cloudflare.sh` requires and injects the exact matching web URL so no guessed hostname is committed. Shared shape: `main: "index.ts"`, the same pinned compatibility date as web, `nodejs_compat`, one `* * * * *` cron, and observability. The only runtime configuration values are `APP_BASE_URL` and `CRON_SECRET`; never add DB, R2, Resend, Airtable, or session configuration. Set `CRON_SECRET` on both matching workers: the same value inside preview, a different same-on-both value inside production. Record only that each pair is set.
   **Done when:** `pnpm deploy:jobs` succeeds and `wrangler tail sb-jobs` shows a log line each minute.
5. **Deployed end-to-end check + doc.** Deploy web before the matching jobs worker. Watch `wrangler tail sb-jobs-preview` for 2 minutes: exactly one `outbox` line per minute, one extra `reminders` line at the next multiple of 15. Curl the deployed route directly with and without the preview secret. Write `workers/jobs/README.md`: the environment/name/URL table, modulo table, curl commands (secret redacted), and the "a missed tick self-heals on the next one — every job is an idempotent DB scan" note.
   **Done when:** both curls behave (200 / 401) against the **deployed** URL and the tail output is pasted into `DECISIONS.md`.
6. **Hand-off notes for the swap.** In each route file leave a one-line comment naming the real import that replaces the stub (`// swap: import { dispatchOutbox } from '@/features/comms'`). Do the outbox swap yourself the moment [M34](./M34-comms-outbox-dispatcher.md)'s `dispatchOutbox` exists (same agent, same day).
   **Done when:** `grep -rn "// swap:" src/app/api/jobs` lists four lines.

## Acceptance criteria
**Catalog AC (verbatim):** cron tick observable in Workers Logs each minute; manual curl triggers a job route; wrong secret → 401.

Verification:
- `wrangler tail sb-jobs --format=pretty` — one `outbox` line per minute for 3 consecutive minutes.
- `curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/jobs/outbox"` → `{"job":"outbox","ok":true,…}`.
- `curl -sS -o /dev/null -w '%{http_code}' -X POST "$APP_BASE_URL/api/jobs/outbox"` → `401`; same with a wrong secret → `401`.
- `pnpm check` green (typecheck + lint + invariant greps, incl. no `runtime='edge'`, no `process.env` outside `env.ts`).

## Guardrails
- **Jobs worker has zero app imports** (binding resolution #1). If you find yourself importing from `src/`, stop: the logic belongs in a feature and the worker just POSTs. CI grep: `grep -rn "from '\.\./\.\./src" workers/jobs` must be empty.
- **No `export const runtime = 'edge'` anywhere** (PLAN §2 invariant grep) — job routes are Node-runtime OpenNext routes.
- **No `process.env` outside `env.ts`** in `src/**`. The worker uses its `env` handler arg, never `process.env`.
- Secret compare must be **constant-time and header-name-exact** (`x-cron-secret`, lowercase); a wrong secret must not run the job or reveal timing.
- Every job must be **idempotent and bounded** — a missed or doubled tick must be harmless. Do not add retry logic in the worker: the next tick is the retry (platform-integrations §5.4).
- `%10 === 5` for airtable is deliberate so airtable and reminders never share a tick (CPU budget). Do not "simplify" to `%10 === 0`.
- `ctx.waitUntil` in the worker is required — a `scheduled` handler that returns before its fetches settle silently drops them.
- Edge case: `APP_BASE_URL` pointing at localhost, a guessed workers.dev hostname, or a stale version URL is the classic "cron runs but nothing happens" trap — assert the exact Wrangler-emitted URL in `DECISIONS.md` after every URL change.

## If blocked
If Cloudflare will not accept a second worker or the deploy token is scoped wrong, do not idle: (a) build steps 1–2 (routes + envelope) and prove them with local curl — they are the entire contract [M34](./M34-comms-outbox-dispatcher.md)/[M36](./M36-reminder-scan.md)/[M39](./M39-airtable-export.md) consume, and a temporary external cron (`curl` from any machine, or `wrangler versions upload` preview + manual trigger) covers the demo; (b) start [M34](./M34-comms-outbox-dispatcher.md) step 1 (the barrel + `seedDefaultTemplates` stub) — it is the fan-out gate for [M11](./M11-events-feature.md); (c) do the Sat WS-F checklist items that need no code: the canned ICS render check ([M35](./M35-ics-calendar-invites.md) step 2) and the Airtable base provisioning ([M39](./M39-airtable-export.md) step 1).
