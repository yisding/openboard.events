# openboard — implementation status and recovery plan

- **Snapshot:** rev. 13 — Mon Aug 10, 2026, night. This is a reconciliation pass, not a code run: it folds in the **rev. 13 deployed-demonstration run**, [`../docs/evidence/rev13-deployed-run.md`](../docs/evidence/rev13-deployed-run.md) (executed 21:22–22:10 UTC against the still-current preview), and corrects a set of drifted claims this ledger had accumulated. **The single current deployed baseline is version `3f42f894`, code = merge `7b9cf3a` (PR #95), `/api/health sha: 8b566c0`** — the preview was never redeployed and never rebuilt during either the evidence run or this reconciliation; every other version string below this line (`b1fdc14a`, `5e809b64`, `1da1951d`, `2794dd4`, `673eac6`, `c662345`) is a **prior-revision snapshot**, kept only where it is explicitly dated as historical. **CP0 is now fully green**: the two items it was missing (a browser R2 presign/PUT/CORS round-trip, a deployed admin-throttle probe) both closed this run (§1 R1 items 3–4, `DECISIONS.md` "Deployed auth-throttle proof"). Four modules had their **deployed-evidence remainders** closed by this run — **M06a, M06b, M07, M54** — recorded with linked evidence in §3's new closure table. *(Corrected during the rev.-13 review pass: an earlier draft of this line claimed those four "clear all of §1's four DONE rules". They do not, and §3 still opens "No module is `DONE`". What closed is rule 3, the deployed half, for the specific items each row names; each of the four still owes a rule-2 item that this run did not touch — M06a/M06b work-order AC sign-off, M07 production S3 credentials and the `staging/` lifecycle rule, M54 its concurrent-edit CAS criterion plus `worker:size`/`bundle:client`, which are red on the merged tree per §2h. Promoting any of them to `DONE` is a separate, evidenced act.)* A bundle-diet attempt (`4fe419a`) briefly cut the Worker's gzip footprint by 15% (2895.34 → 2457.76 KiB dry-run, per its own commit message) but broke every deployed route and was reverted five minutes later (`b27539a`); `worker:size` CI is red again on the merged tree (3085.96 KiB dry-run > the 3072 KiB Workers Free ceiling) until a second, differently-shaped fix — landed in-tree but **not yet committed** — merges. Full account in the new §2h. §3, §4, §6 and §8 are corrected for drift (stale `NOT STARTED` rows, a "no further code" claim that contradicts M55's own header, an "M50–M55 not started" line that PR #94/#95 already falsified, and checkpoint rows rewritten against the evidence file).
- **Rev. 12 headline (unchanged):** **PR #95 merged** (§2g): the P4 commercial chain complete under explicit owner authorization — M42 Better Auth + Google with revocable admin sessions and PBKDF2 rehash-on-login (migration `0009`), M43 organization tenancy with default-org backfill (`0010`), M44 user management + invitations + audit (`0011`), M45 self-serve onboarding, M47 GDPR export/erasure/retention, M49 billing scaffold (`0012`) — plus M55 Speaker CRM core (`0013`, partial), the five remaining deployed e2e failures fixed, the embed-cache regression fixed (options-from-config; embeds are ISR again), and M50/M52 finish passes (deployed-evidence remainders only). Migrations `0009`–`0014` are applied to `sb-dev`/`sb-test` after the batch-transaction fix (`8b566c0`: enum-recreate pattern in `0009`/`0011`), and `sb-test` was reseeded. The jose fallback remains shipping auth until the deployed Better Auth round-trip (S4 redo).
- **Rev. 11 headline (unchanged):** **PR #94 merged** (§2f): the P3→P5 roadmap run landed P3 compliance hardening (CSP/HSTS on every non-embed path, a CSRF origin-check chokepoint inside `defineHandler`, and DB-backed rate limits via `drizzle/0005_rate_limits.sql`), email compliance (a signature-verified Resend bounce/complaint webhook, List-Unsubscribe headers, suppression enforcement via `drizzle/0007_email_compliance.sql`), R2 orphan sweep + backup/rollback/PITR runbooks, the forms debt cleared (M12 generalized to `context='portal'`, M13b's rules UI mounted live in the builder, M14's `upsertDraft` open-check gap closed, M24 built on the generalized engine), e2e spec fixes (three real triaged SPEC-BUGs) plus the app fixes they exposed (admin-shell/portal-context demo-store 404s, a trailing-autosave 404), and the P5 product-completeness modules M50 (partial), M51, M52 (partial), M53, M54 — landing five additive migrations, `drizzle/0004`–`0008`, applied to `sb-dev`/`sb-test`. M42–M49 were blocked pending explicit owner re-authorization of the M42 hold (the Better Auth spike); M55 stayed blocked on tenancy (M43/M44) — both resolved at rev. 12.
- **Rev. 10 headline (unchanged):** **the module-completion run landed** (§2e): a 45-agent orchestrated run implemented every code-completable remaining module — 16 complete, M13b/M14 partial, M24 blocked on an M12 scope contradiction — then merged the Jade+Ice palette (#92) and P6 plan (#91) from `main`, adapted all new surfaces to the `--accent` token family, and passed the full gate suite. All six e2e specs had real step bodies and all 17 `landed.ts` gates were flipped at that point.
- **Rev. 7 headline (unchanged):** **The Saturday thin slice is green on the deployed preview** — a proposal submitted through the real CFP endpoint landed in Neon with its routing applied, and its confirmation email was delivered to a real Gmail inbox from the verified sending domain. The deployment evidence in §2a is from that deployment, not from PGlite.
- **Baseline (current, rev. 13):** `main` at `04df486`, working tree carrying several concurrent lanes' uncommitted changes (§2h). **The preview is deployed from merge `7b9cf3a` (PR #95)**: version `3f42f894` at `https://sb-web-preview.yi-ding.workers.dev`, `/api/health` returns `sha: 8b566c0` (the migration-batch fix on top of `7b9cf3a`), a live Neon round-trip. Migrations `0000`–`0014` are applied to `sb-dev`/`sb-test`; `sb-test` is reseeded (docs/evidence/rev13-deployed-run.md preamble). The deployed Playwright suite went from 1 failed/17 skipped/23 passed on the first as-merged run to 9 failed/3 skipped/29 passed once the M50–M54 gates were flipped, and down to zero net-unexplained failures after triage — see §1 of the evidence file for the run-by-run detail; M50/M51/M52 are the only specs still not cleanly green (Findings 1 and 4, `needs_owner` item 4). *(Historical: at rev. 11 the baseline was `main` at `c662345` (PR #94), preview version `b1fdc14a`, 2299 KiB gzip, 19 passed/5 failed/5 skipped — superseded by PR #95 at rev. 12.)*
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

**Rev. 9:** all agents are shut down and every claim has been released from the module headers. `IN PROGRESS`/`IN REVIEW` here and in `modules/*.md` describe evidence on `main`, not active assignments; the claiming protocol in `plan/README.md` §2 resumes when agents are turned back on. The claim/reclaim/release commits interleaved on `main` were module-header bookkeeping only — every claim they recorded is released as of this revision.

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

**Treadmill warning (retired at rev. 9):** with all agents shut down, `main` is static at
`04df486`; §2c–§2d are reconciled against it and no merges are racing this document.

Bookkeeping note: `e2e/helpers/landed.ts` has **all 17 modules at `landed: false`**, and — a
rev. 8 correction to the earlier framing — that is currently *right*, not stale bookkeeping:
the spec **step bodies are still placeholder `async () => {}` stubs**, so flipping a gate over
them would report vacuous green on the specs that define checkpoints (cfp-submit is CP2's bar).
The real gap is M10's remaining work: implement the step bodies for the modules with deployed
proof (M15/M16/M17/M21/M34/M40 first), then flip their gates in the same change.

### 2d. PR ledger, #67–#89 (added at rev. 9)

All agents were shut down after PR #89 merged; this closes the ledger over the final tranche of
merges and direct commits since §2c:

| PRs | Module | What landed |
|---|---|---|
| #67 | M09 | The real submissions seed body — a fresh database has abstracts to triage |
| #68 | M18 | Draft-promotion transition enforcement and PGlite isolation hardening (the PR #34 recovery) |
| #69 | M21 | Portal submission list/detail refresh when the tab regains focus (the PR #31 recovery) |
| #70, #77 | M10 | Smoke cold-cache/retry-deferral fixes; load-test serialization/Hyperdrive conclusions corrected; release trackers synchronized |
| #71 | M32 | The cached public schedule stays server-rendered (the URL-search read moved into the route). The page itself still renders the demo store |
| #72 | M38/M27 | Dashboard review recovery: seeded event route/tab preserved, task rows routed through a real speaker list/drawer, missing-asset deep links honored; adds `getAdminSpeaker` — the first database-backed speakers-admin read |
| #73 (direct), #74 | M16 | Answer writes batched on the submit path (p95 32713 → 27703 ms); empty-value type-check ordering fix |
| #75 (direct) | M10 | The 50-concurrent load test recorded in `DECISIONS.md`: 50/50 `200 ok`, p95 27703 ms, zero duplicate codes — run against a **redeployed preview at build `2794dd4`** |
| #76 | M09/M07 | `pnpm seed` uploads the real R2 headshot objects its `file_assets` rows reference |
| #78, #80, #83, #84, #85 | M19 | **The whole evaluation stack**: plans/criteria/assignment server (single-statement CTEs, no ninth `withTx`), the reviewer queue read and self-guarding `submitReview` upsert, `scripts/seed/evaluation.ts`, the reviewer queue page (`/events/[id]/review`) sharing `<SubmissionAnswers>` with M17's drawer, and the organizer plans page. 41 new tests |
| #79 | M17 | Server-aware pagination/sorting, all status tabs, the unfiltered empty-state total, URL sync (the PR #38 follow-ups) — and with #84's extraction, the abstracts view renders a real `<SubmissionDrawer>` |
| #81 | design | The color-and-typography pass (`plan/design/design-system.md`, `globals.css`, root layout) |
| #82 | M12 | **The form builder is server-backed**: authenticated form list + six-step builder over real queries/mutations — default creation, immutable snapshot versions, all eight field types, locked-field and post-submission structural guards, stale-write protection, counts, reorder — with PGlite acceptance tests |
| #86 | plan | The product-completeness expansion recorded into PLAN/execution/module docs (M50–M54 scope; PLAN resolution #23) |
| #87 | M16/M09 | Route-contract recovery: event ownership derived from the route form, draft metadata returned, participant client-IDs/emails resolved server-side; the portal seed gains its form-completion task |
| #88 | M25 | **The whole portal task runtime**: `listMyTasks`/`getMyTask` over `task_assignments_v`, all three completion modes with the two audited `withTx` bodies, the three portal routes, speaker list/detail pages through the real `<FormFieldRenderer>`, and the viewers; 18+ PGlite cases (+ follow-ups `a1f577c`, `24c1949`) |
| #89 | M29 | **The conflict engine reconciled to the frozen contract**: `detectConflicts` → `ConflictDTO[]` per-subject sweep, `toScheduledSession`, deterministic result ordering (`148931f`); the demo consumes the single engine through an adapter |
| #58 | docs | Product-readiness gap notes, demo script, user flows, and the `landed.ts` gate annotations |
| `a0c6265` (direct) | M01 | CI parallelized into independent gates without weakening coverage |

**External evidence since rev. 8:** the delta #17 deliverability header gate passed — a probe from
the deployed preview delivered to a real Gmail inbox with `dkim=pass` on `mail.openboard.events`,
aligned `spf=pass`, and `dmarc=pass (p=NONE)`; recorded in `DECISIONS.md` (Sun Aug 9, 14:13 PT).

### 2e. The module-completion run (added at rev. 10)

One orchestrated run (45 agents: 6 parallel lanes with sequential modules, adversarial per-module
review, per-lane fixes, an integration gate, then M10's spec bodies) implemented the remaining
code across ~255 files / ~25k lines, followed by the `main` merge (#91 P6 plan, #92 Jade+Ice
palette) and the palette adaptation of every new surface to the `--accent` family:

- **Complete (code-level):** M11 events CRUD+vocab, M17/M18's audited remainder
  (`updateSubmissionFromCfp`, `withdraw`, `getAcceptedForScheduling`, `updateSubmissionFields`,
  manual create, withdraw route), M20 CSV, M22 profile + real headshot upload, M23 tasks admin,
  M26 resources, M27 speakers admin, M28 sessions CRUD + `moveSession` + `getMySessions` +
  the agenda seed, M30 day-grid DnD, M31 agenda views, M32 public pages over the published
  views, M33 embeds, M36 reminder scan (**the delta-20 gate flipped**: `/api/jobs/reminders`
  now runs `scanReminders` behind its green 15-case PGlite AC suite), M37 comms admin,
  M40 keyed API, M41 edit-until-close.
- **Partial:** M13b (rules UI landed; see its header for the remainder), M14 (settings steps
  landed; see its header).
- **Blocked:** M24 — M12's merged builder engine hardcodes `context='cfp'` in
  `getFormForBuilderIn`/`listFormsIn`/`createFormIn`, contradicting M12's own work-order promise
  that M24 saves through the same path; unblocking needs an M12-owned change.
- **M10:** all six specs' placeholder steps replaced with real bodies; all 17 `landed.ts`
  gates flipped in the same change, honoring the vacuous-green rule.
- **Gates:** invariants, `tsc`, `eslint --max-warnings=0`, full vitest (92 files / 831+ tests),
  `next build` — green before and after the palette merge.

Under §1's rules **none of this is `DONE`**: every named deployed/browser AC (and the external
email evidence) remains, and is now the entire remaining judged-bar surface.

### 2f. The P3→P5 run (added at rev. 11)

**Deployed e2e state (rev. 11 deploy, build `c662345`):** the full Playwright suite went
from 16 failures (first-ever run) to **19 passed / 5 failed / 5 skipped**. The five:
`abstracts-decide` bulk-notify idempotency, the builder public-form-link 200, and three
empty-event empty-state specs (`abstracts-decide`, `admin-setup`, `public-embeds`) that
likely share one root cause. These are the E2E leftovers in §6's code queue.

**Known regression (found at the rev. 11 deploy):** M53's new `/embed/*` pages read their
options from `searchParams`, which forces dynamic rendering — **embeds are no longer
edge-cached** (`private, no-cache`), while the `/e/*` pages keep `revalidate = 60` and
`x-nextjs-cache: HIT`. The old M33 shell's cacheability was CP0-adjacent evidence. Fix
direction: options-from-config (the `embeds` table row) rather than URL, or explicit
cache headers on the embed routes. The post-deploy smoke deliberately does not assert
`s-maxage` on embeds until this is fixed. Legacy `/e/<slug>/schedule` and
`/embed/<slug>/schedule` URLs 307 to the new surfaces (deliberate, documented in the route).

One orchestrated run (a P3-SEC/P3-EMAIL/P3-OPS compliance lane, a forms-debt lane, an e2e-triage
lane, and five P5 product-completeness lanes, followed by an integration gate) landed as PR #94
(merge commit `c662345`). Five additive migrations were added to the journal — `drizzle/0004_review_operations.sql`,
`drizzle/0005_rate_limits.sql`, `drizzle/0006_content_deliverables.sql`,
`drizzle/0007_email_compliance.sql`, `drizzle/0008_speaker_roster_operations.sql` — applied to
`sb-dev`/`sb-test`; no applied migration was edited and the journal audit (sequential idx 0–8,
strictly ascending `when`, tags matching the nine `.sql` files on disk) is clean. All five
integration gates (`check-invariants.sh`, `tsc --noEmit`, `eslint --max-warnings=0`, the full
vitest suite — 122 files / 1077 tests, 0 failed — and `next build`) are green on the merged tree.

- **P3-SEC:** a real CSP (`default-src 'self'` plus the R2 upload host) and HSTS on every
  non-embed path; a CSRF origin/referer check inside `defineHandler` (the single chokepoint),
  with `csrfExempt` on the cron/API-key guards; a DB-backed fixed-window rate limiter
  (`rate_limit_buckets`, migration 0005) applied to the public submit/draft path, portal-login
  request (by IP, closing the per-contact-throttle cycling gap), and all `/api/v1` routes.
- **P3-EMAIL:** a signature-verified Resend bounce/complaint webhook writing to a new
  `contact_suppressions` table (migration 0007) rather than columns on `contacts`, to avoid
  breaking `getOrCreateContact`/`updateContactFields`'s bare `.returning()` call sites;
  RFC 2369 List-Unsubscribe headers on non-essential sends; `events.physical_address` rendered
  in the email footer; `unsubscribed_at`/suppression now honored fleet-wide via a new
  `isTransactionalTemplate` classification.
- **P3-OPS:** the R2 orphan sweep is wired live (`cleanupOrphans` composes the
  previously-dead-code `cleanupOrphanUploads` with a new staging-object S3 sweep); a
  console-only `captureError` seam is wired into `defineHandler`'s and the job routes' catch
  blocks; `docs/runbooks/backup-restore.md` and `docs/runbooks/rollback.md` were written and
  their CLI syntax verified against the installed `wrangler`/`neonctl`.
- **M12-GENERALIZE / M13b / M14-GAP / M24 (forms debt):** M12's builder engine now accepts
  `context`/`targetType` generically instead of hardcoding `'cfp'`; M13b's `VisibilityRuleEditor`/
  `RoutingRulesPanel`/`BuilderPreview` are mounted live in `form-builder.tsx`; M14's `upsertDraft`
  gap (a closed form's draft could still be started/resumed) is closed via the same
  `assertFormOpen` helper the other write paths use; M24's portal form builder (list/duplicate/
  delete, single-page builder, standard-field library) is built on the generalized engine. See
  each module's own header for what remains.
- **E2E-TRIAGE / APP-FIXES:** all 16 Playwright failures on the deployed build were triaged —
  3 were spec bugs (fixed directly in `e2e/**`) and 13 were two real app bugs: `admin-shell` and
  `portal-context` both resolve the current event from the browser demo-store fixture and
  `notFound()` when a real seeded id isn't in it, so every real admin/portal surface 404s in a
  browser despite healthy server data; a third bug is a trailing debounced draft-autosave firing
  ~450 ms after a successful submit and 404ing. All three are fixed: the admin/portal layouts now
  pass their real server-read event/contact down instead of relying on the demo store, and the
  autosave is cancelled the moment submit is in flight (with a server-side no-op fallback).
- **M50 (partial):** round windows, `anonymize_authors`, typed criteria (numeric/select/text),
  explicit `review_assignments` (assignment authority + recusal), reviewer provisioning and
  reminders — landed on M19's evaluation stack via migration 0004. Deployed browser AC (a
  redeploy + reseed carrying Round 2) is the remainder.
- **M51:** speaker create/update, logistics fields, timezone-correct unavailability, CSV import,
  invite-via-M06b, and bulk email compose/send — landed via migration 0008. Deployed browser AC
  is the remainder.
- **M52 (partial):** file versions + comment threads, a central Files view with filtered bulk
  reminders, session content history/restore, organizer bio/headshot edit, and a ZIP export job
  pipeline — landed via migration 0006. Its owned e2e spec was not written and no surface has
  browser/real-R2 verification; both are the remainder.
- **M53:** all five public/embed surfaces (Sessions List, Agenda, Schedule Itinerary with ICS
  export, Speakers List, Speaker Gallery) over M32/M33's published views, with `/e/` and `/embed/`
  parity routes — no new migration needed. Deployed/browser AC across every surface is the
  remainder.
- **M54:** a pure deterministic greedy placement planner plus an Apply flow that preflights
  through the same legality check and writes only through the audited `moveSession` — no schema
  change. Deployed browser AC (gated on M51's migration too) is the remainder.
- **M46 / M48 (product-roadmap, not on the release critical path):** M46 built the admin surface
  (suppression list + reinstate, per-domain deliverability, segmented bulk send with preview, a
  dedicated `UNSUBSCRIBE_SECRET`) over P3-EMAIL's tables — no schema change. M48 deepened
  `/api/health` with a `comms` block, documented alerting thresholds, added a scheduled uptime
  GitHub Action, and wrote the R2-lifecycle and Neon-PITR-rehearsal runbooks — also no schema
  change. Both are complete at code level; both still need their deployed-preview evidence.
- **M42–M49 (blocked):** M42 (Better Auth + Google admin auth) was not completed by this run
  ("agent died or skipped"); M43 (org tenancy), M44 (user management), M45, M47, and M49 all
  hard-depend on M42 and were not attempted. Per `DECISIONS.md`'s "Product auth direction," M42
  is the unknown-risk gate for the whole P4 chain and stays on hold until the owner explicitly
  re-authorizes another attempt.
- **M55 (blocked):** skipped outright by this run because M43/M44/M51 were not all complete; M51
  is now merged, so M55's remaining blocker is tenancy (M43/M44), i.e. the same M42 hold above.

### 2g. The P4 run (added at rev. 12)

The owner explicitly re-authorized the M42 hold this run, unblocking the entire P4 commercial
chain in one orchestrated pass (auth chain lanes M42→M43→M44→M45/M47/M49 plus M55, run alongside
an independent P5-remainders lane), which merged as **PR #95** (merge commit `7b9cf3a`). A
follow-up commit, `8b566c0`, fixed a real migration-batch bug the merge exposed (below) and
applied the batch for real. Per module, with its migration:

- **M42 — Better Auth + Google (complete, `drizzle/0009_product_auth.sql`):** admin/organizer
  auth now runs on Better Auth behind `ADMIN_AUTH_PROVIDER` (default still `fallback`), sharing
  one `getAdminIdentity` switch point with `requireAdmin`/`authorizeAdmin` untouched on both
  sides. `0009` adds `admin_accounts`/`admin_verifications`, finally populates the `admin_sessions`
  table `0000_init` created and nothing ever wrote to, adds `users.email_verified`/`image`, and
  backfills a `credential` account from every legacy `password_hash`. Legacy PBKDF2 hashes verify
  through a Better Auth hook and rewrite themselves to a v2 scheme on first successful sign-in
  (`WHERE password = <old value>` guarded, so a concurrent second sign-in is a no-op);
  `users.password_hash` is left intact so the switch stays a clean revert. Revocation is a row
  delete, re-read on every request (no cookie cache). Google is wired as a social provider with
  account linking on and self-serve sign-up deliberately closed (M44 supersedes that). The
  deployed round-trip — including the Google leg, real bundle-size measurement, and the deployed
  revocation proof — is the S4 redo and is still outstanding; see §6.
- **M43 — organization tenancy (complete, `drizzle/0010_organization_tenancy.sql`):** additive
  `organizations`/`organization_members` plus `events.organization_id` (NOT NULL with a database
  default pointing at a fixed default-organization row the migration inserts and backfills from
  `event_members` at each admin's strongest role), so every existing event lands in the default
  org automatically. `requireOrganizationAdmin`/`authorizeOrganization` sit beside the untouched
  per-event guards, sharing only `getAdminIdentity`, `roleSatisfies`, and the
  UNAUTHORIZED/FORBIDDEN split. `events` gains `UNIQUE (id, organization_id)`, extending the same
  composite-FK pattern event-scoped child tables already use, so organization-scoped tables
  (M47's exports, M49's plans) can pin `(event_id, organization_id)` and let Postgres reject a
  cross-tenant row.
- **M44 — user management (complete, `drizzle/0011_user_management.sql`):** self-serve signup
  (`/sign-up/email`, gated by a `databaseHooks.user.create.after` hook so no account is ever
  orphaned outside an organization), team invitations through the outbox
  (`organization_invited`, join token minted at render time), owner-only role/removal management
  layered on M43's DB-level last-owner guard, and self-service admin-session list/revoke over
  M42's `admin_sessions`. `0011` adds `organization_invitations` (upserted so a resend refreshes
  in place) and `organization_audit_log` (append-only). Ten new API routes under
  `/api/internal/organizations/*` and `/api/internal/me/sessions/*`; new UI at `/signup`, `/join`,
  `/organizations/[id]/team`, `/organizations/[id]/audit`, `/account/sessions`.
- **M45 — self-serve onboarding (complete, no schema change):** a 4-step guided wizard
  (`provisionOrganizationEventIn`, one composition over M11's `createEventIn` and M43's
  `assignEventToOrganizationIn` — zero new INSERT statements) at `/organizations/[id]/onboarding`:
  event basics → vocabulary/tracks → first CFP form (M12's default 12-field form, optional
  publish) → a shareable public link. New `/organizations` and `/organizations/[id]` entry points
  close the seam M44 documented ("`organizationHomeEventId` returns null until M45's
  event-creation flow lands").
- **M47 — GDPR export/erasure/retention (complete, no schema change — reads/writes existing
  tables):** `exportContactDataIn`/`exportOrganizationDataIn` bundle a contact's or organization's
  full record (never token/OTP hashes) behind two new GET routes; `eraseContactDataIn` deletes/
  anonymizes a contact across ~18 tables in FK-chain order, is the 10th function on the audited
  `withTx` list, returns a per-table deletion receipt, and purges the contact's orphaned R2 files
  immediately rather than waiting for the daily sweep; `runDataRetentionSweepIn` purges expired
  tokens/sessions 30 days past expiry and redacts rendered email bodies 90 days after send,
  wired into the existing `/api/jobs/cleanup` route. Draft `docs/legal/{privacy-policy,
  terms-of-service,dpa}.md` added, each headed DRAFT/not binding.
- **M49 — billing scaffold (complete, `drizzle/0012_billing_scaffold.sql`):** a hand-seeded plan
  catalog (`billing_plans`: free/pro/enterprise), one `organization_subscriptions` row per org
  (existing orgs backfilled — the seeded default org to `enterprise`, everyone else to `free`;
  `createOrganizationIn`'s atomic CTE now seeds a `free` row for every new org too), and
  `organization_usage_counters`. The one real limit — events-per-org — is enforced with a live
  `COUNT(events)` inside `provisionOrganizationEventIn` before any writes happen. A
  `BillingProviderAdapter` seam exists with only a `StubBillingProviderAdapter` implementation:
  checkout/portal throw `VALIDATION` rather than fabricate a working URL; webhook verification is
  a real HMAC over the raw body, fail-closed when `BILLING_WEBHOOK_SECRET` is unset. Billing
  settings surface at `/organizations/[id]/billing` only under the local-only
  `BILLING_MODE=scaffold`; deployed configuration now disables and hides every billing surface
  until a real provider adapter exists.
- **M55 — Speaker CRM (partial, core landed, `drizzle/0013_speaker_crm.sql`):** an
  organization-level `organization_contacts` identity distinct from event-scoped `contacts`
  (11 tables: links, tags, custom fields, notes, an append-only activity timeline, saved dynamic
  segments resolved fresh on every read, an immutable merge audit table, and a three-stage
  open/won/lost pipeline). Full server/contracts layer and 16 API routes under
  `/api/internal/organizations/[id]/crm/**`, all `organizationAuth()`-scoped;
  `mergeOrganizationContactsIn` is the 10th (11th, after M47's) function on the `withTx` audit
  list. Bulk email delegates to M51's `composeBulkSpeakerEmailIn` rather than adding a second
  sender. **No UI was built** — no directory page, merge wizard, segment builder, pipeline
  kanban, or CSV import wizard; the server/API boundary is the deliberate stopping point for this
  pass.
- **E2E-FIVE (complete):** all five of rev. 11's remaining deployed Playwright failures fixed.
  Three were the same spec bug (Playwright's substring accessible-name match hit both a page's
  `h1` and its own empty-state `h3`, e.g. "Abstracts" matching "No abstracts yet") plus one stale
  spec (M53 split `/schedule` into five surfaces). The builder's public-form-link failure had two
  real causes: `<Field>` wrapping a whole choice grid in one `<label>` gave every card the same
  accessible name (fixed with a new `group` prop rendering `role="group"`), and a save/reload
  race. Bulk accept-and-notify was a real server bug: `submissionFiltersSchema` required bare
  integers for `page`/`pageSize`, but every caller sends a query string — now coerced. Confirmed
  against the deployed preview (four specs) and one local `next build && next start` session
  against real `sb-test` (the fifth, since the preview it needed hadn't redeployed yet).
- **EMBED-CACHE (complete):** the rev. 11 regression fixed exactly on the recorded direction —
  options-from-config. All five `/embed/[eventSlug]/**` content routes stopped reading
  `searchParams` and now derive `EmbedOptions` from the `embeds.style` DB column via a new
  `resolveEmbedOptions`, each exporting `revalidate = 60` + empty `generateStaticParams` like
  their `/e/**` twins. A new narrow `revalidatePublicEmbed` invalidates the specific embed page
  the moment its config is saved. `next build` itself could not be run on this box (hard rule);
  the fix is confirmed statically (no remaining `searchParams` reader, identical cache-shape to
  the already-proven `/e/**` routes) and awaits a deployed rebuild for the `s-maxage`/
  `x-nextjs-cache: HIT` proof.
- **M50-FINISH (partial, no schema change):** the seed fixture and e2e spec were the real gaps,
  not the server. `scripts/seed/forms.ts` never wrote `review_visibility` at all (every seeded
  field defaulted to `identity`, so no seeded question was ever classified as review content);
  the two AC-named questions (`approach`/content, `employer`/fail-closed) are now seeded and
  answered, Round 2 now seeds a third reviewer plus a completed/recused row, and the spec gained
  the half-open-window and answer-level-blindness assertions it lacked. `landed.ts` still keeps
  `M50: false` — the remainder is a reseed and a deployed Playwright run, not more code.
- **M52-FINISH (partial, no schema change):** the one concrete code-queue item — the central
  Files view filtered client-side despite the GET route already supporting server-side filters —
  is fixed (`deliverableFiltersSchema` shared between route and page, a new
  `getDeliverableStateCountsIn` aggregate for tab badges, `FilesAdminView` now pushes filters into
  the URL). `e2e/speaker-content-ops.spec.ts`'s M52 block and its `landed.ts` gate were already
  present, uncommitted, in the shared tree and needed no changes. The remainder is the same
  deployed-browser/real-R2 evidence the module header already named.
- **Integration gate:** the second-pass integration gate over the whole auth-chain + remainders
  lane is green on all five checks — `check-invariants.sh`, `tsc --noEmit`, `eslint
  --max-warnings=0`, **141 files / 1236 tests** (`pnpm vitest run`), and `next build` (confirming
  `/embed/[eventSlug]/agenda` now prerenders). One failure surfaced and was fixed in-gate:
  `tests/post-deploy-smoke.test.ts`'s fake-`curl` fixture still modeled the pre-M53 URL map;
  updated to match the script's real `/e/**`-vs-`/embed/**` probes.
- **Migration 0014** (`drizzle/0014_email_template_backfill.sql`, additive): a separate,
  unrelated bug the batch run surfaced — `seedDefaultTemplates` only fires at event creation, so
  every migration that appended a `template_key` enum value left pre-existing events without a
  row for it, and the dispatcher treats a missing template row as terminal. Backfills every
  event's missing default-template rows for the whole enum (`ON CONFLICT DO NOTHING`), closing
  the gap for `admin_password_reset` in particular (a recovery path that must not silently fail).
- **The migration-batch fix (`8b566c0`):** drizzle applies a pending batch in one transaction,
  and `ALTER TYPE … ADD VALUE` leaves the new label unusable until that transaction commits —
  `0014`'s backfill uses the template keys `0009`/`0011` add, so a fresh `pnpm db:migrate` failed
  outright. Both migrations were rewritten to the enum-recreate pattern (new enum, retype column,
  rename; the `communication_logs` secret-payload CHECK dropped and re-added around the retype).
  Proven with a full-batch single-transaction dry run against `sb-test`, then applied for real to
  `sb-dev` and `sb-test`; `sb-test` was reseeded afterward.

### 2h. The bundle diet — one reverted attempt, one in-tree fix (added at rev. 13)

**The incident.** `4fe419a` ("split shared first-party server code into one chunk") added a
*named* `app-shared` `splitChunks` cacheGroup, measured 2895.34 → 2457.76 KiB gzip on a wrangler
dry-run (−437 KiB, −15%), and broke every route on the deployed Worker; `b27539a` reverted it five
minutes later. The cause is in `@opennextjs/cloudflare`: workerd cannot run webpack's dynamic
chunk require, so OpenNext unrolls it into a static switch built from
`readdirSync(...).filter((chunk) => /^\d+\.js$/.test(chunk))`. A *named* chunk lands as
`chunks/app-shared.js`, fails that numeric filter, never enters the switch, and is therefore never
seen by esbuild either — the Worker ships without it and the first request that needs it dies on
`Unknown chunk <id>`. `next build`, `vitest` and the size gate all stayed green; the size gate got
*greener*, because the artifact was smaller for exactly the wrong reason.

**The in-tree fix (landed in the working tree, not yet committed).** Two parts, both narrow:

- `next.config.ts` tunes the same `splitChunks` knobs without ever setting `name` — `minSize: 0`
  and the two request caps lifted, guarded to the production **nodejs** server compilation
  (`nextRuntime === "nodejs"`, so the single-entry edge/middleware build is untouched). Unnamed
  chunks keep webpack's numeric ids and are picked up by OpenNext's patch like any other chunk.
- `scripts/check-worker-size.sh` gains a completeness gate ahead of the size gate: every
  `chunks/*.js` on disk must appear as an input of the bundled `handler.mjs` in esbuild's
  metafile. That is the check that would have caught `4fe419a` before deploy.

**What was measured, and how.** Two throwaway trees built from `git archive` — one at HEAD, one at
HEAD plus the fix — summing `bytesInOutput` over
`.open-next/server-functions/default/handler.mjs.meta.json`:

| | HEAD | HEAD + fix |
| --- | --- | --- |
| `.next/server/app/**` bundled | 8325 KiB | **6622 KiB** (−1703) |
| `.next/server/chunks/**` bundled | 2780 KiB | 2469 KiB |
| total bundled input | 14395 KiB | **12382 KiB** (−2013) |
| server chunks emitted | 66 | 179 |

A wrangler dry-run on the fix tree reports **2242.45 KiB gzip** — inside both the 3072 KiB Workers
Free ceiling and the 2560 KiB upgrade threshold. **There is no matching isolated-HEAD gzip
measurement**, so this lane establishes the *uncompressed* HEAD→fix delta and an absolute gzip
figure for the fix, not a gzip delta. The 3085.96 KiB working-tree figure quoted in §2 and §3 is
from a different run against a dirty tree carrying several lanes' changes, and is not comparable
with either column above.

**Scope of the workerd proof.** The built artifact was served under workerd (`wrangler dev`
against `.open-next`, never deployed) and answered **an 18-URL slice**: `/api/health`, `/login`,
`/e/{slug}/agenda`, `/e/{slug}/speakers`, `/embed/{slug}/agenda`, `/portal/{slug}/login`, two
public `/api/v1/**` reads, `/events`, five admin `/events/{id}/**` pages, `/organizations`, and
three internal `/api/internal/**` reads. Seventeen returned 200 and `/organizations` returned
307, with zero `Unknown chunk` / `Cannot find module` lines in the workerd log. That slice is 18
of 209 built server entries (146 `route.js` + 63 `page.js`); **it is not "every route."** The
all-routes claim rests on the metafile completeness gate above, which is a static check, not an
execution proof.

**Measurement hygiene, recorded against this lane.** The two *baseline* builds ran inside the
shared working tree rather than an isolated one, while other lanes were active: `.next` (14:27),
`.open-next` (14:28) and `.wrangler/worker-size.txt` (14:28) in the repo root carry matching
mtimes. All three paths are gitignored, so no tracked file was touched, and the numbers in the
table above were re-taken from the two isolated trees precisely because the in-repo artifact was
not a clean baseline (it reports 8088 / 14063 KiB against HEAD's true 8325 / 14395). Until this
pass, `.wrangler/worker-size.txt` held a shell "command not found" error rather than a size
measurement — `check-worker-size.sh` now refuses to run when `wrangler` is off PATH instead of
`tee`-ing that error into a file that looks like a result.

**Gate re-run at fix time.** `pnpm worker:size` completes end to end on the current tree: the
completeness gate reports all 66 chunks bundled, and the size gate reports **2901.34 KiB gzip** —
a pass against the 3072 KiB ceiling, with the 2560 KiB upgrade-threshold warning. Two cautions on
that number: it was taken against the **stale 14:27/14:28 in-repo `.open-next`**, which is a
*pre-fix* build of a dirty tree, so it is neither the 2242.45 KiB fix-tree figure nor a clean HEAD
baseline; and because it is a different artifact from whatever produced the 3085.96 KiB reading
quoted in §2 and §3, it does **not** confirm or refute that the merged tree is over the ceiling.
That question needs one build and one dry-run on a clean checkout of the merge, which this lane
did not run.

**Final integration gate (rev. 13, run on the full merged working tree).** The build the paragraph
above asks for has now been run, in order and one process at a time, against the complete
finish-everything tree — bundle diet, evidence/ledger docs, M55 UI, M52-ZIP and P6 together, not a
single lane in isolation:

| Gate | Result |
| --- | --- |
| `scripts/check-invariants.sh` | pass |
| `tsc --noEmit` | pass |
| `eslint . --max-warnings=0` | pass |
| `vitest run` | 1299 passed / 153 files, 0 failed |
| `next build` | pass |
| `opennextjs-cloudflare build --env preview` | pass |
| `pnpm worker:size` completeness gate | **all 196 server chunks bundled** |
| `pnpm worker:size` size gate | **2300.80 KiB gzip** |

So the merged tree is **not** over the ceiling: 2300.80 KiB is inside the 3072 KiB Workers Free
limit *and* under the 2560 KiB upgrade threshold, with no warning emitted. That retires the
3085.96 KiB figure quoted in §2/§3 and the 2901.34 KiB stale-artifact figure above — both were
taken against pre-fix or dirty builds. It does not contradict the 2242.45 KiB fix-tree reading
either: that tree was HEAD-plus-the-diet, while this one additionally carries M55, M52-ZIP and P6,
so ~58 KiB gzip of net new feature code is the expected difference. The chunk count rose 179 → 196
for the same reason. (Build was `--env preview`, dry-run `--env production`, as `check-worker-size.sh`
hard-codes; the two envs differ only in `vars`/bucket names, not in bundled code.)

**Workerd execution slice at final-gate time — narrower than the 18-URL slice above, and why.**
The artifact was served under `wrangler dev --env preview` and answered 13 URLs. `/`, `/signup`
and `/login` returned 200; `/events`, `/organizations` and `/portal/{slug}` returned 307;
`/api/internal/events` and `/api/v1/{slug}/stats` returned 401; `/api/jobs/cleanup` 405;
`/demo` and `/api/auth/session` 404. **`/api/health` returned 503 and `/submit/{slug}/{formId}`
returned 500** — both because this machine's `.dev.vars` carries an *empty* `DATABASE_URL`
(`DATABASE_URL_DIRECT`, `RESEND_API_KEY` and all three `R2_*` keys are empty too). The 503 is
`/api/health`'s own `{"ok":false,...,"db":{"ok":false}}` catch-block JSON with
`health check failed DATABASE_URL is not configured` in the log, and the 500 is a thrown
`AppError: DATABASE_URL is required` — i.e. both are the application's own configuration errors
reached *after* the route module loaded and ran, which is the opposite of the failure being
guarded against. **There were zero `Unknown chunk` and zero `Cannot find module` lines across the
whole run.** No DB-backed response was proven at this gate, because the Neon HTTP driver needs a
real Neon HTTPS endpoint and none is reachable from here; the DB-backed half of the workerd proof
still rests on the earlier 18-URL slice and on the deployed preview.

## 3. Module status by evidence

No module is `DONE` as of this snapshot. As of rev. 9 no module is `PR-OPEN` — every open agent
branch has merged — so what separates the merged modules from `DONE` is AC sign-off and deployed
evidence, not merges.

### Deployed-evidence remainders closed at rev. 13

The rev. 13 run closed §1 **rule 3** — the deployed half — for the four items below. It did **not**
make any of these modules `DONE`: the "still owed" column is what rule 2 (work-order AC against the
merged tree) and, for M07, rule 3's own remaining infrastructure items still require. This table
exists so rule 4 is satisfiable — the evidence is linked here rather than asserted in a preamble.

| Module | What closed, and where the evidence is | Still owed before `DONE` |
|---|---|---|
| M06a | The **deployed admin sign-in throttle**: six paced attempts on `sb-web-preview` → five 401s then a 429 (`RATE_LIMITED`), i.e. the documented five-per-email+IP-per-15-min policy on the deployed application. [`rev13-deployed-run.md` §3b](../docs/evidence/rev13-deployed-run.md). This is the CP0 / R1 item 4 bullet open since rev. 5. | Work-order AC sign-off against the merged tree. Also read Finding 2 there: unpaced, the same probe returns Cloudflare 1102/503 before the throttle answers |
| M06b | The **phone-width** item this ledger's cell named: `portal-tasks.spec.ts` at `viewport 390×844` — which signs in through the real portal login path — passed against the preview, with no sideways scroll on portal home, the task list or the task detail. [`rev13-deployed-run.md` §6](../docs/evidence/rev13-deployed-run.md). *Caveat worth keeping:* M06b's own work order (`M06b-portal-auth.md:111`) has **no** phone-width criterion — that cell was a ledger-side addition, so this closes a ledger item, not a work-order one | Work-order AC sign-off against the merged tree, i.e. the command list at `M06b-portal-auth.md:113-121` — in particular the two-event simultaneous-session test and the 6th-wrong-OTP rejection. The deployed OTP/magic-link half was already proven at rev. 7 (§2a) |
| M07 | Both deployed file items: a **real browser presign → PUT → finalize** from a Chromium page against the preview (the only place CORS is actually exercised), [§6](../docs/evidence/rev13-deployed-run.md); and the **`curl -I /f/{id}` header check** on a real seeded R2 object in `sb-files-preview` — 200, `image/png`, `cache-control: public, max-age=31536000, immutable`, [§4](../docs/evidence/rev13-deployed-run.md) | **Production S3 credentials** and an **R2 lifecycle rule on the `staging/` prefix** — neither touched by this run, both still rule-3 items |
| M54 | The **deployed assisted-placement AC**: Auto-place previewed both rows, the blacked-out speaker's row carried its unavailability reason, one accepted row applied through the audited `moveSession`, and the placement survived a reload. [`rev13-deployed-run.md` §1f](../docs/evidence/rev13-deployed-run.md), run 6 | The concurrent-edit criterion (a `moveSession` CAS failing visibly under a racing edit) is not covered by that spec; `check-worker-size.sh` / `check-client-bundle.ts` are still unrun for this module, and `worker:size` is red on the merged tree (§2h) |

Two related gates are recorded here because they are easy to misread as closures and are not:
`e2e/helpers/landed.ts` now has **M50, M51 and M52 at `true`** on the strength of each gate's own
stated deployed/data condition, but those three specs have **never passed end-to-end** — M50 on a
real app/seed gap (no reviewer has a `contacts` row, so reminders enqueue 0), M52 on a defect
localised to the portal upload's `attach()` POST, M51 on non-idempotent arrange steps plus the
preview's 503s. See [`rev13-deployed-run.md` §1g, §8 Findings 1/4/6 and `needs_owner` 3–4](../docs/evidence/rev13-deployed-run.md), and the long comment in `landed.ts` itself.

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
| M06a | PR #11 — sessions, guards, middleware, throttle, bootstrap; **deployed sign-in proven at rev. 7** (§2a); **deployed auth-throttle proven at rev. 13** (§3 closure table) | AC sign-off |
| M06b | PR #12 — OTP/magic link, tokens, sessions, impersonation; **deployed OTP session and delivered `portal_login` email proven at rev. 7** (§2a); **deployed 390 px portal pass at rev. 13** (§3 closure table) | AC sign-off — the `M06b-portal-auth.md:113-121` command list, notably the two-event session test and the 6th-wrong-OTP rejection |

### Merged since rev. 5, AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M07 | PRs #15 + #17 — policy table, staging→published keys, the four routes, orphan sweep, and CI grep #11; **the browser presign/PUT/CORS round-trip and the `curl -I /f/{id}` header check both proven deployed at rev. 13** (§3 closure table) | Production S3 credentials, and an R2 lifecycle rule on the `staging/` prefix |
| M34 | PR #16 — dispatcher, templates, renderer, Resend integration, comms seed; **Gmail delivery through a deployed dispatch proven at rev. 7** (§2a) | The Outlook probe, calendar-invite delivery, DMARC confirmation, and a production sending key |
| M05a | PR #24 — the core primitives and the kitchen sink | Six list surfaces actually consuming `<DataTable>`; the `(admin)` route group, deliberately unclaimed |
| M09 | PR #20 — orchestrator, ids, stubs, target verification | A run against a real database, then the eight per-feature bodies, which belong to their own lanes |
| M10 | PRs #19, #22, #23 — spec skeleton, deepened smoke, load test, README, checklist | Specs go green only as their features land; the load test needs M16's submit endpoint |

### Merged since rev. 8 (reconciled at rev. 9), AC verification pending

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M12 | #82 — the server-backed six-step builder (§2d) | Deployed/browser authoring AC (unblocked — the preview now runs `673eac6`) |
| M19 | #78/#80/#83/#84/#85 — the full evaluation stack, 41 tests | The deployed AC: the seeded reviewer signs in on the preview, scores three abstracts, and the Rating column matches a hand-computed average (unblocked — the preview now runs `673eac6`) |
| M25 | #88 — the whole task runtime, 18+ PGlite cases | The phone-width deployed run-through and the dashboard count dropping on the next poll (unblocked — the preview now runs `673eac6`) |
| M29 | #89 — the contract-true conflict engine with deterministic ordering | The randomized property test; a real server caller (M28's `getSchedulableSessions` does not exist) |
| M17 | #37/#61/#79/#84 — DB reads, server pagination/tabs/URL sync, the decision bar + Notify, and a wired `<SubmissionDrawer>` | `updateSubmissionFields`, manual "Add Abstract", the deployed triage AC |
| M18 | #34/#57/#68 — creation, the transition/notify halves + routes, promotion enforcement | `updateSubmissionFromCfp`, `withdraw`, `getAcceptedForScheduling`, the withdraw route; deployed lifecycle probes |
| M21 | #29–#33/#69 — every surface DB-backed, focus refresh | Deployed evidence; the My Sessions widget waits on M28 |
| M09 | #67/#76/#83/#87 (on top of #32/#41/#46/#65) — **seven of eight seed bodies real**, incl. real R2 headshot objects and the form-completion portal task | The agenda seed (waits on M28); a recorded full run against a real database; the judge-script AC |

### Merged partial implementation

| Modules | Evidence on `main` | Missing before `DONE` |
|---|---|---|
| M01 | App scaffold, health route, pinned Next/OpenNext, validation CI; **preview is live** at `https://sb-web-preview.yi-ding.workers.dev`. **Current deployed version (rev. 13): `3f42f894`** (code = merge `7b9cf3a`; size not re-measured post-deploy — see §2h for the working-tree `worker:size` gate state, 3085.96 KiB dry-run, red pending the in-tree fix). *(Historical: `5e809b64` at rev. 7/9, 1679 KiB gzip; `b1fdc14a` at rev. 11, 2299 KiB gzip.)* Resend probe and revalidate-60 **proven at rev. 7** (§4 CP0) | A green `Deploy` workflow run from `main` (Browser R2 presign/CORS and the deployed application-throttle proof are **done** — §1 R1 items 3–4, `DECISIONS.md` "Deployed auth-throttle proof") |
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
| CP0 — deployed skeleton and existential spikes | **GREEN, rev. 13** | Preview URL live; real Neon round-trip; bundle inside the Free budget (though `worker:size` on the merged tree needs §2h's fix to stay that way); jobs tick; embed `frame-ancestors` proven by curl; **edge cacheability proven** (`s-maxage`, `x-nextjs-cache: HIT`); **the delta #17 header gate passed at rev. 9** — `dmarc=pass` with aligned SPF/DKIM identities on a Gmail delivery (`DECISIONS.md`, Sun Aug 9). **Both remaining items closed at rev. 13**: a browser R2 presign/CORS upload (`docs/evidence/rev13-deployed-run.md` §6, via `portal-tasks.spec.ts`) and a deployed application auth-throttle proof (§3b of the same file; `DECISIONS.md` "Deployed auth-throttle proof") |
| CP1 — contracts/schema/foundation freeze | **NEARLY GREEN** | Contracts merged; the stack merged; migrations applied to `sb-dev` and `sb-test` **from the repo's own SQL**; seed loads; **admin login works on the deployed preview**; the six-spec Playwright skeleton ran at CP1 exit (nine full specs exist now — §1's "six specs" correction in §6); **the freeze declaration is now recorded in `DECISIONS.md`** (rev. 8). Missing: `sb-prod` and a green `Deploy` workflow run |
| **Sat thin slice — CFP to Abstracts** | **GREEN on the server path** | A deployed submit stored a submission with routing applied and delivered its confirmation email. The Abstracts *table* reads the database; its drawer and bulk actions do not yet |
| CP2 — golden spine | **GREEN on deployed evidence, rev. 13** | Green: real OTP, submit, one **delivered** email, public schedule and gallery. Merged since rev. 8: the accept/notify server half (#57), the decision UI (#61 bar, #79/#84 drawer), the review server and UI (M19, #78–#85), and the portal task runtime (M25, #88). The **50-concurrent load run is done** (#73/#75): 50/50 `200 ok`, p95 27703 ms, zero duplicate codes, recorded in `DECISIONS.md`. **Closed at rev. 13** (`docs/evidence/rev13-deployed-run.md`): the deployed accept→notify→email round-trip (§5, one `submission_accepted` row, real Resend id, idempotent second press), a deployed reviewer scoring pass (§7, 3/3 agreement with the hand-computed average), and a deployed portal task completion (§6, browser presign→PUT→finalize through `portal-tasks.spec.ts` in both full suite runs). Missing: a single combined judge-script cold run (R4 exit item) — the current baseline is version `3f42f894` from merge `7b9cf3a`, smoke green *(historical: version `1da1951d` from `673eac6` at rev. 9/10)* |
| CP3 — full judged feature surface | **PARTIAL, rev. 13** | **Proven deployed:** portal upload/task (evidence §6), embed framing/cacheability/parity across all five public widgets (evidence §1e, four green describe blocks), and assisted scheduling with conflict detection (M54's auto-place, evidence §1f, deterministic preview + one applied `moveSession` row + a useful blacked-out-speaker reason, surviving reload). **Not attempted:** manual drag-and-drop placement's own deployed pass (M30, subordinate per §6), ICS invite dispatch/cancellation-replay lifecycle beyond the itinerary's selected-session export, reminder scan (M36), and the tracking dashboard's judged count-change proof (M38) |
| CP4 — feature freeze/release proof | **PARTIAL, rev. 13** | **Nine** e2e specs exist (not six — every doc naming "six specs" is corrected in this revision) and six of the nine ran clean on the deployed preview in the rev. 13 run; M50/M51/M52 remain unverified (Findings 1 and 4, `needs_owner` item 4 in the evidence file) rather than red-for-cause. The 50-concurrent load/perf record is done (`DECISIONS.md`). **Not attempted:** post-deploy smoke *on production* (only the preview has been exercised), a security review, `docs/spend/`, and the submission checklist's production-only items |

A daily claim may now say **end to end on the deployed preview** for the CFP submit path, email delivery, review scoring, accept→notify→email, portal task completion, browser R2 upload, all five public widgets/embeds, and assisted agenda placement. It may not yet say it for review-reminder dispatch (Finding 1), the M51/M52 deployed reruns, or anything production.

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
5. ~~A delivered-message `Authentication-Results` record with `dmarc=pass`.~~ **Done at rev. 9:**
   a preview probe delivered to Gmail with `dmarc=pass (p=NONE)` and aligned SPF/DKIM identities,
   recorded in `DECISIONS.md` (Sun Aug 9, 14:13 PT).

**Exit:** items 1–4 above.

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

Rev. 12 reconciliation: PR #95 (§2g) landed the whole P4 commercial chain (M42–M45/M47/M49) plus
M55's CRM core under explicit owner authorization, fixed the last five deployed e2e failures and
the embed-cache regression, and finished M50/M52 down to their deployed-evidence remainders —
six additive migrations (`0009`–`0014`) applied to `sb-dev`/`sb-test` after the batch-transaction
fix. Two queues remain:

- **Deployed verification queue (do this first — nothing above is `DONE` without it):** redeploy
  the preview from the merged tree (migrations `0009`–`0014` applied); run post-deploy smoke; run
  the **full Playwright suite** against the redeployed preview — this is in flight. Then the
  deployed demonstration queue, now including the **M42 S4 redo** (a deployed Better Auth
  sign-in round-trip, including Google, and the deployed revocation proof) alongside the
  carried-forward deployed 429 rate-limit and CSP/HSTS header checks (P3-SEC), plus every
  deployed demonstration this queue has carried since rev. 9–11 (accept→notify→email, reviewer
  scoring, portal task completion, browser R2 upload, builder authoring AC, a blind review round,
  a speaker CSV import/invite/bulk-send round trip, a ZIP export download, all five public
  widgets, an assisted-placement apply); then the external email evidence (Resend bounce/
  complaint webhook, List-Unsubscribe headers, CAN-SPAM footer, all against a real inbox); then
  production provisioning (Google OAuth redirect URI, `wrangler secret put` for
  `BILLING_WEBHOOK_SECRET`/`UNSUBSCRIBE_SECRET`/Google credentials, `sb-prod` migration).
- **Code queue:** M50/M52/M55 deployed-evidence remainders only (no further code — see their
  module headers and §2g); P6 (M56–M60) is not started.

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
  `submission_received` and `portal_login` from the deployed preview. Proven at rev. 9: the
  delta #17 header gate — `dmarc=pass` with aligned identities (`DECISIONS.md`; the published
  policy is `p=NONE`, and tightening it is optional hardening, not a gate). Still pending: an
  Outlook probe, calendar-invite delivery evidence, a production API key, and bounce handling.
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
same work as R2/R3, starting with §6's next actions). Once R3 is green, M50–M53 may run in parallel;
M54 follows M30 and M51's structured speaker-availability query, and M10's final release sign-off
waits for M50–M54's deployed browser AC.
