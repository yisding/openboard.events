# openboard — implementation status and recovery plan

- **Snapshot:** rev. 6 — Sun Aug 9, 2026, after the foundation stack #10 → #11 → #12 merged. Nine PRs are open and green; **none of them can land from the agent side**, so the R1 queue is now merge-bound rather than work-bound.
- **Baseline:** `main` after the merge of PR #12, plus status-only claim commits.
- **Deadline:** Wed Aug 12, 10:00 PM PT; submit by 8:00 PM PT. The buffer day is gone (PLAN delta #21).

This document is the current execution overlay for `PLAN.md` and `execution.md`. It records evidence and priority; it does not change frozen contracts, invariants, dependencies, or the minimum judging bar.

## 1. Counting rules

A module is `DONE` only when all four statements are true:

1. Its implementation is merged to `main`.
2. Its work-order acceptance criteria pass against the merged tree.
3. Any acceptance criterion that names Neon, Cloudflare, R2, Resend, Airtable, Gmail, Outlook, or a deployed preview has been demonstrated there; localhost or browser fixtures do not substitute.
4. The module's status cell links to the evidence.

Use these evidence labels in status notes:

- **MERGED-PARTIAL** — useful implementation is on `main`, but the module AC is not green.
- **STACK-DEMO** — merged code operates on the typed browser demo adapter or seed fixtures rather than the required server path.
- **SERVER-GAP** — the judged server/database/integration path does not exist yet.
- **REVIEW-BLOCKED** — a current review or CI failure must be fixed before merge.
- **PR-OPEN** — the implementation exists only on an unmerged PR branch. Rule 1 fails, so the module cannot be `DONE` and no downstream module may treat it as a satisfied hard dependency. Added in rev. 5 for the #10–#12 stack.

The rev. 4 audit remains a one-time exception to the normal "one active module per agent" claiming rule: `IN PROGRESS` in the reconciled headers records incomplete code already spread across the merged/demo stack, not 34 simultaneous active assignments. Each agent still owns only one active recovery module at a time.

## 2. Repository and PR baseline

| Ref | State | What it proves | What it does not prove |
|---|---|---|---|
| `main` / PRs #1–#5 | Merged | Next/OpenNext scaffold, broad typed browser demo, partial contracts/pure libs, jobs skeleton, SQL migration drafts, validation CI, release docs | Provisioned infrastructure, applied migrations, real auth/server adapters, external delivery, or any complete module |
| PR #6 — planning rebaseline | Merged | Evidence rules, recovery ordering, environment inventory, corrected module work orders | Runtime implementation or external proof |
| PR #7 — infrastructure reconciliation | Merged | Canonical Wrangler environments, fail-closed env validation, migration/deploy automation, Neon health probe, provisioning runbook | Any deployed acceptance evidence at merge time |
| PR #8 — jobs Worker routing | Merged | Preview jobs routing fix (`global_fetch_strictly_public`) and provisioning proof | Production jobs secrets or guarded stub swaps |
| PR #9 — contracts and pure foundation | Merged | Complete contract surface (branded ids, enums, DTOs, transitions, error envelopes, idempotency recipes, fan-out law), golden form-snapshot fixture, `compileFormSnapshot`, the 6-function timezone API, both sanitizer profiles, and the full condition/visibility/routing evaluator; 64 tests | Any database, auth, or deployed path; AC sign-off and the CP1 freeze declaration are still outstanding |
| PR #10 — database and server foundation | **Merged** | Full event-isolated schema, views, transition trigger, typed Drizzle modules, lazy HTTP/transaction clients, `defineHandler`, `enqueueEmail`, and 75 PGlite integration tests incl. all 49 submission transitions | The SQL is proven on PGlite, on a disposable Neon branch, `sb-dev` and `sb-test` — not on `sb-prod` and not through a green `Deploy` workflow run |
| PR #11 — admin auth | **Merged** | jose HS256 session cookies, Web Crypto PBKDF2 verification, `requireAdmin(eventId, role?)`, admin/API-key/cron/public guards, middleware redirects, sign-in throttle, `pnpm admin:bootstrap` | No deployed S4 round-trip. `pnpm admin:bootstrap` **could not run at all** until PR #21 — top-level `await` under tsx's CJS output killed it before it read an env var, so no admin has ever been bootstrapped |
| PR #12 — portal auth | **Merged** | Single-use hashed magic-link/OTP tokens with attempt limits, AES-GCM delivery payloads, durable portal sessions, impersonation, cookie middleware, throttle serialized under a contact row lock | No delivered email and no deployed proof. The deployed preview still predates this merge: `/api/internal/auth/portal/request` returns a Next 404 page there, observed by `scripts/load-test.ts` |

The stack landed in order, and the P1s rev. 5 recorded against it were answered inside those merges. What replaces that queue is the table below.

### 2a. Open PR queue — this is the current blocker

Nine PRs are open, green on CI, and unmergeable from the agent side. Until they land, four
recovery modules cannot be claimed at all, because a solid edge into a `PR-OPEN` module blocks a
claim exactly as `NOT STARTED` would.

| PR | Module | What it lands | Merge order |
|---|---|---|---|
| #15 | M07 | `shared/server/r2.ts`: kind policy, staging→published key scheme, presign/finalize/download, orphan sweep | 1 |
| #17 | M07 | The four upload routes; based on #15, retarget to `main` when it lands | 2, after #15 |
| #16 | M34 | Communications outbox dispatcher (another lane) | independent |
| #18 | M01 | Invariant grep #11 — no direct R2 access outside the storage module | independent |
| #19 | M10 step 1 | `playwright.config.ts`, helpers, six specs; 22 tests, 0 failures | independent |
| #20 | M09 steps 1–2 | Seed orchestrator, `seedId`, the eight per-lane stub modules | independent |
| #21 | M06a | Makes `pnpm admin:bootstrap` runnable at all | **land early — it gates a deployed sign-in** |
| #22 | M10 step 8 | Post-deploy smoke deepened to its seven documented assertions | after the cache header, or the deploy job goes red |
| #23 | M10 steps 9/10/12 | Load test, honest-status README, submission checklist | after #19 and #20, which its README references |
| #24 | M05a | `<DataTable>`, `<Dash>`, `<TzTime>`, `<ColorChip>`, `<ConfirmDialog>`, kitchen sink | independent |

**#22 is the one with a consequence.** `.github/workflows/deploy.yml` already calls the smoke
script, so merging it turns the deploy job red until the public schedule is served with
`s-maxage=60`. That is the honest state of the artifact, not a script defect — see §4.

## 3. Module status by evidence

No module is `DONE` as of this snapshot. Rule 1 alone keeps every `PR-OPEN` module out.

### Merged, AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M02 | PR #9: complete contract surface, golden fixture, signatures, idempotency recipes, fan-out law | Work-order AC sign-off against the merged tree and the CP1 freeze declaration in `DECISIONS.md` |
| M04 (pure half) | PR #9: `compileFormSnapshot`, `time.ts` 6-function API with DST coverage, both sanitizer profiles, slug/interval helpers | AC sign-off; the merged server-half evidence is recorded in the foundation stack below |
| M13a | PR #9: complete operator, visibility-traversal, hidden-answer-stripping and routing pipeline against the golden fixture | AC sign-off, including the 40+ test contract count |

### Merged, AC verification pending — the foundation stack

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M03 | PR #10 — schema, views, transition trigger, Drizzle modules, clients; migrations applied to a disposable Neon branch, then `sb-dev` and `sb-test` | `sb-prod`; the open view-semantics findings; a green `Deploy` workflow run that migrates through the journal |
| M04 (server half) | PR #10 — `defineHandler`, `enqueueEmail`, query/log/assert helpers, API client | AC sign-off |
| M06a | PR #11 — sessions, guards, middleware, throttle, bootstrap | A deployed auth round-trip, which needs PR #21 first: bootstrap could not run |
| M06b | PR #12 — OTP/magic link, tokens, sessions, impersonation | One delivered or logged `portal_login` email through M34; a preview deployed from a revision that actually contains these routes |

### Open on unmerged branches (`PR-OPEN`)

| Modules | Branch evidence | Blocking |
|---|---|---|
| M07 | PRs #15 + #17 — storage module and the four routes | Merge; the browser CORS proof; production S3 credentials; an R2 lifecycle rule on the `staging/` prefix |
| M34 | PR #16 — dispatcher, templates, renderer, Resend integration | Merge; real delivery evidence |
| M05a (primitives) | PR #24 — `<DataTable>`, `<Dash>`, `<TzTime>`, `<ColorChip>`, `<ConfirmDialog>`, kitchen sink | Merge; the `(admin)` route group remains unclaimed by design |
| M09 (orchestrator) | PR #20 — `SeedCtx`, `seedId`, the eight stub modules, `index.ts` | Merge; a run against a real database; the eight per-lane seed bodies |
| M10 (steps 1, 8–10, 12) | PRs #19, #22, #23 — spec skeleton, deepened smoke, load test, README, checklist | Merge; the specs go green only as their features land |

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, validation CI; **preview is live** at `https://sb-web-preview.yi-ding.workers.dev` with a real Neon round-trip and a measured 1206.45 KiB gzip artifact inside the Workers Free budget | Resend DNS/header probe, browser R2 presign/CORS, the revalidate-60 spike, a deployed application-throttle proof, and a green `Deploy` workflow run from `main` |
| M05a | Demo admin shell, event resolution, accessible controls, stub routes, core primitives | shadcn generation, `<DataTable>`, `<ConfirmDialog>`, `<Dash>`, `<TzTime>`, kitchen-sink page, and `(admin)` auth wiring against merged M06a |
| M08 | Secret-guarded job routes, trigger worker, canonical config; **a preview jobs tick reached the web Worker and returned `{ ok: true, stats: { noop: 1 } }` in 1 ms CPU** | Production `CRON_SECRET` on both Workers, tail evidence, and AC-gated stub swaps |
| M09 | Typed browser fixture seed | Database seed orchestrator (`scripts/seed/**` does not exist), wipe/reset, all feature seeds, judge credentials |
| M10 | Release docs, validation CI, smoke placeholder | `playwright.config.ts` and `e2e/` do not exist; the six-spec skeleton is the CP1 gate item |
| M38 | Fixture-backed dashboard surface | Aggregated server endpoint, task-count law, polling, database-backed judged update |

### Merged demo-stack implementation

These modules have useful UI or pure-function slices merged through PRs #2/#4/#5 and are `IN PROGRESS`, but their server/integration AC remains open:

- PR #2 lineage: M11–M15, M17–M20.
- PR #4 lineage: M21–M23, M25–M29, M31–M33, M41.
- PR #5 lineage: M03 UI-adjacent slices, M10, M35, M37, M40, plus additional M11 UI.

The following modules remain `NOT STARTED` at their substantive boundary despite nearby stubs or demo controls: M05b, M07, M16, M24, M30, M34, M36, and M39. (M06a and M06b left this list in rev. 5; they are merged with AC verification pending.)

### Temporary ownership grant

PR #12 used M06b's documented contingency and created `src/features/portal/server/contacts.ts` containing exactly `getOrCreateContact` and `updateContactFields`, because M21's Step 0 had not landed. The grant is recorded in `DECISIONS.md`; **ownership returns to M21/WS-D the moment the stack merges**, and resolution #13 continues to forbid any other `contacts` write path.

## 4. Checkpoint truth

| Checkpoint | Status | Evidence required to turn green |
|---|---|---|
| CP0 — deployed skeleton and existential spikes | **PARTIAL** | Green: preview Cloudflare URL, real `/api/health` Neon `18.4` round-trip in 155 ms, measured bundle (1416.09 KiB with the R2 routes and the shared primitives) under the Free 3 MiB budget, jobs tick round-trip, and **embed `frame-ancestors` now proven by curl** — `/embed/<slug>/schedule` sends `frame-ancestors *` and no `X-Frame-Options`. Missing: Resend DNS/header probe, browser R2 presign/CORS, a deployed auth-throttle proof, and **revalidate-60, which is now a measured failure rather than an unknown**: `/e/<slug>/schedule` is served `private, no-cache, no-store, max-age=0, must-revalidate` |
| CP1 — contracts/schema/foundation freeze | **NOT MET** | Green: contracts merged; the #10–#12 stack merged; migrations applied to `sb-dev` and `sb-test`. Missing: `sb-prod`, a real seed run, admin login demonstrated on the preview, a green `Deploy` workflow run, the six-spec skeleton **merged** (it exists and runs on PR #19), and the freeze declaration |
| Sat thin slice — CFP to Abstracts | **NOT MET** | Deployed fixture-snapshot form posts through the real server transaction into Neon and appears in Abstracts |
| CP2 — golden spine | **NOT MET** | Real OTP, submit, review, accept/notify, one delivered/logged email, portal task, public schedule/gallery, e2e and load evidence |
| CP3 — full judged feature surface | **NOT ATTEMPTED** | Deployed portal upload/task, scheduling/conflict, embed, ICS lifecycle, reminder scan, tracking dashboard |
| CP4 — feature freeze/release proof | **NOT ATTEMPTED** | Six e2e specs, load/perf record, post-deploy smoke, security review, docs/spend and submission checklist |

Until CP1 is green, daily demo claims must say **local browser demo**, never **end to end**. A claim may now say **deployed preview** only for the surfaces actually proven above (health, public probes, jobs tick) — not for auth, submission, or delivery.

## 5. Recovery gates

Execute gates in order. Later gates may prepare pure tests and fixtures, but no new UI surface or bonus work may displace an earlier red gate.

### R0 — Rebaseline and protect the stack — **EXITED**

Landed via PRs #6–#8: the status overlay and reconciled module headers, the infrastructure reconciliation, and the jobs routing fix. Private fixture APIs and unverified calendar routes remain fail-closed. Clean-install validation CI is green on `main`.

### R1 — Deployed foundation — **ACTIVE**

**The gate is no longer work-bound. It is merge-bound**: every numbered item below except 7 and 8
exists as a green PR in §2a that nobody has landed.

Ordered remaining work:

1. Land §2a in its stated order, starting with **#21** — until it merges no admin can be
   bootstrapped, so a deployed sign-in cannot be demonstrated at all.
2. Redeploy the preview. The currently deployed revision predates the portal-auth merge, so every
   claim about auth on that URL is a claim about code that is not there.
3. Keep `drizzle/` additive-only now that `0000_init.sql` is journaled and applied. Every new migration — starting with #11's `admin_login_attempts` fix — runs on the disposable branch first, then `sb-dev` **and** `sb-test`, before `sb-prod` goes through the guarded production deployment step. `pnpm db:migrate` applies pending journal entries to whichever database `DATABASE_URL` points at, and the deploy workflow only ever migrates the environment it is deploying (preview → `sb-test`, production → `sb-prod`), so **`sb-dev` is nobody's job unless someone runs it**. A stale `sb-dev` silently breaks the auth and seed work that develops against it.
4. M05a's remaining primitives are on **#24**. The `(admin)` route-group move stays deliberately
   unclaimed: those route files belong to six lanes and moving them is a merge collision.
5. M07 is on **#15 + #17**; M09's orchestrator is on **#20**. The eight per-feature seed bodies
   remain with their own workstreams and are the real remaining seed work.
6. M10's CP1 slice is on **#19** — six specs, 22 tests, zero failures, every unlanded step skipped
   behind one table that flips as modules merge.
7. Finish the deploy half of M08 and make the GitHub `Deploy` workflow itself green for preview — every run so far has been `skipped`. Note that **#22 makes the smoke step fail honestly** until the public schedule is served with `s-maxage=60`.
8. Complete the remaining provisioning in §7.

**Exit:** CP0 and CP1 are green on a deployed preview, including the admin shell and the runnable six-spec Playwright skeleton.

### R2 — Server-backed golden spine

- Finish M05b before M12's rich-text integration; its prop-stub slice may land first, but the complete rich primitives remain part of this gate.
- Finish M11–M18 and M34 against PR #9's snapshot/evaluator contract, which is merged and stable but **pending its CP1 freeze declaration** — until that declaration lands in `DECISIONS.md`, a contract change is still an architect call rather than a protocol violation.
- Replace fixed OTP/localStorage submission and decision logging with auth, Neon transactions, deadline/limit enforcement, outbox enqueue, dispatcher delivery, and event-scoped reads.
- Prove the thin slice first; then accept/notify with exactly one email and portal link.

**Exit:** Sat thin slice and CP2's CFP→review→notify path are green on the preview.

### R3 — Judged portal, program, and tracking loop

- Finish the minimum slices of M19, M21/M22/M23/M25, M28/M29/M32/M33, M35/M36, and M38.
- Prove reviewer assignment and persisted scoring plus real R2 headshot/slides upload, portal completion, manual schedule placement with conflict detection, published schedule/gallery/embed, ICS token authorization/lifecycle, reminders, and dashboard count change.
- M30 drag-and-drop, M31 alternate views, and M37 polish remain subordinate to the minimum loop; manual scheduling is the accepted cut-line fallback.

**Exit:** the complete minimum judging bar in PLAN §9 works from a fresh browser on the deployed URL.

### R4 — Release proof

- Complete M10 after its R1 skeleton: make all six Playwright specs green, run the 50-concurrent submit load test, and finish post-deploy smoke, rollback rehearsal, public-repo docs, `docs/spend/`, and the submission checklist.
- Run the judge script cold, including fresh Gmail and Outlook OTP/email/invite probes.
- Fix P0s only after feature freeze; submit by 8:00 PM PT.

**Exit:** CP4 is green and the submission is accepted.

## 6. Immediate scope control

Bonus work and cosmetic expansion stay paused until R3 exits:

- M39 Airtable and M40 public API are deferred; security fixes may disable or remove unsafe draft routes without replacing them yet.
- M30 drag-and-drop uses the existing manual-placement fallback unless the minimum loop is already green.
- M31 Week/Track/Room views, M37 communications polish, Today-dashboard polish, and additional field types do not block the judging bar.
- Do not add new seed-only behavior to claim progress on a server AC.

The next action is **not an implementation action**. It is landing §2a: nine green PRs, in the
stated order, starting with #21. Four recovery modules cannot even be *claimed* until M07 and the
primitives are on `main`, so additional agent work now produces more unmerged branches rather than
more progress.

## 7. Environment and configuration truth

[`environments.md`](environments.md) is the canonical provisioning inventory; [`../docs/provisioning.md`](../docs/provisioning.md) is the live checklist.

**Provisioned since rev. 4:**

- Neon project `sb` with isolated `sb-dev`, `sb-test`, `sb-prod` branches. Both migrations were proven on an expiring disposable branch, then applied to `sb-dev` and `sb-test`.
- R2 buckets `sb-files-preview` and `sb-files` in WNAM with exact-origin CORS.
- Preview web and jobs Workers deployed at `https://sb-web-preview.yi-ding.workers.dev`; the repository smoke script passed its health, public schedule, and public API probes. `global_fetch_strictly_public` resolved the Worker-to-Worker error 1042.
- GitHub `preview` and `production` environments restricted to `main`, production gated on `yisding` approval, `PRODUCTION_DEPLOY_ENABLED` unset.
- Exact preview and production origins recorded; no hostname is guessed in committed config.

**Corrections since rev. 5:**

- `pnpm admin:bootstrap` was never runnable. Top-level `await` under tsx's CJS output aborted it
  in esbuild before it read an environment variable, so the "password-backed organizer and
  reviewer accounts" step of the provisioning checklist has never been executed anywhere. PR #21
  fixes it; the checklist item stays unchecked until it has actually been run.
- The deployed preview is behind `main`. `/api/internal/auth/portal/request` returns a Next 404
  page there, so the portal-auth merge is not on the deployed artifact.

**Still pending (31 unchecked items in the provisioning checklist):**

- Production `SESSION_SECRET` and `CRON_SECRET`; the pooled and direct Neon URLs saved per environment; R2 Object Read & Write S3 credentials.
- A least-privilege Cloudflare API token moved off repository scope into both protected environments.
- GitHub environment secrets and variables, and a `Deploy` workflow run that actually completes migration → web → jobs → smoke for preview. Preview was deployed with `scripts/deploy-cloudflare.sh`; all three `Deploy` runs on `main` were `skipped`.
- The entire Resend track: verified sending subdomain, SPF/DKIM/DMARC, real `EMAIL_FROM`, production API key, and fresh Gmail/Outlook OTP and calendar delivery evidence recorded in `DECISIONS.md`. **Nothing about email delivery is proven, which makes it the largest single risk to CP2.**
- The entire production section, including `sb-prod` migration, secrets, `EMAIL_MODE=send` with `EMAIL_FALLBACK_UI=0` and no `TEST_AUTH`, and the production health/cron confirmation.

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`. A custom-domain WAF rule is optional defense-in-depth and is not applicable to a `workers.dev` hostname.
