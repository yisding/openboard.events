# openboard — implementation status and recovery plan

- **Snapshot:** rev. 11 — Mon Aug 10, 2026. **PR #94 merged** (§2f): the P3→P5 roadmap run landed P3 compliance hardening (CSP/HSTS on every non-embed path, a CSRF origin-check chokepoint inside `defineHandler`, and DB-backed rate limits via `drizzle/0005_rate_limits.sql`), email compliance (a signature-verified Resend bounce/complaint webhook, List-Unsubscribe headers, suppression enforcement via `drizzle/0007_email_compliance.sql`), R2 orphan sweep + backup/rollback/PITR runbooks, the forms debt cleared (M12 generalized to `context='portal'`, M13b's rules UI mounted live in the builder, M14's `upsertDraft` open-check gap closed, M24 built on the generalized engine), e2e spec fixes (three real triaged SPEC-BUGs) plus the app fixes they exposed (admin-shell/portal-context demo-store 404s, a trailing-autosave 404), and the P5 product-completeness modules M50 (partial), M51, M52 (partial), M53, M54 — landing five additive migrations, `drizzle/0004`–`0008`, applied to `sb-dev`/`sb-test`. M42–M49 remain blocked pending explicit owner re-authorization of the M42 hold (the Better Auth spike); M55 stays blocked on tenancy (M43/M44). No module is `DONE` yet under §1's rules: the deployed/browser AC queue is now the entire remaining surface.
- **Rev. 10 headline (unchanged):** **the module-completion run landed** (§2e): a 45-agent orchestrated run implemented every code-completable remaining module — 16 complete, M13b/M14 partial, M24 blocked on an M12 scope contradiction — then merged the Jade+Ice palette (#92) and P6 plan (#91) from `main`, adapted all new surfaces to the `--accent` token family, and passed the full gate suite. All six e2e specs had real step bodies and all 17 `landed.ts` gates were flipped at that point.
- **Rev. 7 headline (unchanged):** **The Saturday thin slice is green on the deployed preview** — a proposal submitted through the real CFP endpoint landed in Neon with its routing applied, and its confirmation email was delivered to a real Gmail inbox from the verified sending domain. The deployment evidence in §2a is from that deployment, not from PGlite.
- **Baseline:** `main` at `c662345` (PR #94), **and the preview is deployed from it**: version `b1fdc14a` at `https://sb-web-preview.yi-ding.workers.dev` (2299 KiB gzip — inside the Workers Free budget but nearing the 2.5 MB warn line; `/api/health` returns `sha: c662345`, a live Neon `18.4` round-trip, and M48's comms-depth fields). Migrations `0000`–`0008` are applied to `sb-dev`/`sb-test`; the full demo world is seeded on `sb-test`. All 8 post-deploy smoke checks pass, zero skipped (M53 surface map). The deployed Playwright suite stands at **19 passed / 5 failed / 5 skipped** (§2f).
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

## 3. Module status by evidence

No module is `DONE` as of this snapshot. As of rev. 9 no module is `PR-OPEN` — every open agent
branch has merged — so what separates the merged modules from `DONE` is AC sign-off and deployed
evidence, not merges.

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
| CP0 — deployed skeleton and existential spikes | **GREEN except the R2 browser probe and auth-throttle proof** | Preview URL live; real Neon round-trip; bundle inside the Free budget; jobs tick; embed `frame-ancestors` proven by curl; **edge cacheability proven** (`s-maxage`, `x-nextjs-cache: HIT`); **the delta #17 header gate passed at rev. 9** — `dmarc=pass` with aligned SPF/DKIM identities on a Gmail delivery (`DECISIONS.md`, Sun Aug 9). Missing: a browser R2 presign/CORS upload and a deployed application auth-throttle proof |
| CP1 — contracts/schema/foundation freeze | **NEARLY GREEN** | Contracts merged; the stack merged; migrations applied to `sb-dev` and `sb-test` **from the repo's own SQL**; seed loads; **admin login works on the deployed preview**; the six-spec Playwright skeleton runs; **the freeze declaration is now recorded in `DECISIONS.md`** (rev. 8). Missing: `sb-prod` and a green `Deploy` workflow run |
| **Sat thin slice — CFP to Abstracts** | **GREEN on the server path** | A deployed submit stored a submission with routing applied and delivered its confirmation email. The Abstracts *table* reads the database; its drawer and bulk actions do not yet |
| CP2 — golden spine | **PARTIAL — every server/UI half is now merged; what is missing is deployed proof** | Green: real OTP, submit, one **delivered** email, public schedule and gallery. Merged since rev. 8: the accept/notify server half (#57), the decision UI (#61 bar, #79/#84 drawer), the review server and UI (M19, #78–#85), and the portal task runtime (M25, #88). The **50-concurrent load run is done** (#73/#75): 50/50 `200 ok`, p95 27703 ms, zero duplicate codes, recorded in `DECISIONS.md`. Missing: the deployed accept→notify→email round-trip, a deployed reviewer scoring pass, a deployed portal task completion, and the golden-path Playwright spec — the redeploy that blocked them is **done** (version `1da1951d` from `673eac6`, smoke green with zero skips) |
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

Rev. 11 reconciliation: PR #94 (§2f) landed P3 compliance hardening, closed the forms debt
(M12/M13b/M14/M24), triaged and fixed the e2e/app-bug backlog, and implemented the P5
product-completeness modules with five additive migrations (`0004`–`0008`) applied to
`sb-dev`/`sb-test`. Two queues remain, and neither is code-empty this time:

- **Deployed verification queue (do this first — nothing above is `DONE` without it):**
  redeploy the preview from the merged tree (migrations `0004`–`0008` applied); run post-deploy
  smoke; run the **full Playwright suite** against the redeployed preview (the six original specs
  plus the new `review-operations.spec.ts`, `speaker-content-ops.spec.ts`, and the
  `agenda-schedule.spec.ts` 'assisted placement' block — all written with real step bodies but
  gated `landed:false` — flipping each `landed.ts` gate only once green; M53's owned
  `public-widgets-parity.spec.ts` was never written and still needs authoring); the deployed 429
  rate-limit, CSP/HSTS header, and Resend bounce/complaint webhook checks P3-SEC/P3-EMAIL still
  need; then the deployed demonstrations this queue has carried since rev. 9–10
  (accept→notify→email, reviewer scoring, portal task completion, browser R2 upload, builder
  authoring AC) plus the new P5 ones (a blind review round, a speaker CSV import/invite/bulk-send
  round trip, a ZIP export download, all five public widgets, and an assisted-placement apply).
- **Code queue:** M50's and M52's partial remainders (see their module headers); the E2E/app-fix
  leftovers each triage stage flagged as borderline (`submitCfpForm`'s stale-draft
  retry-idempotency shortcut, the central Files list's client-side-only filtering); and the
  M42 (Better Auth) chain — M42 itself, then M43/M44/M45/M47/M49, then M55 — once the owner
  explicitly re-authorizes another attempt at the M42 spike.

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
