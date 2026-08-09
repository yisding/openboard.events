# M10 — Golden-path e2e, release engineering, open-source repo

| | |
|---|---|
| **Status** | IN PROGRESS — reclaimed by Codex for the PR #70/#75 operational review follow-ups: defer retryable smoke failures until retries are exhausted, correct the load-test serialization/Hyperdrive conclusions, and synchronize release trackers. **MERGED-PARTIAL** release docs, validation CI, smoke, license scaffolding, and the 50-concurrent preview load test exist (50/50 `200`, p95 27703 ms). Remaining after this recovery: real Playwright step bodies, production deployment, spend proof, and the release AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect, in the integrator role after Saturday) |
| **Scheduled** | Skeleton at CP1 (plan-Sat) → **golden-path spec green + 50-concurrent load test at CP2 (plan-Sun night)** → all 6 specs green at CP4 (Wed Aug 12, 2 PM PT) → repo public + submission that evening |
| **Size** | M |
| **Paths owned** | `e2e/**` (6 specs + fixtures + `e2e/helpers/*`), `playwright.config.ts`, `scripts/post-deploy-smoke.sh`, `scripts/load-test.ts`, `README.md`, `LICENSE`, `docs/spend/**`, `docs/submission-checklist.md`. **NOT owned: `docs/api.md` — [M40](./M40-public-api.md) is its sole owner** (both modules land Tuesday, in different workstreams; PLAN §6 makes disjoint file ownership the anti-merge-hell device) |

## Objective
The judge's path is proven by machine, not by memory: six Playwright smokes run against a real Neon `sb-test` database, a curl smoke asserts the deployed artifact's contracts after every deploy, and a 10-line load test proves the submit endpoint survives 50 concurrent submissions. The repo is public, reproducible from a clean clone, documented, licensed, and the reimbursement evidence is filed.

## Dependencies
- **Hard (blocks start):** [M01](./M01-scaffold-ci-deploy.md) (CI pipeline + deploy job to hang the steps on), [M03](./M03-db-schema-migrations.md) (`sb-test` migrated), [M09](./M09-seed-demo-script.md) (seeded artifacts every spec asserts on), [M06a](./M06a-admin-auth.md)'s `POST /api/test/login` (`TEST_AUTH=1`).
- **Hard for individual specs (each spec unblocks as its module lands):** [M16](./M16-submit-pipeline.md) + [M15](./M15-public-cfp-wizard.md) → `cfp-submit`; [M18](./M18-submission-mutations-notify.md) + [M17](./M17-abstracts-table.md) → `abstracts-decide`; [M25](./M25-task-runtime.md) + [M06b](./M06b-portal-auth.md) → `portal-tasks`; [M30](./M30-day-grid-dnd.md)/[M28](./M28-sessions-crud.md) + [M29](./M29-conflict-engine.md) → `agenda-schedule`; [M32](./M32-public-schedule-gallery.md) + [M33](./M33-embed-shells.md) → `public-embeds`; [M34](./M34-comms-outbox-dispatcher.md) → the comms assertions inside `abstracts-decide`.
- **Soft (start against stub/fixture):** write **every spec's skeleton at CP1** with `test.skip` on the un-landed steps and real assertions on the seeded data that already exists. A spec that appears the day its feature lands has never been debugged; a spec that has been running skipped since Saturday goes green in minutes.

## Provides (interfaces others consume)
- `pnpm e2e` (all specs) / `pnpm e2e --grep <name>` — every workstream runs its own spec before merging.
- `e2e/helpers/`: `loginAsAdmin(page, email)` (via `/api/test/login`), `loginAsSpeaker(page, email)` (requests the normal portal challenge and reads preview-only `EMAIL_FALLBACK_UI=1` diagnostics), `seedReset()`, `expectNoConsoleErrors(page)`. No seeded bearer token exists.
- `bash scripts/post-deploy-smoke.sh <baseUrl>` — called by [M01](./M01-scaffold-ci-deploy.md)'s deploy job **and** runnable from a laptop.
- `README.md` — the open-source deliverable. It **links** `docs/api.md`, which is owned and written by [M40](./M40-public-api.md); this module never edits that file.
- `docs/spend/` — the daily token/cost evidence the brief's $500 reimbursement "will ask for proof" of.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — config, helpers, and six skeleton specs at CP1
Files: `playwright.config.ts`, `e2e/helpers/*.ts`, and six `*.spec.ts` files whose steps are written out as `test.step(...)` blocks with `test.skip()` markers where the feature has not landed.
`playwright.config.ts`: chromium only, `baseURL` from `E2E_BASE_URL` (defaults to the deployed preview), `retries: 1`, `trace: 'on-first-retry'`, `workers: 1` (they share one `sb-test` database), and a `globalSetup` that runs `pnpm seed --wipe` against `NEON_TEST_URL`.
**Resolution #6/#7: specs run against the real Neon `sb-test` database, not PGlite.** PGlite stays vitest-only — there is no `DB_DRIVER` seam behind a running Next server, and building one is banned.
- **Done when:** `pnpm e2e` runs, reports 6 specs with most steps skipped, and 0 failures.

**Spec → unblocking module → target checkpoint** (this table is the skip-removal schedule; keep it current in the file header):

| Spec | Goes green when | Target | Owner of the feature under test |
|---|---|---|---|
| `admin-setup` | [M11](./M11-events-feature.md) + [M12](./M12-form-builder-core.md) | Sun (CP2) | WS-B1 |
| `cfp-submit` | [M15](./M15-public-cfp-wizard.md) + [M16](./M16-submit-pipeline.md) + [M06b](./M06b-portal-auth.md) | **Sun (CP2) — the gate** | WS-B2 |
| `abstracts-decide` | [M17](./M17-abstracts-table.md) + [M18](./M18-submission-mutations-notify.md) + [M34](./M34-comms-outbox-dispatcher.md) | Sun (CP2) | WS-C / WS-F |
| `portal-tasks` | [M21](./M21-portal-shell.md) + [M22](./M22-speaker-profile.md) + [M25](./M25-task-runtime.md) | Mon (CP3) | WS-D |
| `agenda-schedule` | [M28](./M28-sessions-crud.md) + [M29](./M29-conflict-engine.md) + [M31](./M31-agenda-views.md) | Mon (CP3) | WS-E |
| `public-embeds` | [M32](./M32-public-schedule-gallery.md) + [M33](./M33-embed-shells.md) + [M40](./M40-public-api.md) | Sun public pages / Tue API | WS-E / WS-F |

### 2. `admin-setup.spec` (unblocked earliest — write it first, fully)
Log in as organizer → create an event (name, slug, tz, starts/ends in event tz) → add a track, a room, a format → open the form builder → add a dropdown field, a conditional field, and a routing rule → set the form open → **Copy Link** yields a `/submit/<slug>/<formId>` URL that returns 200.
Assertions that catch real bugs: `endsAt <= startsAt` is rejected inline; a reserved slug (`api`) is rejected; the new event's Settings page shows **8 default email templates** (7 domain keys + `portal_login`) (proves [M11](./M11-events-feature.md) called `seedDefaultTemplates`).

### 3. `cfp-submit.spec` — the spine (this is CP2's gate)
Public wizard end-to-end on the **seeded form A**: Welcome shows the deadline in event tz with the zone label ("until … 11:59 PM PDT") and the "Submission Limit: 3" banner → Account step (email + OTP via the fallback UI) → **assert a server draft row now exists** (visible as a Drafts-tab count in admin, or via the portal) → Submission step: the conditional field appears when Format = Workshop and disappears otherwise, and **the stale hidden answer is not submitted** (assert on the Review step read-back) → Participant step → Review → submit → success page.
Then: reload mid-wizard preserves answers (Zustand persist); a second submit past the seeded limit shows the friendly `LIMIT_REACHED` block; the closed **form B** renders the branded closed page.
Mobile: run this spec at a **390px viewport** as well — the brief's judge submits from a phone.
- **Done when:** `pnpm e2e --grep cfp-submit` is green **against the deployed preview** at CP2 with zero `test.skip` remaining in the file. This spec passing *is* the definition of "the golden path is green".

### 4. `abstracts-decide.spec`
Admin → Abstracts: tab counts match `submission_status_counts_v` → open the detail drawer and assert the **Answers tab** shows the submitted Q&A with labels from the pinned snapshot → bulk-select 2 rows → move to Accept Queue → **Notify** → statuses become Accepted, the Notified column is stamped, and **exactly one `communication_logs` row per submission** exists (query the DB in the spec).
Then the idempotency assertion: press Notify again → **no new rows**.
- **Done when:** the spec asserts `select count(*) from communication_logs where template_key='submission_accepted'` is unchanged after the second Notify.

### 5. `portal-tasks.spec`
Speaker login (magic link/OTP helper) → Profile: save a bio and assert the 5,000-char counter and server rejection past the limit → complete a **manual** task → complete a **file-request** task with a small fixture upload → assert the dashboard outstanding count drops on the next poll.
Include the **390px phone-width run-through** of portal login → complete a file task ([M25](./M25-task-runtime.md)'s AC).

### 6. `agenda-schedule.spec`
Create two sessions in one room at overlapping times **via the edit dialog** (no drag simulation — DnD is manually verified per quality-strategy §3) → Conflicts tab badge = 1 → make them back-to-back → badge = 0 (**the half-open interval assertion**) → publish one → it appears on `/e/<slug>/schedule` within the cache window.

### 7. `public-embeds.spec`
`/e/<slug>/schedule` and `/e/<slug>/speakers` render seeded data at mobile viewport; a **draft** session and an **admin-declined** speaker are provably absent (the leakage assertion, resolution #15); the `/embed/*` variant's response carries `Content-Security-Policy: frame-ancestors *` and **no** `X-Frame-Options`; `GET /api/v1/events/<slug>/schedule` returns 200 with published-only rows.

### 8. `scripts/post-deploy-smoke.sh` — curl assertions against the deployed artifact
Because CI's Playwright runs on `next start`, not on workerd, this is the only thing that proves the deployed worker is correct:
```bash
/api/health                      → 200, {"ok":true}, db timing present
/submit/<slug>/<formId>          → 200 and body contains the deadline string with a tz label
/e/<slug>/schedule               → 200 and Cache-Control contains s-maxage=60
/embed/<slug>/schedule           → 200, CSP frame-ancestors *, NO X-Frame-Options
/events/<id>/dashboard           → 307 to /login  (admin gate live)
/f/<seededHeadshotFileId>        → 200, Content-Type image/*, X-Content-Type-Options: nosniff,
                                   Cache-Control immutable    ← M07's header contract
```
Exit non-zero on the first failure; print the failing URL and the response headers.
- **Done when:** it passes against the deployed preview and is wired into [M01](./M01-scaffold-ci-deploy.md)'s deploy job.

### 9. `scripts/load-test.ts` — the CP2 load test (owns risk #2's verification)
~10 lines with autocannon or k6: **50 concurrent POSTs to the deployed preview's submit endpoint** with distinct emails against a form whose limit permits them. Record p50/p95/p99 and the error count in `DECISIONS.md`.
What it proves: the Neon WebSocket `Pool` per-request lifecycle survives burst submits (the deadline-minute scenario) and the `FOR UPDATE` event-row lock in `createSubmission` does not deadlock. **A failure here triggers the pre-decided fallback** — rewrite the eight audited `withTx` paths (resolution #4's exact list: `requestPortalLogin`, `createSubmission`, `upsertDraft`, `updateSubmissionFromCfp`, `notifyDecisions`, `completeTaskViaResponse`, `completeTaskViaUpload`, `moveSession`) as single-statement guarded CTEs — and the trigger date is Sunday night, not Wednesday. The fallback is gated on equivalence proof, not vibes: each rewritten path keeps its multi-row invariant (e.g. `createSubmission`'s limit-check+counter+answers+outbox all-or-nothing, `notifyDecisions`' flip+outbox pairing, `moveSession`'s CAS+revision+outbox) inside the one data-modifying CTE, and the existing per-function PGlite transaction tests must pass unchanged against the CTE version **before** the escape hatch is enabled.
- **Done when:** p95 is recorded and every response is either 200 or a **typed** `LIMIT_REACHED`/`FORM_CLOSED` (never a 500).

### 10. README + API docs + LICENSE
`README.md`: what it is, the deployed URL, a screenshot strip, the stack, **reproducible setup from a clean clone** (`pnpm i` → `.dev.vars` from the example → `pnpm db:migrate` → `pnpm seed` → `pnpm dev`), the deploy commands, the architecture summary (2 deployables, feature folders, contracts freeze), the honest deviations list (anything cut per §9 of the plan), and links to `docs/demo-script.md` + `docs/api.md`.
The README **links** `docs/api.md` (owned by [M40](./M40-public-api.md), which writes every `/api/v1` endpoint with a paste-and-run curl example) — do not author or edit that file here.
`LICENSE`: MIT.
- **Done when:** a teammate follows the README on a clean machine and reaches a seeded local app.

### 11. `docs/spend/` — reimbursement proof, captured daily
Each day, each coding-agent account exports its token/cost usage (screenshot or API usage export) into `docs/spend/YYYY-MM-DD-<agent>.png|json`. The brief's $500 reimbursement "will ask for proof". Start Friday; a Wednesday scramble to reconstruct spend is a self-inflicted wound.

### 12. Submission checklist (Wed)
`docs/submission-checklist.md`: repo public · LICENSE present · README setup verified from a clean clone · demo script walked cold by someone who did not write the feature · deployed prod URL green on post-deploy smoke · comms log clean · `wrangler rollback` rehearsed · spend evidence complete · submission form filled · **submit by 8 PM PT** (a deliberate 2-hour buffer against upload/form failures).

## Acceptance criteria
Catalog AC, verbatim: *golden path green on deployed preview at CP2 + load test p95 documented; all 6 specs green at CP4; repo public with reproducible setup; spend evidence current through Tue.*

```bash
pnpm e2e                                     # 6 specs, chromium, vs Neon sb-test
pnpm e2e --grep cfp-submit                   # the CP2 gate
pnpm exec tsx scripts/load-test.ts https://<preview>   # 50 concurrent submits; p95 → DECISIONS.md
bash scripts/post-deploy-smoke.sh https://<prod>       # exits 0
ls docs/spend/ | wc -l                       # ≥ one file per agent per day
```

## Guardrails
- **Specs assert on seeded artifacts by their stable ids** ([M09](./M09-seed-demo-script.md)'s `seedId`), never on "the first row in the table". Ordering-dependent specs are the flakiest thing in a parallel-agent repo.
- **One shared `sb-test` database, `workers: 1`.** Parallel workers against one Postgres will produce phantom failures that cost more time than they save.
- **No DnD simulation.** `agenda-schedule.spec` uses the edit dialog; drag is manually verified (quality-strategy §3 explicitly bans the test). Do not spend the budget here.
- **The test-budget rule is real:** the six specs plus the unit/PGlite lists in quality-strategy §3 are the whole budget. A PR adding component/render tests, visual regression, Airtable tests, or embed-configurator tests gets trimmed in review.
- **`/api/test/login` must be absent from the production build** — the route module 404s unless `TEST_AUTH=1` at build time. Assert that in the post-deploy smoke (`curl -i /api/test/login` → 404 on prod).
- **Post-deploy smoke is not optional.** CI's Playwright proves the app; only curl against the workers.dev URL proves the *deployed artifact* — the "works in `next dev`, dies in workerd" class lives exactly in that gap.
- **When the golden path is red, everything stops** (risk #10). This module's `cfp-submit` spec is the objective definition of "the golden path is green"; do not soften an assertion to make a checkpoint pass.
- **Email edge case:** specs must never send real mail. Run them with `EMAIL_MODE=log` and assert on `communication_logs` rows; the Wed bug bash is where real Gmail/Outlook round-trips happen, by hand.
- **Timezone edge case:** assert the deadline string **with its zone label**; a spec that matches only the date will pass while the banner shows the wrong hour to a judge in another zone.
- **Empty-state edge case:** add one assertion per spec against the seeded **Empty Conf** event — an empty surface that crashes is a judged failure and this is the cheapest place to catch it.

## If blocked
- **Feature not landed for a spec:** keep the spec skipped and deepen `post-deploy-smoke.sh` instead — it catches deploy-shaped bugs that Playwright structurally cannot.
- **Playwright flaky against the deployed preview:** point `E2E_BASE_URL` at `next start` locally for the CI gate and keep a manual deployed run per checkpoint; record the split in `DECISIONS.md`.
- **`sb-test` unavailable:** run specs against `sb-dev` with `--grep-invert` on the destructive ones, and fix the DB later — a running spec suite beats a correct-but-unrun one.
- **Done early:** write the README's honest-deviations section and the submission checklist now (they are pure writing and always get squeezed on Wednesday), then help the integrator drive the day's checkpoint on the deployed preview.
