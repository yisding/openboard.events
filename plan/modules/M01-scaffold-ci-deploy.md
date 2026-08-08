# M01 — Repo scaffold, CI, walking-skeleton deploy

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Fri Aug 8, evening (Phase 0) — first module of the build; CP0 gate at Fri midnight |
| **Size** | L |
| **Paths owned** | `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `drizzle.config.ts`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `postcss.config.mjs`, `components.json`, `.gitignore`, `.dev.vars.example`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/check-invariants.sh`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/api/health/route.ts`, `DECISIONS.md` |

## Objective
A pinned Next.js App Router app builds through `@opennextjs/cloudflare` and is live on a `workers.dev` URL with a hello page and a `/api/health` route that does a real Neon round-trip. `pnpm check` runs typecheck → lint+boundaries → invariant greps → vitest → `next build` → `opennextjs-cloudflare build`, and the same steps gate every PR in GitHub Actions. The four existential spikes (S1–S4) and two 10-minute checks (C1–C2) are executed with their results and adopted fallbacks written into `DECISIONS.md`; Resend domain DNS is submitted and Cloudflare WAF rate rules are configured. Demo bar for tonight: **a URL on Cloudflare loads.**

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
  - `pnpm deploy:web` → `opennextjs-cloudflare build && wrangler deploy`
  - `pnpm deploy:jobs` → `wrangler deploy --config workers/jobs/wrangler.jsonc` (target lands with [M08](./M08-jobs-worker.md))
  - `pnpm db:generate` / `pnpm db:migrate` (consumed by [M03](./M03-db-schema-migrations.md)), `pnpm seed` ([M09](./M09-seed-demo-script.md)), `pnpm e2e` ([M10](./M10-e2e-release.md))
- **Path alias** `@/*` → `src/*` (tsconfig + vitest + eslint resolver). Every module imports through it.
- **ESLint boundaries element types** (consumed as law by all workstreams): `shared-contracts`, `shared-lib`, `shared-server`, `shared-ui`, `db`, `feature`, `app`, `scripts`.
- **`DECISIONS.md`** — the single append-only log of spike outcomes, Discord clarifications, and video diffs. Every workstream appends; the architect owns conflicts.
- **Live URL**: `https://sb-web.<account>.workers.dev` — the deployed preview every checkpoint is demoed on.
- **CI contract**: a PR is mergeable only when the 6 gates below are green. Consumed by every module's "Done when".

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
  - `no-restricted-imports` per-directory: `date-fns`/`date-fns-tz` allowed only in `src/shared/lib/time.ts`; `resend` only in `src/features/comms/server/**`; `@tiptap/*` only in `src/shared/ui/app/rich-text-editor.tsx`.
- `src/app/page.tsx` renders `openboard — walking skeleton` + the build SHA from `process.env.NEXT_PUBLIC_BUILD_SHA` injected at build time (this is the one legitimate `process.env` site outside env.ts; add it to the grep allowlist explicitly).
- **Done when:** `pnpm typecheck && pnpm lint` are green on a fresh clone and `pnpm dev` serves the hello page at `localhost:3000`.

### 2. Cloudflare configs
Files: `open-next.config.ts`, `wrangler.jsonc`, `next.config.ts` (headers).

- `wrangler.jsonc` for **sb-web**: `name: "sb-web"`, `main: ".open-next/worker.js"`, `compatibility_date: "2025-06-01"`, `compatibility_flags: ["nodejs_compat"]`, `assets: {directory: ".open-next/assets", binding: "ASSETS"}`, r2 buckets `FILES` → `sb-files` and `NEXT_INC_CACHE_R2_BUCKET` → `sb-files`, `observability: {enabled: true}`, vars `APP_BASE_URL`, `EMAIL_MODE`.
- `open-next.config.ts`: R2 incremental cache override + in-memory revalidation queue. **Time-based `revalidate` only — no `revalidateTag`, no `revalidatePath`, so no D1 tag cache and no Durable Object queue.**
- `next.config.ts`: `images: {unoptimized: true}` (no image backend on Workers), `initOpenNextCloudflareForDev()` so bindings work under `next dev`, and `headers()`:
  - `/embed/:path*` → `Content-Security-Policy: frame-ancestors *`, **no** `X-Frame-Options`.
  - everything else → `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `.dev.vars.example` lists every variable from platform-integrations §2.2: `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_MODE`, `EMAIL_ALLOWLIST`, `EMAIL_FALLBACK_UI`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CRON_SECRET`, `APP_BASE_URL`, `TEST_AUTH`.
- **Done when:** `pnpm build && pnpm build:worker` succeed locally and `.open-next/worker.js` exists.

### 3. SPIKE S1 — OpenNext deploy + R2 ISR cache (45 min, existential)
- `wrangler deploy` the built artifact. Hit the workers.dev URL.
- Add a throwaway `src/app/spike-isr/page.tsx` with `export const revalidate = 60` rendering `Date.now()`; deploy; curl twice 5 s apart (same value) and once after 70 s (new value).
- **Fallback, adopted the same hour if it fails:** delete the R2 incremental-cache override, make all tier-2 pages `force-dynamic`, and note in `DECISIONS.md` that public pages get `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` set directly on responses plus a 20-line `withEdgeCache(handler, {ttlSeconds})` over `caches.default` for JSON/embed routes. **[M32](./M32-public-schedule-gallery.md) / [M33](./M33-embed-shells.md) / [M40](./M40-public-api.md) read this decision, not the docs.**
- **Done when:** hello page 200s on the workers.dev URL and the ISR verdict (works / fallback adopted) is in `DECISIONS.md`.

### 4. SPIKE S2 — `withTx` / Neon WebSocket Pool on the **deployed** Worker (20 min, existential)
- Temporary `src/app/api/spike-tx/route.ts`: `new Pool({connectionString: env.DATABASE_URL})` → `drizzle-orm/neon-serverless` → interactive transaction doing `SELECT 1` then `SELECT pg_sleep(0.01)` then commit; `pool.end()` in `finally`. Deploy and curl it (not just `wrangler dev` — the deployed artifact is the test).
- Also assert `SHOW server_version` ≥ 15 (needed for `UNIQUE NULLS NOT DISTINCT` and column-list `ON DELETE SET NULL`).
- **Fallback:** rewrite the 4 audited `withTx` paths as single-statement guarded CTEs on `neon-http` (the outbox claim already is one; the submission limit becomes a CTE with an advisory lock). Schema unchanged. Record the verdict — **[M03](./M03-db-schema-migrations.md), [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md), [M25](./M25-task-runtime.md), [M28](./M28-sessions-crud.md), [M34](./M34-comms-outbox-dispatcher.md) all branch on it.**
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
- **Fallback:** a second worker `sb-web-staging` deployed from `main`; every daily checkpoint is demoed there instead. **All of §7's checkpoints depend on this — decide tonight.**

### 9. Same-night infrastructure chores (not spikes — must-dos)
- **Resend domain DNS:** add the sending domain in Resend, publish SPF/DKIM/DMARC records. Propagation is re-checked at CP1 Sat noon (hard gate) and Sat night; the decision point is Sun noon (risk #7).
- **Cloudflare WAF rate rules** in the dashboard now, not Tuesday: 10 req/min/IP on the CFP submit endpoint, on `/api/internal/auth/*`, **and explicitly on the OTP verify route**. Screenshot the rules into `DECISIONS.md`.
- **Neon:** create `sb-dev`, `sb-test`, `sb-prod`; disable scale-to-zero on `sb-prod`; store pooled URLs as `DATABASE_URL` and direct URLs as `DATABASE_URL_DIRECT`.
- **R2:** create bucket `sb-files`; set CORS (`PUT,GET` from `APP_BASE_URL` + `http://localhost:3000`, header `content-type`, max-age 3600) — forgetting this is the #1 "uploads fail only in the browser" trap ([M07](./M07-r2-storage.md) depends on it).
- **Done when:** all four are done and evidenced in `DECISIONS.md`.

### 10. `scripts/check-invariants.sh` — the grep gate
Exit non-zero on any hit. Each grep excludes exactly one owner path:

| # | Banned pattern | Only allowed in |
|---|---|---|
| 1 | `dangerouslySetInnerHTML` | `src/shared/ui/app/rich-text-view.tsx` |
| 2 | `process.env.` | `src/shared/lib/env.ts`, **`src/app/page.tsx`** (the `NEXT_PUBLIC_BUILD_SHA` read from §1), `next.config.ts`, `drizzle.config.ts`, `scripts/**`, `e2e/**` |
| 3 | `from ['"]date-fns` / `date-fns-tz` | `src/shared/lib/time.ts` |
| 4 | `from ['"]resend` / `api.resend.com` | `src/features/comms/server/**` |
| 5 | `runtime = ['"]edge` | nowhere (repo-wide ban) |
| 6 | `insert(submissions)` / `INSERT INTO submissions` | `src/features/submissions/server/mutations.ts` |
| 7 | `insert(contacts)` / `update(contacts)` | `src/features/portal/server/contacts.ts`, **`scripts/seed/contacts.ts`** ([M09](./M09-seed-demo-script.md)'s declared seed exception) |
| 8 | `insert(communicationLogs)` / `INSERT INTO communication_logs` | `src/shared/server/enqueue-email.ts`, `src/features/comms/server/**` (covers [M36](./M36-reminder-scan.md)'s `retireRung` in `reminders.ts` and the dispatcher) |
| 9 | `as EventId\|as FormId\|as SubmissionId\|as ContactId` | `src/shared/contracts/**/*.test.ts` |
| 10 | `drizzle-kit push` | nowhere |
| 11 | R2 binding / `aws4fetch` import | `src/shared/server/r2.ts` ([M07](./M07-r2-storage.md)'s module boundary) |
| 12 | `from '(\.\./)+(store\|wizard\|steps)'` / `next/navigation` / `@/features/(portal\|submissions)` **inside** `src/features/forms/runtime/form-field-renderer.tsx` + `src/features/forms/runtime/field-inputs/` | nowhere — the `<FormFieldRenderer>` boundary grep ([M15](./M15-public-cfp-wizard.md)) |

**Greps 11 and 12 ship tonight, with the rest of the table.** They exist because [M07](./M07-r2-storage.md) and [M15](./M15-public-cfp-wizard.md) both need them and neither lane may edit this file: `scripts/check-invariants.sh` is architect-owned, and any later change to it is an **architect-labeled one-line PR**, never a direct edit from a feature lane (risk #8's hot-file rule).

- **Done when:** `pnpm invariants` exits 0 on the clean tree and exits 1 after you temporarily add `dangerouslySetInnerHTML` to `page.tsx`.

### 11. `.github/workflows/ci.yml` (PR gate) and `deploy.yml` (main)
CI job order (target < 8 min): install (pnpm cache) → `wrangler types` → **typecheck** ∥ **lint** → **invariants** → **vitest** (unit + PGlite) → **`next build` then `opennextjs-cloudflare build`** with a step that fails if gzipped `.open-next/worker.js` > 8 MiB → **Playwright** against Neon `sb-test`.
Deploy job (on `main`, after CI): `drizzle-kit migrate` with `DATABASE_URL_DIRECT` → `pnpm deploy:jobs` → `pnpm deploy:web` → `bash scripts/post-deploy-smoke.sh "$APP_BASE_URL"`.
Secrets: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL_DIRECT`, `NEON_TEST_URL`.
**Every deploy command must also run from a laptop** (Actions-outage fallback) — practise `pnpm deploy:web` locally once tonight and note it in `DECISIONS.md`.
- **Done when:** a throwaway PR that adds `const x: any = 1` goes **red**, and removing it goes **green**, with the CI run URL pasted into `DECISIONS.md`.

### 12. `src/app/api/health/route.ts`
`export const dynamic = 'force-dynamic'`. Returns `{ok, sha, db: <ms of SELECT 1>}` using `getCloudflareContext().env.DATABASE_URL` (**never `process.env`** — grep #2). Consumed by the post-deploy smoke ([M10](./M10-e2e-release.md)).
- **Done when:** `curl https://sb-web.<acct>.workers.dev/api/health` returns `{"ok":true,...}` with a non-null `db` timing.

### 13. `DECISIONS.md` skeleton
Sections, in this order: `## Pinned versions` · `## Spike results (S1–S4, C1–C2)` · `## Deferred spikes (Sat AM)` · `## Adopted fallbacks` · `## Discord clarifications` · `## Walkthrough-video diffs` · `## Infra facts (Neon/R2/Resend/Airtable/WAF ids)` · `## CP1 freeze record`.

### 14. Deferred spikes — hand-off note (run Sat AM in parallel with feature work, not tonight)
Write them into `DECISIONS.md` as an open checklist so nobody re-scopes them: **revalidate-60 behavior** (if S1 passed, confirm on a real public page), **aws4fetch presigned PUT from a browser incl. signed content-type + CORS** (→ [M07](./M07-r2-storage.md)), **PGlite applies our exact 0000/0001** (→ [M03](./M03-db-schema-migrations.md)), **`frame-ancestors *` survives OpenNext header handling on the deployed embed route** (→ [M33](./M33-embed-shells.md)).

### 15. CP1 freeze list (Sat noon) — publish it tonight so every agent knows what stops moving
At CP1 the architect declares frozen, and thereafter changes require an architect-labeled PR:
1. `src/shared/contracts/**` — every enum, DTO, snapshot/condition schema, idempotency recipe, fan-out constant, `FormFieldRendererProps` ([M02](./M02-shared-contracts.md)).
2. `src/db/schema/**` + `drizzle/0000_init.sql` + `drizzle/0001_views_triggers.sql` — additive-only afterwards; renames/drops/type-changes forbidden ([M03](./M03-db-schema-migrations.md)).
3. Every feature barrel signature dropped in Phase 0 (the stub list in [M02](./M02-shared-contracts.md)).
4. The pinned `next` + `@opennextjs/cloudflare` versions.
5. The invariant-grep table (§10) and the ESLint boundaries config.
CP1 additionally gates: migrations applied to sb-dev/sb-test/sb-prod, seed loads, admin login works, every route renders a stub page, CI+deploy green, **Resend domain verification checked (hard gate item)**.

## Acceptance criteria
Catalog AC, verbatim: *hello page live on Cloudflare Fri night; CI red/green demonstrably gates a PR; spike + check results written into `DECISIONS.md`; WAF rules visible in dashboard config.*

Verification commands:
```bash
curl -sS https://sb-web.<acct>.workers.dev/ | grep -q "openboard"
curl -sS https://sb-web.<acct>.workers.dev/api/health | jq -e '.ok == true'
pnpm check                       # all six gates locally
pnpm invariants                  # exits 0
gh pr checks <throwaway-pr>      # shows red before fix, green after
grep -c '^## ' DECISIONS.md      # ≥ 8 sections present
```

## Guardrails
- **Resolution #1:** single Next app. Do **not** create a pnpm workspace, `apps/`, or `packages/` — platform-integrations' topology is superseded. The only second deployable is `workers/jobs` ([M08](./M08-jobs-worker.md)), a plain wrangler worker with zero app imports.
- **Resolution #5:** `zod@^4`. If a spike shows ecosystem friction tonight, drop to v3 **the same hour** — contracts are hand-written either way, so it is a `package.json` line. Do not discover this Sunday.
- **Never set `export const runtime = 'edge'`.** OpenNext runs the Node runtime on Workers; the edge runtime is the Vercel path. Grep #5 exists because this failure mode looks like a random 500 at deploy time.
- **Pin, never bump** (risk #1). If a transitive dep breaks the OpenNext build, pin the transitive dep — do not move Next or the adapter.
- `opennextjs-cloudflare build` is a **required** CI gate, not a nice-to-have: it is what catches Workers-incompatible imports that `next build` happily accepts.
- Bundle budget: fail at gz > 8 MiB (paid limit is 10 MiB) so the warning arrives days before the wall. Server-side banned deps: `moment`/`moment-timezone`, the `airtable` npm SDK, `xlsx`, `ical-generator`, `lodash`, `isomorphic-dompurify`, `sharp`.
- Any spike failure adopts its **named** fallback within one hour. No re-litigation, no "let's try one more thing at 2 AM" (risk #1's trigger-to-abandon).
- Do not scaffold `src/features/**` or `src/shared/contracts/**` here — those are [M02](./M02-shared-contracts.md)'s and the feature agents'. M01 creating placeholder feature files causes exactly the merge conflicts the boundaries config exists to prevent.

## If blocked
- **Cloudflare account/billing not ready:** build everything else (configs, ESLint, CI, invariant script, health route) and run `pnpm preview` against the built output locally — that is 80% of the value of S1. Deploy the moment the account resolves.
- **Neon not provisioned:** run S3 (xss) and C1/C2 first; they need no DB. Write the `DECISIONS.md` skeleton and the CP1 freeze list.
- **A spike is failing and the hour is up:** adopt the fallback, write it down, move to the next spike. Then start [M02](./M02-shared-contracts.md)'s enum + branded-ID files — the fan-out gate matters more than a perfect skeleton.
- **Everything green early:** start the [M03](./M03-db-schema-migrations.md) DDL transcription (0000_init.sql), which is pure typing and is on the critical path for Sat AM.
