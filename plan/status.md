# openboard — implementation status and recovery plan

- **Snapshot:** rev. 8 — Sun Aug 9, 2026 (late evening). Rev. 7's deployment evidence stands unchanged; this revision adds the per-module PR ledger for #25–#52 (§2c), reconciles §7 with rev. 7's own evidence (the email and deployed-preview bullets there contradicted §2a), and adds the product overlay (§8).
- **Rev. 7 headline (unchanged):** **The Saturday thin slice is green on the deployed preview** — a proposal submitted through the real CFP endpoint landed in Neon with its routing applied, and its confirmation email was delivered to a real Gmail inbox from the verified sending domain. The deployment evidence in §2a is from that deployment, not from PGlite.
- **Baseline:** `main` after PR #55, deployed as version `5e809b64` at `https://sb-web-preview.yi-ding.workers.dev`.
- **Deadline:** Wed Aug 12, 10:00 PM PT; submit by 8:00 PM PT. The buffer day is gone (PLAN delta #21).
- **Goal reframe (rev. 8):** the owner's target is now a **sellable product**, not only the judged demo. The judging bar remains the nearest milestone; the product bar beyond it lives in [`product-roadmap.md`](product-roadmap.md), and the audit that motivated it is [`../docs/product-readiness.md`](../docs/product-readiness.md).

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
| PR #11 — admin auth | **Merged** | jose HS256 session cookies, Web Crypto PBKDF2 verification, `requireAdmin(eventId, role?)`, admin/API-key/cron/public guards, middleware redirects, sign-in throttle, `pnpm admin:bootstrap` | *(Historical at merge time — superseded at rev. 7, §2a:)* bootstrap has since been run on both non-prod branches and a deployed sign-in demonstrated. Still open: the deployed auth-throttle proof |
| PR #12 — portal auth | **Merged** | Single-use hashed magic-link/OTP tokens with attempt limits, AES-GCM delivery payloads, durable portal sessions, impersonation, cookie middleware, throttle serialized under a contact row lock | *(Historical at merge time — superseded at rev. 7, §2a:)* the preview has since been redeployed with these routes live, a deployed OTP session established, and the `portal_login` email delivered |

The stack landed in order, and the P1s rev. 5 recorded against it were answered inside those merges. What replaces that queue is the table below.

### 2a. What is now proven on the deployed preview

Everything in this table was executed against Cloudflare, Neon `sb-test` and Resend
on Sun Aug 9. None of it is a test double.

| Evidence | Detail |
|---|---|
| Deployed artifact | Version `5e809b64` from `main`, 1679 KiB gzip, 23–31 ms startup, inside the Workers Free budget |
| Database | `sb-dev` and `sb-test` reset, re-migrated from `drizzle/`, and seeded. `/api/health` returns a real Neon `18.4` round-trip in 155 ms |
| First admin | `pnpm admin:bootstrap` run for the first time in the project's history, on both branches |
| Deployed sign-in | An organizer signed in to the deployed admin and reached an event surface |
| Portal OTP | Requested, issued and verified against the deployed preview, establishing a durable portal session |
| Server draft | Created at the account step with SESS code 1, before any question was answered |
| **Submit** | A proposal posted to `/api/internal/forms/<id>/submit` promoted that draft in place, keeping code 1, and stored eight answers |
| **Routing** | The speaker answered track *Platforms*; the seeded rule saw Format = Workshop and stamped track *AI Agents* with the *Tooling* tag |
| **Email delivered** | `submission_received` sent through Resend from `AI.Engineer Sandbox <hello@mail.openboard.events>` and **delivered** to a real Gmail inbox. `portal_login` likewise |
| Sending domain | `mail.openboard.events` verified in Resend, SPF and DKIM aligned |
| Public surfaces | Schedule edge-cached (`s-maxage`, `x-nextjs-cache: HIT`), embed framable with no `X-Frame-Options`, public API reading `published_sessions_v` |
| Post-deploy smoke | Six checks pass; one skipped for want of a seeded headshot |

### 2b. What the deployment found that no test could

Recorded because each was invisible to a green suite:

1. **`drizzle/0000_init.sql` had been rewritten after being applied.** `sb-dev` and `sb-test` carried an older `events` shape, `pnpm db:migrate` reported success and did nothing, and ~300 passing PGlite tests were validating a schema the real databases did not have. Fixed by resetting both (empty) branches and re-migrating.
2. **A bad `EMAIL_FROM` told speakers their own email was invalid.** The display-name form failed the whole env parse; `getEnv` threw a `ZodError`; every route that catches `ZodError` reported its own message. A server misconfiguration wore user-input validation's clothes (#52).
3. **`ALTER DATABASE … SET app.environment` is refused on Neon** — `neondb_owner` is not a superuser. The database-identity guard from #20 is unavailable on Neon, so every branch is unmarked and `APP_ENV` is the only classification.
4. **An option id is not a vocabulary id.** `deriveMappedFields` wrote the dropdown option id into `submission.track_id`; both are strings, so only a real foreign key caught it (#36).
5. **`submission_ratings_v` is per (submission, plan)**, so a naive join listed an abstract twice and doubled every tab count (#37).

### 2c. PR ledger, #25–#52 by module (added at rev. 8)

Rev. 6 stopped at PR #24 and rev. 7 recorded the deployment; this table records what the
intervening 28 PRs (~8,600 lines across 119 files) landed, so module claims can cite them:

| PRs | Module | What landed |
|---|---|---|
| #26, #44 | M32/M01 | Public-cache-header fixes — **proven deployed at rev. 7** (`s-maxage`, `x-nextjs-cache: HIT`) |
| #27, #28 | M05b | Rich UI primitives and the rich-text editor |
| #29–#31, #33 | M21 | Portal server queries/guards, submissions view, portal home — server-backed |
| #32, #41, #46 | M09 | Seed bodies for portal, events, and forms (contacts followed in #65, below — **5 of 8 real**); submissions, agenda, evaluation remain 13-line stubs |
| #34, #57 | M18 | #34: `createSubmission`, `upsertDraft`, `nextSubmissionCode`. **#57: `transitionStatus` + `notifyQueues` with the transition/notify routes and 11 PGlite cases** (double-notify idempotency, undo→re-notify, auto-confirm, submitter-only recipient, `waitUntil` outbox drain). Remaining: `updateSubmissionFromCfp`, `withdraw`, `getAcceptedForScheduling`, the withdraw route — and any UI consumer |
| #35 | M16 | The real server submit pipeline: transactional, snapshot-pinned, `FORM_VERSION_STALE`, routing, SESS codes — **proven deployed at rev. 7** |
| #36, #39 | M12 | Snapshot accessors and the public-form server layer (forms remain unauthorable from the UI — the builder still writes only to the demo store) |
| #37, #38 | M17 | Abstracts queries + admin surface, DB-backed behind `requireAdmin` (no pagination controls, row links, or detail drawer yet) |
| #40 | M38 | Dashboard: aggregated server endpoint over the reporting views, zod-validated, 30 s polling |
| #42, #45, #47 | M35 | ICS builder, invite dispatch, verified-token `/cal` routes with cancellation replay |
| #43, #49 | M15 | The real form renderer and a submittable public CFP wizard — **proven deployed at rev. 7** |
| #48, #51, #52 | fixes | Public-API review regressions, regenerated CF types, `EMAIL_FROM` config errors surfaced as `INTERNAL` |
| #50 | M34/M01 | Preview flipped to `EMAIL_MODE=send` behind a one-address allowlist — and rev. 7 then **demonstrated delivery** through it |
| #53–#56 | fixes/plan | `EMAIL_FROM`/env-error follow-ups (#53/#54), the rev. 7 ledger rebaseline (#55), and the product-readiness/roadmap/auth-decision docs (#56) |
| #57 | M18 | See the M18 row above — the decision/notify server half |
| #61 | M17 | **The decision bar**: bulk queue/decide actions and a working **Notify** button on the abstracts table calling #57's routes, plus a submission-detail API route. The detail drawer itself is still open |
| #62, #64, #66 | fixes | Submit-pipeline review follow-ups and seed hardening (reused field keys, empty event dates) |
| #65 | M09 | **The contacts seed** (92 lines) with real uploaded headshots — **5 of 8 seed bodies are now real**; submissions, agenda, evaluation remain stubs. This also unblocks the browser R2 probe and clears the last smoke skip |

**Treadmill warning:** lanes are merging PRs faster than any ledger revision can chase (four
module-relevant merges landed while rev. 8 was being written). Before citing a "missing" claim
from this document, verify it against `main` — and prefer citing the module work-order headers,
which lane owners update at claim time.

Bookkeeping note: `e2e/helpers/landed.ts` has **all 17 modules at `landed: false`**, and — a
rev. 8 correction to the earlier framing — that is currently *right*, not stale bookkeeping:
the spec **step bodies are still placeholder `async () => {}` stubs**, so flipping a gate over
them would report vacuous green on the specs that define checkpoints (cfp-submit is CP2's bar).
The real gap is M10's remaining work: implement the step bodies for the modules with deployed
proof (M15/M16/M17/M21/M34/M40 first), then flip their gates in the same change.

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
| M06a | PR #11 — sessions, guards, middleware, throttle, bootstrap; **deployed sign-in proven at rev. 7** (§2a) | AC sign-off; the deployed auth-throttle proof |
| M06b | PR #12 — OTP/magic link, tokens, sessions, impersonation; **deployed OTP session and delivered `portal_login` email proven at rev. 7** (§2a) | AC sign-off, including the phone-width AC |

### Merged since rev. 5, AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M07 | PRs #15 + #17 — policy table, staging→published keys, the four routes, orphan sweep, and CI grep #11 | A **browser** presign/PUT/CORS round-trip on the preview, the `curl -I /f/{id}` header check, production S3 credentials, and an R2 lifecycle rule on the `staging/` prefix |
| M34 | PR #16 — dispatcher, templates, renderer, Resend integration, comms seed; **Gmail delivery through a deployed dispatch proven at rev. 7** (§2a) | The Outlook probe, calendar-invite delivery, DMARC confirmation, and a production sending key |
| M05a | PR #24 — the core primitives and the kitchen sink | Six list surfaces actually consuming `<DataTable>`; the `(admin)` route group, deliberately unclaimed |
| M09 | PR #20 — orchestrator, ids, stubs, target verification | A run against a real database, then the eight per-feature bodies, which belong to their own lanes |
| M10 | PRs #19, #22, #23 — spec skeleton, deepened smoke, load test, README, checklist | Specs go green only as their features land; the load test needs M16's submit endpoint |

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, validation CI; **preview is live** at `https://sb-web-preview.yi-ding.workers.dev` (deployed version `5e809b64`, 1679 KiB gzip — earlier snapshots measured 1206.45 KiB; use §2a's figure as current). Resend probe and revalidate-60 **proven at rev. 7** (§4 CP0) | Browser R2 presign/CORS, a deployed application-throttle proof, and a green `Deploy` workflow run from `main` |
| M05a | Demo admin shell, event resolution, accessible controls, stub routes; the core primitives and kitchen sink landed in #24 | Six list surfaces actually consuming `<DataTable>`; the `(admin)` route group, deliberately unclaimed because those route files belong to six lanes |
| M08 | Secret-guarded job routes, trigger worker, canonical config; **a preview jobs tick reached the web Worker and returned `{ ok: true, stats: { noop: 1 } }` in 1 ms CPU** | Production `CRON_SECRET` on both Workers, tail evidence, and AC-gated stub swaps |
| M09 | Typed browser fixture seed; the orchestrator, ids, stubs and target verification landed in #20 | A run against a real database, the eight per-feature bodies, and judge credentials that exist |
| M10 | Release docs, validation CI; the six-spec skeleton, the deepened smoke, the load test, the README and the submission checklist landed in #19/#22/#23 | Specs go green only as their features land; the load test needs M16's submit endpoint; production deploy, spend proof and the release AC |
| M38 | Fixture-backed dashboard surface; **#40 landed the aggregated server endpoint over the reporting views, zod-validated, with 30 s polling** (§2c) | The deployed judged count-change proof, and wiring its attention links to real (non-demo) target pages |

### Merged demo-stack implementation

These modules have useful UI or pure-function slices merged through PRs #2/#4/#5 and are `IN PROGRESS`, but their server/integration AC remains open:

- PR #2 lineage: M11–M15, M17–M20.
- PR #4 lineage: M21–M23, M25–M29, M31–M33, M41.
- PR #5 lineage: M03 UI-adjacent slices, M10, M35, M37, M40, plus additional M11 UI.

The following modules remain `NOT STARTED` at their substantive boundary despite nearby stubs or demo controls: M24, M30, M36, and M39. (M06a/M06b left this list in rev. 5; M07/M34 in rev. 6; **M05b left it via #27/#28 and M16 via #35 — both corrected at rev. 8**, since §2c records both merged, M16 proven deployed.)

### Temporary ownership grant

PR #12 used M06b's documented contingency and created `src/features/portal/server/contacts.ts` containing exactly `getOrCreateContact` and `updateContactFields`, because M21's Step 0 had not landed. The grant is recorded in `DECISIONS.md`; **ownership returns to M21/WS-D the moment the stack merges**, and resolution #13 continues to forbid any other `contacts` write path.

## 4. Checkpoint truth

| Checkpoint | Status | Evidence |
|---|---|---|
| CP0 — deployed skeleton and existential spikes | **GREEN except the R2 browser probe, auth-throttle proof, and DMARC header evidence** | Preview URL live; real Neon round-trip; bundle inside the Free budget; jobs tick; embed `frame-ancestors` proven by curl; **edge cacheability proven** (`s-maxage`, `x-nextjs-cache: HIT`); delivered Gmail mail proves aligned SPF/DKIM. Missing: a browser R2 presign/CORS upload, a deployed application auth-throttle proof, and `dmarc=pass` in `Authentication-Results` |
| CP1 — contracts/schema/foundation freeze | **NEARLY GREEN** | Contracts merged; the stack merged; migrations applied to `sb-dev` and `sb-test` **from the repo's own SQL**; seed loads; **admin login works on the deployed preview**; the six-spec Playwright skeleton runs; **the freeze declaration is now recorded in `DECISIONS.md`** (rev. 8). Missing: `sb-prod` and a green `Deploy` workflow run |
| **Sat thin slice — CFP to Abstracts** | **GREEN on the server path** | A deployed submit stored a submission with routing applied and delivered its confirmation email. The Abstracts *table* reads the database; its drawer and bulk actions do not yet |
| CP2 — golden spine | **PARTIAL** | Green: real OTP, submit, one **delivered** email, public schedule and gallery; accept/notify **server half merged** (#57: `transitionStatus`, `notifyQueues`, both routes, 11 PGlite cases). Missing: the review server (M19), decision **UI** (M17 drawer/bulk actions) plus a deployed accept→notify→email round-trip, a portal task completion and the golden-path Playwright spec. The **50-concurrent load run is done** (#73): 50/50 `200 ok`, p95 27703 ms, zero duplicate codes, recorded in `DECISIONS.md` |
| CP3 — full judged feature surface | **NOT ATTEMPTED** | Deployed portal upload/task, scheduling/conflict, embed, ICS lifecycle, reminder scan, tracking dashboard |
| CP4 — feature freeze/release proof | **NOT ATTEMPTED** | Six e2e specs, load/perf record, post-deploy smoke on production, security review, docs/spend and submission checklist |

A daily claim may now say **end to end on the deployed preview** for the CFP submit path and for email delivery. It may not yet say it for review, decisions, portal tasks, or scheduling.

## 5. Recovery gates

Execute gates in order. Later gates may prepare pure tests and fixtures, but no new UI surface or bonus work may displace an earlier red gate.

### R0 — Rebaseline and protect the stack — **EXITED**

Landed via PRs #6–#8: the status overlay and reconciled module headers, the infrastructure reconciliation, and the jobs routing fix. Private fixture APIs and unverified calendar routes remain fail-closed. Clean-install validation CI is green on `main`.

### R1 — Deployed foundation — **ESSENTIALLY EXITED**

Its three original recovery items are done: the preview is deployed from current `main`, both
databases are migrated and seeded, and an admin has been bootstrapped and used to sign
in. R1 remains open for the following release and external-proof work:

The CP1 freeze declaration is already complete at rev. 8 and is not an open R1 item.

1. `sb-prod` migration and production secrets, gated on the production deploy decision.
2. A green `Deploy` workflow run — every run so far has been `skipped`, so deployment
   is still a laptop operation rather than a pipeline one.
3. A browser R2 upload against the preview — unblocked at #65 (the contacts seed uploads real
   headshots); the probe just needs running.
4. A deployed application-layer auth-throttle probe; unit coverage is not external evidence.
5. A delivered-message `Authentication-Results` record with `dmarc=pass`; SPF/DKIM alone do not
   satisfy the email header gate.

**Exit:** the five items above.

### R2 — Server-backed golden spine

- M05b's rich primitives are merged (#27/#28); M12's rich-text integration may proceed against them.
- Finish M11–M18 and M34 against PR #9's snapshot/evaluator contract, which is merged, stable, and **now frozen** (`DECISIONS.md`, CP1 freeze record) — a contract change is a protocol violation without an architect-labeled PR.
- Replace fixed OTP/localStorage submission and decision logging with auth, Neon transactions, deadline/limit enforcement, outbox enqueue, dispatcher delivery, and event-scoped reads.
- Prove the thin slice first; then accept/notify with exactly one email and portal link.

**Exit:** Sat thin slice and CP2's CFP→review→notify path are green on the preview.

### R3 — Judged portal, program, and tracking loop

- Finish the minimum slices of M19, M21/M22/M23/M25, M28/M29/M32/M33, M35/M36, and M38.
- Prove reviewer assignment and persisted scoring plus real R2 headshot/slides upload, portal completion, manual schedule placement with conflict detection, published schedule/gallery/embed, ICS token authorization/lifecycle, reminders, and dashboard count change.
- M30 drag-and-drop, M31 alternate views, and M37 polish remain subordinate to the minimum loop; manual scheduling is the accepted cut-line fallback.

**Exit:** the complete minimum judging bar in PLAN §9 works from a fresh browser on the deployed URL.

### R4 — Release proof

- Complete M10 after its R1 skeleton: make all six Playwright specs green (the 50-concurrent load test is run and recorded), and finish post-deploy smoke, rollback rehearsal, public-repo docs, `docs/spend/`, and the submission checklist.
- Run the judge script cold, including fresh Gmail and Outlook OTP/email/invite probes.
- Fix P0s only after feature freeze; submit by 8:00 PM PT.

**Exit:** CP4 is green and the submission is accepted.

## 6. Immediate scope control

Bonus work and cosmetic expansion stay paused until R3 exits:

- M39 Airtable and M40 public API are deferred; security fixes may disable or remove unsafe draft routes without replacing them yet.
- M30 drag-and-drop uses the existing manual-placement fallback unless the minimum loop is already green.
- M31 Week/Track/Room views, M37 communications polish, Today-dashboard polish, and additional field types do not block the judging bar.
- Do not add new seed-only behavior to claim progress on a server AC.

The next actions are the judged loop's remaining halves, in this order (**#57 landed the
decide/notify server half, #61 its decision bar + Notify UI, and #65 the contacts seed**, so
the queue advances again): **M17's detail drawer** (the last missing piece of the triage loop —
bulk actions exist, reading a submission does not); **a deployed accept→notify→email
round-trip** to turn CP2's spine green; **the submissions seed body**, so a fresh database has
abstracts to triage (the contacts seed in #65 already cleared the headshot smoke skip and
unblocked the browser R2 probe); then **M12's builder UI**, the last place a judge is asked to
create something rather than read it.

## 7. Environment and configuration truth

[`environments.md`](environments.md) is the canonical provisioning inventory; [`../docs/provisioning.md`](../docs/provisioning.md) is the live checklist.

**Provisioned since rev. 4:**

- Neon project `sb` with isolated `sb-dev`, `sb-test`, `sb-prod` branches. Both migrations were proven on an expiring disposable branch, then applied to `sb-dev` and `sb-test`.
- R2 buckets `sb-files-preview` and `sb-files` in WNAM with exact-origin CORS.
- Preview web and jobs Workers deployed at `https://sb-web-preview.yi-ding.workers.dev`; the repository smoke script passed its health, public schedule, and public API probes. `global_fetch_strictly_public` resolved the Worker-to-Worker error 1042.
- GitHub `preview` and `production` environments restricted to `main`, production gated on `yisding` approval, `PRODUCTION_DEPLOY_ENABLED` unset.
- Exact preview and production origins recorded; no hostname is guessed in committed config.

**Provisioned since rev. 6:**

- `mail.openboard.events` verified in Resend with SPF and DKIM aligned; a domain-scoped
  sending key stored as a worker secret; preview flipped to `EMAIL_MODE=send` behind a
  one-address `EMAIL_ALLOWLIST`.
- `R2_ACCOUNT_ID` supplied to the preview worker, and `DATABASE_URL` pointed at `sb-test`.
- Both non-production Neon branches reset, re-migrated and seeded; admin credentials
  bootstrapped and held outside the repository.

**Corrections since rev. 5:**

- *(Historical — resolved at rev. 7.)* `pnpm admin:bootstrap` was never runnable before PR #21
  (top-level `await` under tsx's CJS output aborted it before it read an environment variable).
  It has since been run for the first time, on both non-production branches, and the accounts
  are held outside the repository (§2a).
- *(Historical — superseded at rev. 7.)* At rev. 5 the deployed preview was behind `main`:
  `/api/internal/auth/portal/request` returned a Next 404 page. The preview has since been
  redeployed from current `main` as version `5e809b64` with the portal-auth routes proven live
  (§2a).

**Still pending in the provisioning checklist (chiefly the production sections — the preview
sections are done):**

- Production `SESSION_SECRET` and `CRON_SECRET`; the pooled and direct Neon URLs saved per environment; R2 Object Read & Write S3 credentials.
- A least-privilege Cloudflare API token moved off repository scope into both protected environments.
- GitHub environment secrets and variables, and a `Deploy` workflow run that actually completes migration → web → jobs → smoke for preview. Preview was deployed with `scripts/deploy-cloudflare.sh`; all three `Deploy` runs on `main` were `skipped`.
- The remainder of the Resend track. *(Corrected at rev. 8 — the rev. 6 wording "nothing about
  email delivery is proven" contradicted §2a above.)* Proven at rev. 7: verified sending
  subdomain with SPF and DKIM aligned, real `EMAIL_FROM`, and Gmail delivery of
  `submission_received` and `portal_login` from the deployed preview. Still pending: an Outlook
  probe, calendar-invite delivery evidence, DMARC policy confirmation, a production API key, and
  bounce handling.
- The entire production section, including `sb-prod` migration, secrets, `EMAIL_MODE=send` with `EMAIL_FALLBACK_UI=0` and no `TEST_AUTH`, and the production health/cron confirmation.

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`. A custom-domain WAF rule is optional defense-in-depth and is not applicable to a `workers.dev` hostname.

**Security note (added at rev. 8):** `TEST_AUTH: "1"` is set on the publicly reachable preview
(`wrangler.jsonc`), where `/api/test/login` mints an admin session for any known email with no
password. Now that the preview holds real seeded data and bootstrapped admin credentials, treat
this as a **release gate, not a data-dependent cleanup**: `TEST_AUTH` must be disabled — or the
preview network-restricted — before any customer-facing or non-demo deployment; the judged-demo
window is the only sanctioned exception.

## 8. Product overlay (expanded by PLAN resolution #23)

The owner's goal is now a sellable product, not only the judged submission. PLAN resolution #23
adds M50–M54 as required post-R3 release scope and keeps M55 optional after organization tenancy.
None of M50–M55 is started or evidenced by this ledger. Two companion documents provide context:

- [`../docs/product-readiness.md`](../docs/product-readiness.md) — the audit: what is
  server-backed vs demo-adapter-only, what remains unproven externally, and the commercial scope
  the plan never contained.
- [`product-roadmap.md`](product-roadmap.md) — the phased product plan layered after the
  recovery gates (wiring debt → external proof → trust/compliance → product-completeness M50–M54
  and commercial layer M42–M49/M55), including the product auth decision (Better Auth with Google
  as a social provider; see `DECISIONS.md`, "Product auth direction").

Rule of precedence: while the recovery gates in §5 are open, they order all work; the roadmap
consumes effort only where it overlaps them (which its Phase P1 deliberately does — it is the
same work as R2/R3, starting with §6's next actions). Once R3 is green, M50–M53 may run in parallel,
M54 follows M30, and M10's final release sign-off waits for M50–M54's deployed browser AC.
