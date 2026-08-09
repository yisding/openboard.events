# openboard — implementation status and recovery plan

- **Snapshot:** rev. 5 — Sun Aug 9, 2026, after PRs #6–#9 merged and the preview Cloudflare/Neon/R2 estate was provisioned. The foundation stack #10 → #11 → #12 is open and in review.
- **Baseline:** `main` at `36f34a0` (merge of PR #9). Nothing has merged since.
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
| PR #10 — database and server foundation | **Open, in review** | Full event-isolated schema, views, transition trigger, typed Drizzle modules, lazy HTTP/transaction clients, `defineHandler`, `enqueueEmail`, and 75 PGlite integration tests incl. all 49 submission transitions | Not merged. The SQL is proven on PGlite and on a disposable Neon branch, not through the deploy migration path; open review findings remain |
| PR #11 — admin auth | **Open, in review** | jose HS256 session cookies, Web Crypto PBKDF2 verification, `requireAdmin(eventId, role?)`, admin/API-key/cron/public guards, middleware redirects, sign-in throttle, `pnpm admin:bootstrap` | Not merged. No deployed S4 round-trip; two open P1s (below) |
| PR #12 — portal auth | **Open, in review** | Single-use hashed magic-link/OTP tokens with attempt limits, AES-GCM delivery payloads, durable portal sessions, impersonation, cookie middleware, throttle serialized under a contact row lock | Not merged. No delivered email, no deployed proof; one open P1 (below) |

The stack must land in order (#10 → #11 → #12); each merge retargets the next.

### 2a. Open review queue on the stack

Owner-authored P0/P1 findings on all three PRs were fixed and answered. A later automated round is unanswered and is the current blocking work:

| PR | Sev | Finding |
|---|---|---|
| #11 | P1 | `admin_login_attempts` was added by editing `drizzle/0000_init.sql`, which is already applied to `sb-dev` and `sb-test`. `pnpm db:migrate` will not create the table, so every deployed sign-in fails. Needs a new journaled migration — this also tests the additive-only rule the schema freeze depends on. |
| #11 | P1 | `requireAdmin` is called with no required role in the event layout, so a `reviewer` member reaches organizer surfaces (Forms, Agenda, Comms, Embeds, Settings). Contradicts M06a's AC. |
| #11 | P2 | With the global `TEST_AUTH` bypass correctly removed, the documented credential-free `pnpm dev` demo is no longer navigable. |
| #12 | P1 | The portal layout validates the session then discards it; `PortalProvider` still resolves the speaker from fixture/localStorage, so authenticated users see the wrong identity and impersonation never activates the banner. |
| #12 | P2 | A concurrently consumed OTP returns `UNAUTHORIZED` to the losing tab even though the session was established. |
| #12 | P2 | Issued magic links drop the validated internal `next` path, so the emailed flow always lands on the portal root. |
| #10 | Major/minor | Ten open findings, chiefly view semantics in `0001_views_triggers.sql` (`is_form_open` NULL for an unknown form, `submission_ratings_v` counting unsubmitted and AI reviews, `published_speakers_v`/`published_sessions_v` disagreeing on the published predicate, no task assignment when a submission has no primary participant) plus `uuid[]` columns that bypass event-scoped isolation. The view findings matter because PLAN §4 makes the eight views the only read path for dashboard/embeds/public API. |

## 3. Module status by evidence

No module is `DONE` as of this snapshot. Rule 1 alone keeps every `PR-OPEN` module out.

### Merged, AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M02 | PR #9: complete contract surface, golden fixture, signatures, idempotency recipes, fan-out law | Work-order AC sign-off against the merged tree and the CP1 freeze declaration in `DECISIONS.md` |
| M04 (pure half) | PR #9: `compileFormSnapshot`, `time.ts` 6-function API with DST coverage, both sanitizer profiles, slug/interval helpers | AC sign-off; the server half (`handler.ts`, `enqueue-email.ts`) is `PR-OPEN` in #10 |
| M13a | PR #9: complete operator, visibility-traversal, hidden-answer-stripping and routing pipeline against the golden fixture | AC sign-off, including the 40+ test contract count |

### Open on the foundation stack (`PR-OPEN`)

| Modules | Branch evidence | Blocking |
|---|---|---|
| M03 | PR #10 — schema, views, transition trigger, Drizzle modules, clients; migrations applied to a disposable Neon branch, then `sb-dev` and `sb-test` | Merge; `sb-prod`; the open view-semantics findings; a journaled additive migration path (see #11 P1) |
| M04 (server half) | PR #10 — `defineHandler`, `enqueueEmail`, query/log/assert helpers, API client | Merge and AC sign-off |
| M06a | PR #11 — sessions, guards, middleware, throttle, bootstrap | Merge; the login-attempts migration; reviewer role enforcement; a deployed auth round-trip |
| M06b | PR #12 — OTP/magic link, tokens, sessions, impersonation | Merge; binding the shell to the authenticated contact; one delivered or logged `portal_login` email through M34 |

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, validation CI; **preview is live** at `https://sb-web-preview.yi-ding.workers.dev` with a real Neon round-trip and a measured 1206.45 KiB gzip artifact inside the Workers Free budget | Resend DNS/header probe, browser R2 presign/CORS, revalidate-60 and `frame-ancestors` spikes, a deployed application-throttle proof, and a green `Deploy` workflow run from `main` |
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

The following modules remain `NOT STARTED` at their substantive boundary despite nearby stubs or demo controls: M05b, M07, M16, M24, M30, M34, M36, and M39. (M06a and M06b left this list in rev. 5; they are `PR-OPEN`.)

### Temporary ownership grant

PR #12 used M06b's documented contingency and created `src/features/portal/server/contacts.ts` containing exactly `getOrCreateContact` and `updateContactFields`, because M21's Step 0 had not landed. The grant is recorded in `DECISIONS.md`; **ownership returns to M21/WS-D the moment the stack merges**, and resolution #13 continues to forbid any other `contacts` write path.

## 4. Checkpoint truth

| Checkpoint | Status | Evidence required to turn green |
|---|---|---|
| CP0 — deployed skeleton and existential spikes | **PARTIAL** | Green: preview Cloudflare URL, real `/api/health` Neon `18.4` round-trip in 155 ms, measured bundle (1206.45 KiB deployed; 1317.99 KiB with auth) under the Free 3 MiB budget with 24 ms startup and no CPU error, jobs tick round-trip. Missing: Resend DNS/header probe, browser R2 presign/CORS, revalidate-60, embed `frame-ancestors`, and a deployed application auth-throttle proof |
| CP1 — contracts/schema/foundation freeze | **NOT MET** | Green: contracts merged; migrations applied to `sb-dev` and `sb-test`. Missing: the #10–#12 merges, `sb-prod`, real seed, all routes, a green `Deploy` workflow run, the runnable six-spec Playwright skeleton, and the freeze declaration |
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

Ordered remaining work:

1. Clear the §2a review queue, starting with #11's login-attempts migration — it is the one finding that silently breaks a deployed sign-in.
2. Merge #10 → #11 → #12 in order, retargeting each as its base lands.
3. Keep `drizzle/` additive-only now that `0000_init.sql` is journaled and applied. Every new migration — starting with #11's `admin_login_attempts` fix — runs on the disposable branch first, then `sb-dev` **and** `sb-test`, before `sb-prod` goes through the guarded production deployment step. `pnpm db:migrate` applies pending journal entries to whichever database `DATABASE_URL` points at, and the deploy workflow only ever migrates the environment it is deploying (preview → `sb-test`, production → `sb-prod`), so **`sb-dev` is nobody's job unless someone runs it**. A stale `sb-dev` silently breaks the auth and seed work that develops against it.
4. Finish M05a's remaining primitives and wire the `(admin)` route group to merged auth.
5. Land M07 (R2 presign/finalize/`/f/[fileId]`) against the already-created buckets, and M09's database seed orchestrator with judge credentials.
6. Land M10's CP1 slice: `playwright.config.ts`, shared helpers, and all six skeleton specs running with zero failures; unlanded feature steps remain explicitly skipped.
7. Finish the deploy half of M08 and make the GitHub `Deploy` workflow itself green for preview — every run so far has been `skipped`.
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

The next implementation action is **step 1 of R1**: clear the open stack findings and land #10–#12. Three of the four foundation modules the rest of the build depends on exist only on unmerged branches, so every hour the stack stays open blocks R2 for five lanes.

## 7. Environment and configuration truth

[`environments.md`](environments.md) is the canonical provisioning inventory; [`../docs/provisioning.md`](../docs/provisioning.md) is the live checklist.

**Provisioned since rev. 4:**

- Neon project `sb` with isolated `sb-dev`, `sb-test`, `sb-prod` branches. Both migrations were proven on an expiring disposable branch, then applied to `sb-dev` and `sb-test`.
- R2 buckets `sb-files-preview` and `sb-files` in WNAM with exact-origin CORS.
- Preview web and jobs Workers deployed at `https://sb-web-preview.yi-ding.workers.dev`; the repository smoke script passed its health, public schedule, and public API probes. `global_fetch_strictly_public` resolved the Worker-to-Worker error 1042.
- GitHub `preview` and `production` environments restricted to `main`, production gated on `yisding` approval, `PRODUCTION_DEPLOY_ENABLED` unset.
- Exact preview and production origins recorded; no hostname is guessed in committed config.

**Still pending (31 unchecked items in the provisioning checklist):**

- Production `SESSION_SECRET` and `CRON_SECRET`; the pooled and direct Neon URLs saved per environment; R2 Object Read & Write S3 credentials.
- A least-privilege Cloudflare API token moved off repository scope into both protected environments.
- GitHub environment secrets and variables, and a `Deploy` workflow run that actually completes migration → web → jobs → smoke for preview. Preview was deployed with `scripts/deploy-cloudflare.sh`; all three `Deploy` runs on `main` were `skipped`.
- The entire Resend track: verified sending subdomain, SPF/DKIM/DMARC, real `EMAIL_FROM`, production API key, and fresh Gmail/Outlook OTP and calendar delivery evidence recorded in `DECISIONS.md`. **Nothing about email delivery is proven, which makes it the largest single risk to CP2.**
- The entire production section, including `sb-prod` migration, secrets, `EMAIL_MODE=send` with `EMAIL_FALLBACK_UI=0` and no `TEST_AUTH`, and the production health/cron confirmation.

The jobs worker must receive only `APP_BASE_URL` and its environment's `CRON_SECRET`. All database, session, R2-presign, Resend, ICS, and Airtable configuration belongs to `sb-web`. A custom-domain WAF rule is optional defense-in-depth and is not applicable to a `workers.dev` hostname.
