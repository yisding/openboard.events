# openboard — implementation status and recovery plan

- **Snapshot:** Sat Aug 8, 2026, immediately after PR #3 merged to `main` and the stacked implementation through PR #5 was audited.
- **Baseline:** `main` at `d67a902` (PR #1 foundation + PR #3 judged-path hardening).
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
- **STACK-DEMO** — useful code exists only in PR #2, #4, or #5 and operates on the typed browser demo adapter or seed fixtures.
- **SERVER-GAP** — the judged server/database/integration path does not exist yet.
- **REVIEW-BLOCKED** — a current review or CI failure must be fixed before merge.

A navigable route, fixture-backed API, localStorage mutation, fixed demo OTP, file picker without R2, or successful local production build is progress, not module completion.

The rev. 4 audit is a one-time exception to the normal "one active module per agent" claiming rule: `IN PROGRESS` in the reconciled headers records incomplete code already spread across the merged/demo stack, not 34 simultaneous active assignments. From this point forward, each agent still owns only one active recovery module at a time.

## 2. Repository and PR baseline

| Ref | State | What it proves | What it does not prove |
|---|---|---|---|
| `main` / PR #1 + PR #3 | Merged | Next/OpenNext scaffold, typed demo adapter, partial contracts and pure libs, admin shell, jobs trigger skeleton, judged-path requirements hardening | CI/deploy pipeline, external resources, auth, database-backed flows, or any complete module |
| PR #2 — CFP/review | Open | Broad CFP, form-builder, abstracts, CSV, and evaluation **STACK-DEMO** surfaces; local lint/types/tests/build | M11–M20 server AC, real OTP, transactional submission limits, Neon persistence, or outbox delivery |
| PR #4 — portal/agenda | Draft on PR #2 | Broad portal, tasks, resources, speakers, agenda, conflict, public, and embed **STACK-DEMO** surfaces | Auth, R2, server task completion, database scheduling, published-view isolation, or deployed embeds |
| PR #5 — comms/release | Draft on PR #4; CI red | Communications/settings UI, fixture APIs/calendar routes, migration/CI/docs/release scaffolding, local Next and OpenNext builds | Merge safety, valid/applied migrations, scoped APIs, verified tokens, real jobs/email/calendar delivery, deployment, or release proof |

PR #5 currently has 12 unresolved review threads. Ten are current: nine P1 findings and one P2. The P1 set includes CI install failure, private-response caching, cross-event integrity, invalid PostgreSQL constraints, API event scoping/data leakage, calendar identity, malformed ICS, and missing calendar-token authorization. Two additional P1 threads are outdated by the latest commit but still unresolved.

## 3. Module status by evidence

No module is `DONE` as of this snapshot.

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, local build path | Green clean-install CI, canonical env/deploy workflow, Cloudflare URL, measured Workers plan gate, application throttles, external spikes |
| M02 | Partial form/job enums and schemas | Complete frozen contracts, fixtures, signatures, key recipes, cross-feature DTOs |
| M04 | Partial condition, interval, sanitizer, slug, and UI helpers | Snapshot compiler, time API, server adapters, complete test/grep contract |
| M05a | Demo admin shell and core primitives | Auth route group, required primitives, DataTable, accessibility/kitchen-sink AC |
| M08 | Secret-guarded no-op job routes and trigger worker | Deployed worker-to-web proof, secrets on both workers, later guarded stub swaps |
| M09 | Typed browser fixture seed | Database seed orchestrator, wipe/reset, all feature seeds, judge credentials |
| M13a | Basic operator evaluator and 14 tests | Visibility pass, hidden-answer stripping, routing, fixture case, 40+ contract tests |
| M38 | Fixture-backed dashboard surface | Aggregated server endpoint, task-count law, polling, database-backed judged update |

### Unmerged demo-stack implementation

These modules have useful UI or pure-function slices in PR #2/#4/#5 and are `IN PROGRESS`, but their server/integration AC remains open:

- PR #2: M11–M15, M17–M20.
- PR #4: M21–M23, M25–M29, M31–M33, M41.
- PR #5: M03, M10, M35, M37, M40, plus additional M11 UI.

The following modules remain `NOT STARTED` at their substantive boundary despite nearby stubs or demo controls: M05b, M06a, M06b, M07, M16, M24, M30, M34, M36, and M39.

## 4. Checkpoint truth

| Checkpoint | Status | Evidence required to turn green |
|---|---|---|
| CP0 — deployed skeleton and existential spikes | **NOT MET** | Cloudflare URL, real health round-trip, S1–S4/C1–C2 results, measured bundle/CPU plan decision, application auth-throttle proof, Resend DNS/header probe |
| CP1 — contracts/schema/foundation freeze | **NOT MET** | Valid migrations on all three DBs, real seed, admin auth, all routes, green CI/deploy, frozen complete contracts |
| Sat thin slice — CFP to Abstracts | **NOT MET** | Deployed fixture-snapshot form posts through the real server transaction into Neon and appears in Abstracts |
| CP2 — golden spine | **NOT MET** | Real OTP, submit, review, accept/notify, one delivered/logged email, portal task, public schedule/gallery, e2e and load evidence |
| CP3 — full judged feature surface | **NOT ATTEMPTED** | Deployed portal upload/task, scheduling/conflict, embed, ICS lifecycle, reminder scan, tracking dashboard |
| CP4 — feature freeze/release proof | **NOT ATTEMPTED** | Six e2e specs, load/perf record, post-deploy smoke, security review, docs/spend and submission checklist |

Until CP1 is green, daily demo claims must say **local browser demo**, never **deployed preview** or **end to end**.

## 5. Recovery gates

Execute gates in order. Later gates may prepare pure tests and fixtures, but no new UI surface or bonus work may displace an earlier red gate.

### R0 — Rebaseline and protect the stack

- Land this status overlay and reconcile affected module headers.
- Rebase PR #2 on current `main`; preserve PR #4 → #5 stacking until their bases are safe.
- Fix PR #5's clean-install CI failure and all current P1 findings before it can leave draft.
- Keep unsafe fixture APIs and unverified calendar routes unavailable, or explicitly demo-only, until authorization and scoping exist.

**Exit:** the PR stack and module ledger tell the same truth; no known P1 is disguised as release polish.

### R1 — Deployed foundation

- Finish M01–M04, M06a/M06b, M07, M09, and the deploy half of M08.
- Apply corrected, event-isolated migrations to disposable Neon first, then `sb-dev`, `sb-test`, and `sb-prod`.
- Configure Cloudflare web/jobs workers, R2, secrets, auth, Resend domain/header checks, and real database seed/reset.
- Make clean-install CI and deploy green from `main`.

**Exit:** CP0 and CP1 are green on a deployed preview.

### R2 — Server-backed golden spine

- Finish the shared form snapshot/evaluator contract, then M11–M18 and M34.
- Replace fixed OTP/localStorage submission and decision logging with auth, Neon transactions, deadline/limit enforcement, outbox enqueue, dispatcher delivery, and event-scoped reads.
- Prove the thin slice first; then accept/notify with exactly one email and portal link.

**Exit:** Sat thin slice and CP2's CFP→review→notify path are green on the preview.

### R3 — Judged portal, program, and tracking loop

- Finish the minimum slices of M21/M22/M23/M25, M28/M29/M32/M33, M35/M36, and M38.
- Prove real R2 headshot/slides upload, portal completion, manual schedule placement with conflict detection, published schedule/gallery/embed, ICS token authorization/lifecycle, reminders, and dashboard count change.
- M30 drag-and-drop, M31 alternate views, and M37 polish remain subordinate to the minimum loop; manual scheduling is the accepted cut-line fallback.

**Exit:** the complete minimum judging bar in PLAN §9 works from a fresh browser on the deployed URL.

### R4 — Release proof

- Finish M10: six Playwright specs, 50-concurrent submit load test, post-deploy smoke, rollback rehearsal, public-repo docs, `docs/spend/`, and submission checklist.
- Run the judge script cold, including fresh Gmail and Outlook OTP/email/invite probes.
- Fix P0s only after feature freeze; submit by 8:00 PM PT.

**Exit:** CP4 is green and the submission is accepted.

## 6. Immediate scope control

Effective now, pause bonus work and cosmetic expansion until R3 exits:

- M39 Airtable and M40 public API are deferred; security fixes may disable or remove unsafe draft routes without replacing them yet.
- M30 drag-and-drop uses the existing manual-placement fallback unless the minimum loop is already green.
- M31 Week/Track/Room views, M37 communications polish, Today-dashboard polish, and additional field types do not block the judging bar.
- Do not add new seed-only behavior to claim progress on a server AC.

The next implementation action after this documentation change is **R0: make PR #2 current and make the stacked review/CI blockers explicit before merging any demo stack**.

## 7. Environment and configuration truth

[`environments.md`](environments.md) is the canonical provisioning inventory. The
Workers account may start on Free: an Aug 8 Wrangler dry-run measured the current OpenNext
artifact at `1122.48 KiB` gzip, below Free's 3 MB limit. Paid becomes required only if the
production candidate approaches the 2.5 MB warning line or deployed SSR/auth/database CPU
evidence cannot safely fit Free's 10 ms allowance.

Current checked-in configuration is not provisioned infrastructure and has these R1 gaps:

- worker names are `openboard-web` / `openboard-jobs` instead of `sb-web` / `sb-jobs`;
- both R2 bindings use `openboard-files` instead of isolated preview/production buckets;
- the web URL is localhost and the jobs production URL is a placeholder;
- the web config has no named preview/production environments;
- the env accessor currently exposes only `CRON_SECRET`;
- `main` has no GitHub Actions workflow; PR #5 proposes validation-only CI and still does
  not migrate or deploy.

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All
database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`.
Production must leave `TEST_AUTH` unset and `EMAIL_FALLBACK_UI=0`; preview-only fallback
surfaces never count as production OTP evidence. A custom-domain WAF rule is optional
defense-in-depth and is not supplied by Workers Paid or applicable to a workers.dev hostname.
