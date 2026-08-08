# openboard — implementation status and recovery plan

- **Snapshot:** Sat Aug 8, 2026, after PRs #1–#5 merged and the infrastructure configuration was reconciled on top of the PR #6 planning branch.
- **Baseline:** `main` at `37c55fc`; PR #6 remains the open planning rebaseline.
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

A navigable route, fixture-backed API, localStorage mutation, fixed demo OTP, file picker without R2, or successful local production build is progress, not module completion.

The rev. 4 audit is a one-time exception to the normal "one active module per agent" claiming rule: `IN PROGRESS` in the reconciled headers records incomplete code already spread across the merged/demo stack, not 34 simultaneous active assignments. From this point forward, each agent still owns only one active recovery module at a time.

## 2. Repository and PR baseline

| Ref | State | What it proves | What it does not prove |
|---|---|---|---|
| `main` / PRs #1–#5 | Merged | Next/OpenNext scaffold, broad typed browser demo, partial contracts/pure libs, jobs skeleton, SQL migration drafts, validation CI, release docs, and review hardening | Provisioned infrastructure, applied migrations, real auth/server adapters, external delivery, or any complete module |
| PR #6 — planning rebaseline | Open | Current evidence rules, recovery ordering, environment inventory, and corrected module work orders | Runtime implementation or external proof |
| Infrastructure reconciliation branch | In review | Canonical Wrangler environments, fail-closed env validation, migration/deploy automation, Neon health probe, and provisioning runbook | Any Cloudflare/Neon/Resend mutation or deployed acceptance evidence |

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

### Merged demo-stack implementation

These modules have useful UI or pure-function slices merged through PRs #2/#4/#5 and are `IN PROGRESS`, but their server/integration AC remains open:

- PR #2 lineage: M11–M15, M17–M20.
- PR #4 lineage: M21–M23, M25–M29, M31–M33, M41.
- PR #5 lineage: M03, M10, M35, M37, M40, plus additional M11 UI.

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
- Keep PR #6 current with `main` and land the infrastructure reconciliation without rewriting its history.
- Keep private fixture APIs fail-closed until database-backed event-scoped authorization exists.
- Keep unsafe fixture APIs and unverified calendar routes unavailable, or explicitly demo-only, until authorization and scoping exist.

**Exit:** the PR stack and module ledger tell the same truth; no known P1 is disguised as release polish.

### R1 — Deployed foundation

- Finish M01–M05a, M06a/M06b, M07, M09, the deploy half of M08, and M10's CP1 slice (`playwright.config.ts`, shared helpers, and all six skeleton specs running with zero failures; unlanded feature steps remain explicitly skipped).
- Apply corrected, event-isolated migrations to disposable Neon first, then `sb-dev`, `sb-test`, and `sb-prod`.
- Configure Cloudflare web/jobs workers, R2, secrets, auth, Resend domain/header checks, and real database seed/reset.
- Make clean-install CI and deploy green from `main`.

**Exit:** CP0 and CP1 are green on a deployed preview, including the admin shell and the runnable six-spec Playwright skeleton.

### R2 — Server-backed golden spine

- Finish M05b before M12's rich-text integration; its prop-stub slice may land first, but the complete rich primitives remain part of this gate.
- Finish the shared form snapshot/evaluator contract, then M11–M18 and M34.
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

Effective now, pause bonus work and cosmetic expansion until R3 exits:

- M39 Airtable and M40 public API are deferred; security fixes may disable or remove unsafe draft routes without replacing them yet.
- M30 drag-and-drop uses the existing manual-placement fallback unless the minimum loop is already green.
- M31 Week/Track/Room views, M37 communications polish, Today-dashboard polish, and additional field types do not block the judging bar.
- Do not add new seed-only behavior to claim progress on a server AC.

The next implementation action after the configuration reconciliation merges is **R1 provisioning**: create the isolated Cloudflare/R2 and Neon resources, install protected secrets, deploy preview in order, and capture CP0 evidence before feature work resumes.

## 7. Environment and configuration truth

[`environments.md`](environments.md) is the canonical provisioning inventory. The
Workers account may start on Free: an Aug 8 Wrangler dry-run measured the current OpenNext
artifact at `1204.60 KiB` gzip, below Free's 3 MB limit. Paid becomes required only if the
production candidate approaches the 2.5 MB warning line or deployed SSR/auth/database CPU
evidence cannot safely fit Free's 10 ms allowance.

Checked-in configuration is now code-ready: canonical Worker names, isolated R2 bindings,
named environments, runtime validation, generated binding checks, and ordered migration/web/
jobs/smoke automation agree. Exact URLs are mandatory deploy inputs, not guessed config.

It is still not provisioned infrastructure. The Cloudflare/R2 resources, Neon branches,
Worker secrets, GitHub protected-environment values, Resend configuration, and deployed
acceptance evidence are all pending; see [`../docs/provisioning.md`](../docs/provisioning.md).

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All
database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`.
Production must leave `TEST_AUTH` unset and `EMAIL_FALLBACK_UI=0`; preview-only fallback
surfaces never count as production OTP evidence. A custom-domain WAF rule is optional
defense-in-depth and is not supplied by Workers Paid or applicable to a workers.dev hostname.
