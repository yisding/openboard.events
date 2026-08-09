# openboard — implementation status and recovery plan

- **Snapshot:** rev. 6 — Sun Aug 9, 2026, after the foundation stack #10 → #12 **and** PRs #15–#24 merged. R1's implementation queue is empty: what remains is deployment, external proof, and the feature lanes.
- **Baseline:** `main` after the merge of PR #20.
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
| PR #11 — admin auth | **Merged** | jose HS256 session cookies, Web Crypto PBKDF2 verification, `requireAdmin(eventId, role?)`, admin/API-key/cron/public guards, middleware redirects, sign-in throttle, `pnpm admin:bootstrap` | No deployed S4 round-trip. `pnpm admin:bootstrap` **could not run at all** until PR #21 — top-level `await` under tsx's CJS output killed it before it read an env var, so no admin has been bootstrapped anywhere yet |
| PR #12 — portal auth | **Merged** | Single-use hashed magic-link/OTP tokens with attempt limits, AES-GCM delivery payloads, durable portal sessions, impersonation, cookie middleware, throttle serialized under a contact row lock | No delivered email and no deployed proof. The deployed preview still predates this merge: `/api/internal/auth/portal/request` returns a Next 404 page there, observed by `scripts/load-test.ts` |

The stack landed in order, and the P1s rev. 5 recorded against it were answered inside those merges. What replaces that queue is the table below.

### 2a. What landed after the stack

| PR | Module | What it lands |
|---|---|---|
| #15 + #17 | M07 | `shared/server/r2.ts` and the four upload routes. Presign is signed for a staging key and finalize server-side copies to the published key, so a live presigned PUT can never overwrite validated bytes under an immutable cache header |
| #16 | M34 | Communications outbox dispatcher, templates, renderer, Resend integration |
| #18 | M01 | Invariant grep #11 — no direct R2 access outside the storage module |
| #19 | M10 step 1 | The six-spec Playwright skeleton: 22 tests, 0 failures, one table that flips as modules land |
| #20 | M09 steps 1–2 | Seed orchestrator, `seedId`, the eight per-lane stub modules, and a seed target verified against the database's own identity rather than against `APP_ENV` alone |
| #21 | M06a | `pnpm admin:bootstrap` made runnable at all |
| #22 | M10 step 8 | Post-deploy smoke at its seven documented assertions, now mandatory and `--strict` in the deploy job |
| #23 | M10 steps 9/10/12 | Load test, honest-status README, submission checklist |
| #24 | M05a | `<DataTable>`, `<Dash>`, `<TzTime>`, `<ColorChip>`, `<ConfirmDialog>`, kitchen sink |

**The binding constraint moved.** Every R1 item that was code is now on `main`; what is left is a
deploy, external evidence, and the eight per-feature seed bodies that belong to their own lanes.

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

### Merged since rev. 5, AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M07 | PRs #15 + #17 — policy table, staging→published keys, the four routes, orphan sweep, and CI grep #11 | A **browser** presign/PUT/CORS round-trip on the preview, the `curl -I /f/{id}` header check, production S3 credentials, and an R2 lifecycle rule on the `staging/` prefix |
| M34 | PR #16 — dispatcher, templates, renderer, Resend integration, comms seed | One delivered or logged email through a deployed dispatch; the whole Resend deliverability track |
| M05a | PR #24 — the core primitives and the kitchen sink | Six list surfaces actually consuming `<DataTable>`; the `(admin)` route group, deliberately unclaimed |
| M09 | PR #20 — orchestrator, ids, stubs, target verification | A run against a real database, then the eight per-feature bodies, which belong to their own lanes |
| M10 | PRs #19, #22, #23 — spec skeleton, deepened smoke, load test, README, checklist | Specs go green only as their features land; the load test needs M16's submit endpoint |

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, validation CI; **preview is live** at `https://sb-web-preview.yi-ding.workers.dev` with a real Neon round-trip and a measured 1206.45 KiB gzip artifact inside the Workers Free budget | Resend DNS/header probe, browser R2 presign/CORS, the revalidate-60 spike, a deployed application-throttle proof, and a green `Deploy` workflow run from `main` |
| M05a | Demo admin shell, event resolution, accessible controls, stub routes; the core primitives and kitchen sink landed in #24 | Six list surfaces actually consuming `<DataTable>`; the `(admin)` route group, deliberately unclaimed because those route files belong to six lanes |
| M08 | Secret-guarded job routes, trigger worker, canonical config; **a preview jobs tick reached the web Worker and returned `{ ok: true, stats: { noop: 1 } }` in 1 ms CPU** | Production `CRON_SECRET` on both Workers, tail evidence, and AC-gated stub swaps |
| M09 | Typed browser fixture seed; the orchestrator, ids, stubs and target verification landed in #20 | A run against a real database, the eight per-feature bodies, and judge credentials that exist |
| M10 | Release docs, validation CI; the six-spec skeleton, the deepened smoke, the load test, the README and the submission checklist landed in #19/#22/#23 | Specs go green only as their features land; the load test needs M16's submit endpoint; production deploy, spend proof and the release AC |
| M38 | Fixture-backed dashboard surface | Aggregated server endpoint, task-count law, polling, database-backed judged update |

### Merged demo-stack implementation

These modules have useful UI or pure-function slices merged through PRs #2/#4/#5 and are `IN PROGRESS`, but their server/integration AC remains open:

- PR #2 lineage: M11–M15, M17–M20.
- PR #4 lineage: M21–M23, M25–M29, M31–M33, M41.
- PR #5 lineage: M03 UI-adjacent slices, M10, M35, M37, M40, plus additional M11 UI.

The following modules remain `NOT STARTED` at their substantive boundary despite nearby stubs or demo controls: M05b, M16, M24, M30, M36, and M39. (M06a and M06b left this list in rev. 5; M07 and M34 left it in rev. 6. All four are merged with AC verification pending.)

### Temporary ownership grant

PR #12 used M06b's documented contingency and created `src/features/portal/server/contacts.ts` containing exactly `getOrCreateContact` and `updateContactFields`, because M21's Step 0 had not landed. The grant is recorded in `DECISIONS.md`; **ownership returns to M21/WS-D the moment the stack merges**, and resolution #13 continues to forbid any other `contacts` write path.

## 4. Checkpoint truth

| Checkpoint | Status | Evidence required to turn green |
|---|---|---|
| CP0 — deployed skeleton and existential spikes | **PARTIAL** | Green: preview Cloudflare URL, real `/api/health` Neon `18.4` round-trip in 155 ms, measured bundle (1416.09 KiB with the R2 routes and the shared primitives) under the Free 3 MiB budget, jobs tick round-trip, and **embed `frame-ancestors` now proven by curl** — `/embed/<slug>/schedule` sends `frame-ancestors *` and no `X-Frame-Options`. Missing: Resend DNS/header probe, browser R2 presign/CORS, a deployed auth-throttle proof, and **revalidate-60, which is now a measured failure rather than an unknown**: `/e/<slug>/schedule` is served `private, no-cache, no-store, max-age=0, must-revalidate` |
| CP1 — contracts/schema/foundation freeze | **NOT MET** | Green: contracts merged; the #10–#12 stack merged; migrations applied to `sb-dev` and `sb-test`. Missing: `sb-prod`, a real seed run, admin login demonstrated on the preview, a green `Deploy` workflow run, and the freeze declaration. The six-spec skeleton is merged and runs |
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

**The code half is done.** Every R1 item that was an implementation now sits on `main`. What is
left cannot be finished by writing more of it:

1. **Deploy the preview from current `main`.** The deployed revision predates the portal-auth
   merge — `/api/internal/auth/portal/request` returns a Next 404 page there — so every claim
   about auth, uploads or comms on that URL is a claim about code that is not deployed.
2. **Run the seed against `sb-dev` and `sb-test`.** `pnpm seed` exists and refuses an
   unclassified or mismatched target; nobody has pointed it at a database yet. Mark each database
   once with `ALTER DATABASE … SET app.environment` while doing it.
3. **Bootstrap an admin and demonstrate a deployed sign-in.** `pnpm admin:bootstrap` only became
   runnable in #21, so this has never been done anywhere.
4. **Fix the public schedule's cache header.** `/e/<slug>/schedule` is served
   `private, no-cache, no-store`; the deploy job's smoke step is now mandatory and `--strict`, so
   this blocks a green deploy rather than being a footnote.
5. **Fill the eight per-feature seed bodies.** Each belongs to its own lane, and four downstream
   surfaces render against them.
6. Keep `drizzle/` additive-only. Every new migration runs on the disposable branch first, then
   `sb-dev` **and** `sb-test`, before `sb-prod` goes through the guarded production step. The
   deploy workflow only migrates the environment it deploys, so **`sb-dev` is nobody's job unless
   someone runs it**.
7. Finish the deploy half of M08 and make the GitHub `Deploy` workflow green for preview — every
   run so far has been `skipped`.
8. Complete the remaining provisioning in §7.

**Exit:** CP0 and CP1 are green on a deployed preview, including the admin shell and the runnable
six-spec Playwright skeleton.

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

The next action is **not an implementation action**. It is a deploy plus a seed run: R1's steps 1–3
are the only reason CP0 and CP1 are still red, and no amount of further code moves them. M07,
M05a's primitives and M09's orchestrator are merged, so WS-D's queue (M05b → M21 → M22/M25) and the
feature lanes are unblocked for the first time.

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
  fixed it; the checklist item stays unchecked until it has actually been run.
- The deployed preview is behind `main`. `/api/internal/auth/portal/request` returns a Next 404
  page there, so the portal-auth merge is not on the deployed artifact.

**Still pending (31 unchecked items in the provisioning checklist):**

- Production `SESSION_SECRET` and `CRON_SECRET`; the pooled and direct Neon URLs saved per environment; R2 Object Read & Write S3 credentials.
- A least-privilege Cloudflare API token moved off repository scope into both protected environments.
- GitHub environment secrets and variables, and a `Deploy` workflow run that actually completes migration → web → jobs → smoke for preview. Preview was deployed with `scripts/deploy-cloudflare.sh`; all three `Deploy` runs on `main` were `skipped`.
- The entire Resend track: verified sending subdomain, SPF/DKIM/DMARC, real `EMAIL_FROM`, production API key, and fresh Gmail/Outlook OTP and calendar delivery evidence recorded in `DECISIONS.md`. **Nothing about email delivery is proven, which makes it the largest single risk to CP2.**
- The entire production section, including `sb-prod` migration, secrets, `EMAIL_MODE=send` with `EMAIL_FALLBACK_UI=0` and no `TEST_AUTH`, and the production health/cron confirmation.

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`. A custom-domain WAF rule is optional defense-in-depth and is not applicable to a `workers.dev` hostname.
