# M01 — Repo scaffold, CI, walking-skeleton deploy

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED-PARTIAL**. The preview Worker is live at `https://sb-web-preview.yi-ding.workers.dev` with a real Neon `/api/health` round-trip and a measured 1206.45 KiB gzip artifact inside the Workers Free budget. Remaining: Resend DNS/header probe, browser R2 presign/CORS, revalidate-60, `frame-ancestors`, a deployed auth-throttle proof, and a green `Deploy` workflow run from `main`. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Fri Aug 8, evening (Phase 0) — first module of the build; CP0 gate at Fri midnight |
| **Size** | L |
| **Paths owned** | `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `drizzle.config.ts`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `postcss.config.mjs`, `components.json`, `.gitignore`, `.dev.vars.example`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/check-invariants.sh`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/api/health/route.ts`, `DECISIONS.md` |

## Objective
A pinned Next.js App Router app builds through `@opennextjs/cloudflare` and is live on a `workers.dev` URL with a hello page and a `/api/health` route that does a real Neon round-trip. `pnpm check` runs typecheck → lint+boundaries → invariant greps → vitest → `opennextjs-cloudflare build` (which runs `next build` internally, so one step covers both build gates), and the same six gates — plus the CI-only bundle measurement and Playwright suite — gate every PR in GitHub Actions. The four existential spikes (S1–S4) and two 10-minute checks (C1–C2) are executed with their results and adopted fallbacks written into `DECISIONS.md`; the Workers Free bundle/CPU gate is measured and Resend domain DNS is submitted. Application-layer auth throttles are mandatory; a zone-level WAF rule is optional defense-in-depth when a custom domain is actually attached. Demo bar for tonight: **a URL on Cloudflare loads.**

## Dependencies
- **Hard (blocks start):** none. This is the root of the graph.
- **Soft (start against stub/fixture):** none. Everything M01 needs is created by M01. `scripts/post-deploy-smoke.sh` is referenced by the deploy workflow but **owned by [M10](./M10-e2e-release.md)** — M01 lands it as an executable `#!/usr/bin/env bash\nexit 0` placeholder tonight and never edits it again.

## Provides (interfaces others consume)
- **Scripts** (every agent runs these; `package.json`):
  - `pnpm dev` → `next dev`
  - `pnpm check` → `typecheck && lint && invariants && test && build:worker`
  - `pnpm typecheck` → `tsc --noEmit`
  - `pnpm lint` → `eslint . --max-warnings=0`
  - `pnpm invariants` → `bash scripts/check-invariants.sh`
  - `pnpm test` → `vitest run --passWithNoTests`
  - `pnpm build` → `next build`
  - `pnpm build:worker` → `opennextjs-cloudflare build`
  - `pnpm preview` → `opennextjs-cloudflare build && wrangler dev` (the workerd smoke — run before any deploy touching server code)
  - `pnpm deploy:web` aliases production; `pnpm deploy:web:{preview,production}` validates the exact `APP_BASE_URL`, builds OpenNext, and always deploys the named environment explicitly (a bare deploy would target safe local defaults)
  - `pnpm deploy:jobs` aliases production; `pnpm deploy:jobs:{preview,production}` validates the same URL and always deploys the matching named jobs environment explicitly (target lands with [M08](./M08-jobs-worker.md))
  - `pnpm db:generate` / `pnpm db:migrate` (consumed by [M03](./M03-db-schema-migrations.md)), `pnpm seed` ([M09](./M09-seed-demo-script.md)), `pnpm e2e` ([M10](./M10-e2e-release.md))
- **Path alias** `@/*` → `src/*` (tsconfig + vitest + eslint resolver). Every module imports through it.
- **ESLint boundaries element types** (consumed as law by all workstreams): `shared-contracts`, `shared-lib`, `shared-server`, `shared-ui`, `db`, `feature`, `app`, `scripts`.
- **`DECISIONS.md`** — the single append-only log of spike outcomes, Discord clarifications, and video diffs. Every workstream appends; the architect owns conflicts.
- **Live URLs**: `https://sb-web-preview.yi-ding.workers.dev` for preview and `https://sb-web.yi-ding.workers.dev` for production; confirm both against first-deploy Wrangler output.
- **CI contract**: a PR is mergeable only when credential-free CI is green — the six `pnpm check` gates (`opennextjs-cloudflare build` runs `next build` internally, so `build:worker` covers both build gates) plus generated Wrangler-type freshness and the dry-run gzip measurement. Playwright against `sb-test` is a separate protected preview validation after deployment. Consumed by every module's "Done when".

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — the repo skeleton other agents can clone into (do this first, ~45 min)
Files: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `components.json`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `.gitignore`, `.dev.vars.example`.

- `pnpm create next-app@<pinned>` with: App Router, TypeScript, Tailwind, ESLint, `src/` dir, `@/*` alias, **no** Turbopack flag in the build script.
- **Pin the version pair first, then scaffold.** Read `@opennextjs/cloudflare`'s supported-Next matrix, pick the newest Next 15.x it lists, and write both as exact versions (no `^`, no `~`) in `package.json`. Record the pair in `DECISIONS.md` under `## Pinned versions`. **Never bump either for the rest of the hackathon** (risk #1).
- `tsconfig.json` compiler options (R6, quality-strategy §1): `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noFallthroughCasesInSwitch": true`, `"moduleResolution": "bundler"`, `"paths": {"@/*": ["./src/*"]}`.
- `eslint.config.mjs` — flat config: `typescript-eslint` strictTypeChecked, `eslint-plugin-boundaries`, plus errors for `@typescript-eslint/no-explicit-any`, `no-floating-promises`, `switch-exhaustiveness-check`; warn for `no-non-null-assertion`. Boundaries rules (R7 — this is the merge-hell firewall):
  - `shared/**` may import `shared/**` only (never `features/**`; `shared/server/**` may additionally import `@/db/client`).
  - `features/<A>/**` may import `shared/**`, `@/db/schema/*`, and `features/<B>` **barrel only** (`@/features/b`, never `@/features/b/server/...`).
  - `app/**` may import `shared/**` and feature **barrels** only.
  - Only `features/*/server/**`, `src/db/**`, `src/shared/server/**`, and `scripts/seed/**` may import `@/db/client`.
  - `no-restricted-imports` per-directory: `date-fns`/`date-fns-tz` allowed only in `src/shared/lib/time.ts`; any Resend client import is banned (the one adapter uses plain fetch); `@tiptap/*` only in `src/shared/ui/app/rich-text-editor.tsx`.
- `src/app/page.tsx` renders `openboard — walking skeleton` + the build SHA from `process.env.NEXT_PUBLIC_BUILD_SHA` injected at build time (this is the one legitimate `process.env` site outside env.ts; add it to the grep allowlist explicitly).
- **Done when:** `pnpm typecheck && pnpm lint` are green on a fresh clone and `pnpm dev` serves the hello page at `localhost:3000`.

### 2. Cloudflare configs
Files: `open-next.config.ts`, `wrangler.jsonc`, `next.config.ts` (headers).

- `wrangler.jsonc` for **sb-web**: safe local defaults plus named `preview` / `production` environments. Preview deploys as `sb-web-preview` with both R2 bindings on `sb-files-preview`; production deploys as `sb-web` with both bindings on `sb-files`. The guarded deploy script requires and injects each exact `APP_BASE_URL`; neither named environment stores localhost or a guessed workers.dev hostname. Shared shape: `main: ".open-next/worker.js"`, pinned compatibility date, `nodejs_compat`, `ASSETS`, and observability.
- `open-next.config.ts`: R2 incremental cache override + in-memory revalidation queue. **Time-based `revalidate` only — no `revalidateTag`, no `revalidatePath`, so no D1 tag cache and no Durable Object queue.**
- `next.config.ts`: `images: {unoptimized: true}` (no image backend on Workers), `initOpenNextCloudflareForDev()` so bindings work under `next dev`, and `headers()`:
  - `/embed/:path*` → `Content-Security-Policy: frame-ancestors *`, **no** `X-Frame-Options`.
  - everything else → `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `.dev.vars.example` lists the web/local inventory from [`../environments.md`](../environments.md): `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_MODE`, `EMAIL_ALLOWLIST`, `EMAIL_FALLBACK_UI`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_CRON=0`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CRON_SECRET`, `APP_BASE_URL`, `TEST_AUTH`. `NEON_TEST_URL` is protected-preview-only, and it plus Cloudflare deployment credentials never belong in Worker runtime config.
- **Done when:** `pnpm build && pnpm build:worker` succeed locally and `.open-next/worker.js` exists.

### 3. SPIKE S1 — OpenNext deploy + R2 ISR cache (45 min, existential)
- `wrangler deploy` the built artifact. Hit the workers.dev URL.
- Add a throwaway `src/app/spike-isr/page.tsx` with `export const revalidate = 60` rendering `Date.now()`; deploy; curl twice 5 s apart (same value) and once after 70 s (new value).
- **Fallback, adopted the same hour if it fails:** delete the R2 incremental-cache override, make all tier-2 pages `force-dynamic`, and note in `DECISIONS.md` that public pages get `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` set directly on responses plus a 20-line `withEdgeCache(handler, {ttlSeconds})` over `caches.default` for JSON/embed routes. **[M32](./M32-public-schedule-gallery.md) / [M33](./M33-embed-shells.md) / [M40](./M40-public-api.md) read this decision, not the docs.**
- **Done when:** hello page 200s on the workers.dev URL and the ISR verdict (works / fallback adopted) is in `DECISIONS.md`.

### 4. SPIKE S2 — `withTx` / Neon WebSocket Pool on the **deployed** Worker (20 min, existential)
- Temporary `src/app/api/spike-tx/route.ts`: `new Pool({connectionString: env.DATABASE_URL})` → `drizzle-orm/neon-serverless` → interactive transaction doing `SELECT 1` then `SELECT pg_sleep(0.01)` then commit; `pool.end()` in `finally`. Deploy and curl it (not just `wrangler dev` — the deployed artifact is the test).
- Also assert `SHOW server_version` ≥ 15 (needed for `UNIQUE NULLS NOT DISTINCT` and column-list `ON DELETE SET NULL`).
- **Fallback:** rewrite the 8 audited `withTx` functions as single-statement guarded CTEs on `neon-http` (the submission limit, draft allocation/edit writes, and auth issuance become CTEs with advisory/uniqueness guards). Schema unchanged. Record the verdict — **[M03](./M03-db-schema-migrations.md), [M06b](./M06b-portal-auth.md), [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md), [M25](./M25-task-runtime.md), [M28](./M28-sessions-crud.md), [M34](./M34-comms-outbox-dispatcher.md) all branch on it.**
- **Done when:** curl returns `{"ok":true,"pg":"17.x"}` from the deployed URL, or the fallback is written down.

### 5. SPIKE S3 — `xss` package on Workers (15 min, existential)
- Temporary route imports `xss`, sanitizes `<img src=x onerror=alert(1)><b>hi</b><script>x</script>` and returns the result. Deploy, curl, assert only `<b>hi</b>` (and a stripped `<img>` per allowlist) survives.
- **Fallback:** hand-rolled allowlist tokenizer in `sanitize.ts` (same signature) — [M04](./M04-shared-libs.md) implements whichever wins. Record it.
- **Done when:** the verdict and the chosen implementation are in `DECISIONS.md`.

### 6. SPIKE S4 — better-auth full sign-in round-trip on the **deployed** artifact (45 min, existential)
- Wire better-auth minimally (email+password, Drizzle adapter pointed at a scratch table set, one seeded user), deploy, and complete sign-in → cookie set → an authenticated route returns the session **on the workers.dev URL**, not locally.
- **Pre-decided fallback (resolution #11):** jose-signed HMAC session cookie + seeded admin credentials checked against a precomputed hash via Web Crypto (~50 lines, no library). `requireAdmin(eventId, role?)` abstracts over both, so a swap touches only `features/auth`.
- **Done when:** verdict recorded. **[M06a](./M06a-admin-auth.md) implements whichever won and does not re-litigate.**

### 7. CHECK C1 — Resend `Idempotency-Key` header (10 min)
- `curl -X POST https://api.resend.com/emails -H "Idempotency-Key: ob-spike-1" …` twice with the same key to a team inbox on the shared sandbox domain; count arrivals.
- **Fallback if not honored:** lock-window dedupe only (3-min claim + mark-sent-immediately), documented residual risk. **[M34](./M34-comms-outbox-dispatcher.md) leans on this result.**

### 8. CHECK C2 — `wrangler versions upload` preview URL on the OpenNext artifact (10 min)
- Run it, open the preview URL, confirm the hello page renders.
- **Fallback:** use the canonical named `sb-web-preview` deployment from `main`; every daily checkpoint is demoed there instead of a per-version URL. **All of §7's checkpoints depend on this — decide tonight.**

### 9. Same-night infrastructure chores (not spikes — must-dos)
- **Resend domain DNS:** add the sending domain in Resend, publish SPF/DKIM/DMARC records. Propagation is re-checked at CP1 Sat noon (hard gate) and Sat night; the decision point is Sun noon (risk #7). **The CP1 check is a probe email sent through Resend from the production `EMAIL_FROM` to a team Gmail whose `Authentication-Results` header (Show original) reads `spf=pass dkim=pass dmarc=pass` with aligned identities — `header.from` and DKIM `header.d`/`header.i` on the `EMAIL_FROM` domain — screenshotted into `DECISIONS.md`; the Resend dashboard flag alone is not the gate** (rev. 3 delta #17; alignment is what DMARC grades — a generic pass from another sender proves nothing about judge-facing mail).
- **Abuse controls:** verify M06b's application issuance throttle and per-token attempt cap are in the frozen contracts; they work on workers.dev and are the mandatory protection. Cloudflare WAF rate limiting applies to a customer zone, not the project-owned workers.dev hostname, and Workers Paid does not buy extra zone WAF rules. If a custom domain is attached, add the strongest available path-based rule as defense-in-depth and record its plan-specific period/count in `DECISIONS.md`; do not claim a `10 req/min` rule unless that exact configuration exists.
- **Neon:** create `sb-dev`, `sb-test`, `sb-prod`; disable scale-to-zero on `sb-prod`; store pooled URLs as `DATABASE_URL` and direct URLs as `DATABASE_URL_DIRECT`.
- **R2:** create `sb-files-preview` and `sb-files` (plus optional `sb-files-dev` for the remote presign spike), with separate scoped S3 credentials; set CORS (`PUT,GET` from the exact matching origin + `http://localhost:3000` only on dev, header `content-type`, max-age 3600) — forgetting this is the #1 "uploads fail only in the browser" trap ([M07](./M07-r2-storage.md) depends on it).
- **Done when:** all four are done and evidenced in `DECISIONS.md`.

### 10. `scripts/check-invariants.sh` — the grep gate
Exit non-zero on any hit. Each grep excludes exactly one owner path:

| # | Banned pattern | Only allowed in |
|---|---|---|
| 1 | `dangerouslySetInnerHTML` | `src/shared/ui/app/rich-text-view.tsx` |
| 2 | `process.env.` | `src/shared/lib/env.ts`, **`src/app/page.tsx`** (the `NEXT_PUBLIC_BUILD_SHA` read from §1), `next.config.ts`, `drizzle.config.ts`, `scripts/**`, `e2e/**` |
| 3 | `from ['"]date-fns` / `date-fns-tz` | `src/shared/lib/time.ts` |
| 4 | `from ['"]resend` — **nowhere** (the SDK is banned repo-wide, matching §1's ESLint `no-restricted-imports` rule); `api.resend.com` — `src/features/comms/server/**` only (the one plain-fetch adapter) | see pattern column |
| 5 | `runtime = ['"]edge` | nowhere (repo-wide ban) |
| 6 | `insert(submissions)` / `INSERT INTO submissions` | `src/features/submissions/server/mutations.ts` |
| 7 | `insert(contacts)` / `update(contacts)` | `src/features/portal/server/contacts.ts`, **`scripts/seed/contacts.ts`** ([M09](./M09-seed-demo-script.md)'s declared seed exception) |
| 8 | `insert(communicationLogs)` / `INSERT INTO communication_logs` | `src/shared/server/enqueue-email.ts`, `src/features/comms/server/**` (covers [M36](./M36-reminder-scan.md)'s `retireRung` in `reminders.ts` and the dispatcher) |
| 9 | `as EventId\|as FormId\|as SubmissionId\|as ContactId` | `src/shared/contracts/**/*.test.ts` |
| 10 | `drizzle-kit push` | nowhere |
| 11 | R2 binding / `aws4fetch` import | `src/shared/server/r2.ts` ([M07](./M07-r2-storage.md)'s module boundary) |
| 12 | `from '(\.\./)+(store\|wizard\|steps)'` / `next/navigation` / `@/features/(portal\|submissions)` **inside** `src/features/forms/runtime/form-field-renderer.tsx` + `src/features/forms/runtime/field-inputs/` | nowhere — the `<FormFieldRenderer>` boundary grep ([M15](./M15-public-cfp-wizard.md)) |
| 13 | `\.toLocale(Date\|Time)?String\(` / `\.to(Date\|Time)String\(` / `getTimezoneOffset\(` / multi-arg local-tz construction `new Date\([^)]*,` / non-UTC accessors `\.(get\|set)(FullYear\|Year\|Month\|Date\|Day\|Hours\|Minutes\|Seconds\|Milliseconds)\(` — scope `src/**` | `src/shared/lib/time.ts` (`getUTC*`/`setUTC*`/`Date.now()`/`getTime`/single-arg `new Date(iso)` are deliberately not matched; `workers/`+`scripts/` are outside the scope — UTC-only, non-judged surfaces; rev. 3 delta #18) |

**Greps 11–13 ship tonight, with the rest of the table.** Greps 11 and 12 exist because [M07](./M07-r2-storage.md) and [M15](./M15-public-cfp-wizard.md) both need them; grep 13 closes the local-tz raw-`Date`-math hole the date-library grep cannot see (the DST/off-by-one bug class from resolution #9). Neither feature lane may edit this file: `scripts/check-invariants.sh` is architect-owned, and any later change to it is an **architect-labeled one-line PR**, never a direct edit from a feature lane (risk #8's hot-file rule).

- **Done when:** `pnpm invariants` exits 0 on the clean tree and exits 1 after you temporarily add `dangerouslySetInnerHTML` to `page.tsx`.

### 11. `.github/workflows/ci.yml` (PR gate) and `deploy.yml` (main)
Credential-free CI order (target < 8 min): install (pnpm cache) → **typecheck** ∥ **lint** → **invariants** → **vitest** (unit + PGlite) → **`next build` then `opennextjs-cloudflare build`** → `wrangler types --check` (after `.open-next/worker.js` exists, so the self-service binding is deterministic) → Wrangler dry-run gzip measurement (warn at 2.5 MB while on Free; after a recorded Paid upgrade, warn at 8 MiB). Protected preview validation then runs **Playwright** against the deployed preview and Neon `sb-test`, reading `E2E_BASE_URL` and `NEON_TEST_URL` only from the GitHub `preview` environment.
Deploy job (on `main`, after CI): `drizzle-kit migrate` with `DATABASE_URL_DIRECT` → `pnpm deploy:web` → `pnpm deploy:jobs` → `bash scripts/post-deploy-smoke.sh "$APP_BASE_URL"`. Both scripts pass `--env production` explicitly (§ Provides); preview deploys use the `:preview` variants so web and jobs always select matching named environments. Web deploys first so a new jobs worker never targets missing routes on the previous web artifact.
Protected preview validation secret: `NEON_TEST_URL`. Protected deployment environments: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL_DIRECT`, and `CLOUDFLARE_ACCOUNT_ID` (the account id may be a protected variable). Runtime secrets remain in Cloudflare and are not duplicated into GitHub without a deploy-time need.
**Every deploy command must also run from a laptop** (Actions-outage fallback) — practise `pnpm deploy:web` locally once tonight and note it in `DECISIONS.md`.
- **Done when:** a throwaway PR that adds `const x: any = 1` goes **red**, and removing it goes **green**, with the CI run URL pasted into `DECISIONS.md`.

### 12. `src/app/api/health/route.ts`
`export const dynamic = 'force-dynamic'`. Returns `{ok, sha, db: <ms of SELECT 1>}` using `getCloudflareContext().env.DATABASE_URL` (**never `process.env`** — grep #2). Consumed by the post-deploy smoke ([M10](./M10-e2e-release.md)).
- **Done when:** `curl "$APP_BASE_URL/api/health"` returns `{"ok":true,...}` with a non-null `db` timing; use the exact URL emitted by Wrangler.

### 13. `DECISIONS.md` skeleton
Sections, in this order: `## Pinned versions` · `## Spike results (S1–S4, C1–C2)` · `## Workers plan and measured limits` · `## Deferred spikes (Sat AM)` · `## Adopted fallbacks` · `## Discord clarifications` · `## Walkthrough-video diffs` · `## Infra facts (Neon/R2/Resend/Airtable/security-rule ids)` · `## CP1 freeze record`.

### 14. Deferred spikes — hand-off note (run Sat AM in parallel with feature work, not tonight)
Write them into `DECISIONS.md` as an open checklist so nobody re-scopes them: **revalidate-60 behavior** (if S1 passed, confirm on a real public page), **aws4fetch presigned PUT from a browser incl. signed content-type + CORS** (→ [M07](./M07-r2-storage.md)), **PGlite applies our exact 0000/0001** (→ [M03](./M03-db-schema-migrations.md)), **`frame-ancestors *` survives OpenNext header handling on the deployed embed route** (→ [M33](./M33-embed-shells.md)).

### 15. CP1 freeze list (Sat noon) — publish it tonight so every agent knows what stops moving
At CP1 the architect declares frozen, and thereafter changes require an architect-labeled PR:
1. `src/shared/contracts/**` — every enum, DTO, snapshot/condition schema, idempotency recipe, fan-out constant, `FormFieldRendererProps` ([M02](./M02-shared-contracts.md)).
2. `src/db/schema/**` + `drizzle/0000_init.sql` + `drizzle/0001_views_triggers.sql` — additive-only afterwards; renames/drops/type-changes forbidden ([M03](./M03-db-schema-migrations.md)).
3. Every feature barrel signature dropped in Phase 0 (the stub list in [M02](./M02-shared-contracts.md)).
4. The pinned `next` + `@opennextjs/cloudflare` versions.
5. The invariant-grep table (§10) and the ESLint boundaries config.
CP1 additionally gates: migrations applied to sb-dev/sb-test/sb-prod, seed loads, admin login works, every route renders a stub page, CI+deploy green, **Resend domain verification checked (hard gate item — the §9 Authentication-Results probe, not the dashboard flag)**.

## Acceptance criteria
Catalog AC, reconciled: *hello page live on Cloudflare; CI red/green demonstrably gates a PR; spike + check results and Workers bundle/CPU decision written into `DECISIONS.md`; mandatory application throttles proven, with any custom-domain WAF rule recorded as optional defense-in-depth.*

Verification commands:
```bash
curl -sS "$APP_BASE_URL/" | grep -q "openboard"
curl -sS "$APP_BASE_URL/api/health" | jq -e '.ok == true'
pnpm check                       # the six local gates (CI additionally runs the bundle measurement + Playwright)
pnpm invariants                  # exits 0
gh pr checks <throwaway-pr>      # shows red before fix, green after
grep -c '^## ' DECISIONS.md      # ≥ 8 sections present
```

## Guardrails
- **Resolution #1:** single Next app. Do **not** create a pnpm workspace, `apps/`, or `packages/`. The only second deployable is `workers/jobs` ([M08](./M08-jobs-worker.md)), a plain wrangler worker with zero app imports.
- **Resolution #5:** `zod@^4` is fixed. If a dependency's helper has v4 friction, isolate a small local adapter around that helper; do not downgrade or dual-install zod after contracts fan out.
- **Never set `export const runtime = 'edge'`.** OpenNext runs the Node runtime on Workers; the edge runtime is the Vercel path. Grep #5 exists because this failure mode looks like a random 500 at deploy time.
- **Pin, never bump** (risk #1). If a transitive dep breaks the OpenNext build, pin the transitive dep — do not move Next or the adapter.
- `opennextjs-cloudflare build` is a **required** CI gate, not a nice-to-have: it is what catches Workers-incompatible imports that `next build` happily accepts.
- Bundle/plan gate: the Aug 8 reconciled baseline is 1204.60 KiB gzip. While on Free, warn at 2.5 MB beneath the 3 MB deployment limit and probe CPU-heavy routes against the 10 ms allowance. Upgrade before judging if either limit is unsafe; only then use the 8 MiB warning beneath Paid's 10 MB limit. Server-side banned deps: `moment`/`moment-timezone`, the `airtable` npm SDK, `xlsx`, `ical-generator`, `lodash`, `isomorphic-dompurify`, `sharp`.
- Any spike failure adopts its **named** fallback within one hour. No re-litigation, no "let's try one more thing at 2 AM" (risk #1's trigger-to-abandon).
- Do not scaffold `src/features/**` or `src/shared/contracts/**` here — those are [M02](./M02-shared-contracts.md)'s and the feature agents'. M01 creating placeholder feature files causes exactly the merge conflicts the boundaries config exists to prevent.

## If blocked
- **Cloudflare account not ready:** build everything else (configs, ESLint, CI, invariant script, health route) and run `pnpm preview` against the built output locally — that is 80% of the value of S1. Deploy on Workers Free the moment the account resolves; billing is needed only if the measured gate later trips.
- **Neon not provisioned:** run S3 (xss) and C1/C2 first; they need no DB. Write the `DECISIONS.md` skeleton and the CP1 freeze list.
- **A spike is failing and the hour is up:** adopt the fallback, write it down, move to the next spike. Then start [M02](./M02-shared-contracts.md)'s enum + branded-ID files — the fan-out gate matters more than a perfect skeleton.
- **Everything green early:** start the [M03](./M03-db-schema-migrations.md) DDL transcription (0000_init.sql), which is pure typing and is on the critical path for Sat AM.
