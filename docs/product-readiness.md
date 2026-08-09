# Product readiness: gaps between the current build and a sellable product

**Date:** Aug 9, 2026 · **Baseline:** `main` after PR #52 · **Goal reframed:** the plan optimizes
for a judged hackathon demo; this document assesses the same work against a different bar — a
product a conference organizer would pay for.

The one-line verdict: **there are two products in this repo.** The engine layer — schema, auth,
submit pipeline, outbox dispatcher, R2 storage — is genuinely production-shaped and better than
most early SaaS codebases. The surface layer — most of the admin UI and all of the public pages —
still renders from a localStorage demo adapter, and the plan's own cut lines removed things a
buyer treats as table stakes. The gap is not quality; it is wiring, proof, and commercial scope
that was never planned.

---

## 1. What is going well (protect these)

These are real assets. They were built under deadline pressure and are still the right
foundations for a commercial product — do not rebuild them, finish on top of them.

- **Tenant isolation by construction.** Every table carries `event_id NOT NULL` and composite
  FKs (`FOREIGN KEY (form_id, event_id) REFERENCES forms(id, event_id)`), so a child row
  physically cannot reference a parent in another event (`drizzle/0000_init.sql`). This is a
  stronger isolation guarantee than most shipping SaaS products have, and it is exactly the
  discipline that makes adding an organization layer later tractable.
- **The comms engine** (`src/features/comms/server/dispatcher.ts`): `FOR UPDATE SKIP LOCKED`
  claiming, exponential backoff, terminal-failure dead-lettering, double-layer idempotency
  (unique key in `communication_logs` plus Resend `Idempotency-Key`), pre-send freshness
  re-checks, AES-GCM sealed secrets zeroed after dispatch, credential redaction in stored HTML.
  This is the most production-shaped subsystem in the repo.
- **Auth mechanics** (`src/features/auth/server/`): PBKDF2 with constant-time compare and a
  dummy-hash enumeration defense, DB-backed login throttle, single-use hashed OTP/magic-link
  tokens with attempt caps, durable portal sessions, audited impersonation.
- **The submit pipeline** (`src/features/forms/server/submit.ts` →
  `src/features/submissions/server/mutations.ts`): transactional, snapshot-pinned, with
  structural-drift detection (`FORM_VERSION_STALE`), routing rules, and SESS code allocation.
- **Fail-closed environment validation** (`src/shared/lib/env.ts`): production cannot boot with
  `TEST_AUTH`, a weak secret, a non-send email mode, or an email allowlist. Config errors
  surface as `INTERNAL`, never as user-facing validation errors.
- **Engineering process**: CI-enforced invariant greps (single sanitizer, single time API,
  single-writer rules), ~280 real unit/PGlite integration tests over the pure core and SQL
  invariants, a deploy pipeline with protected environments and a mandatory `--strict`
  post-deploy smoke, and an honesty culture (README "Honest status", `plan/status.md` evidence
  labels) that made this audit possible.

**Keep the invariants, keep the schema, keep the single-writer discipline.** They read as
hackathon bureaucracy but they are the product's real moat against the bug classes that kill
small SaaS teams.

---

## 2. Gap tier 1 — the demo-adapter debt (biggest, already known, half-done)

The decisive mechanic: `src/app/layout.tsx` mounts `DemoProvider` (localStorage store) globally.
A surface is real only if it branches on the server path; otherwise it renders browser fixtures
forever — including on the deployed preview.

**Server-backed today:** auth (admin + portal), dashboard, abstracts reads, public CFP
submit/draft, R2 routes, email dispatcher, `/api/v1` schedule + speakers, portal
home/submissions/detail.

**Still demo-only:** events index/settings, form builder, evaluation/scoring, agenda,
communications admin, speakers/tasks/resources admin, embeds admin, portal
profile/tasks/resources — and, notably, **the public schedule and speaker pages themselves**
(`src/features/public/public-schedule.tsx` is `"use client"` + `useDemo()`, so the deployed
public page renders localStorage). The failing `s-maxage=60` smoke assertion is a separate,
narrower issue: the cache fix (`revalidate = 60` + `generateStaticParams`) is already merged in
PRs #26/#44 and needs only a redeploy plus header evidence — it does not depend on the
public-page database rewrite.

**Missing outright (not demo, not server — absent):**

- The decision loop: no accept/decline/waitlist mutation, no `notifyDecisions`. The functions
  are named in comments (`src/db/client.ts:46`) but do not exist. The core organizer action —
  decide and notify — cannot happen against the database.
- Task completion runtime (`completeTaskViaResponse` / `completeTaskViaUpload`), session CRUD
  and `moveSession`, event creation (button disabled), form authoring writes (the builder never
  touches the DB — forms exist only via seed).
- No UI calls the R2 upload routes; the presign/finalize machinery is complete and untested by
  any real user path.
- 4 of 8 seed bodies are stubs (contacts, submissions, agenda, evaluation), so a freshly seeded
  DB shows an empty abstracts table, empty dashboard, empty public API.
- All 22 Playwright e2e tests skip: every module in `e2e/helpers/landed.ts` is `landed: false`.

This tier is the long pole and it is pure execution — the server layer beneath most of these
surfaces already exists and is tested. The plan already knows this; `plan/status.md` calls it
STACK-DEMO / SERVER-GAP. What the ledger understates is progress: it was last revised at PR #24
and `main` is at PR #52 (~8,600 lines later — submit pipeline, abstracts, portal, CFP wizard,
ICS, dashboard all landed since). **First action: re-audit and update the ledger, because the
team is steering on stale instruments.**

## 3. Gap tier 2 — unproven externals

Per the repo's own evidence rules, code that hasn't been demonstrated against the real service
doesn't count. Still unproven:

- **Email deliverability — the single biggest product risk.** Resend integration is written and
  wired, but nothing has ever been delivered: no verified sending domain, no SPF/DKIM/DMARC, no
  Gmail/Outlook evidence. A speaker-communications product with unproven deliverability is
  unsellable. `plan/status.md` §7 says this itself.
- A deployed admin sign-in (bootstrap only became runnable in PR #21), a browser R2
  presign/PUT/CORS round-trip, the interactive-transaction load test, a green `Deploy` workflow
  run (all runs so far skipped; preview was deployed by hand), and the 31 unchecked provisioning
  items including all production secrets.

## 4. Gap tier 3 — commercial scope the plan never contained

These are absent by explicit decision (`PLAN.md` §1 never-build list, §9 cut lines), which was
correct for the deadline and wrong for a product:

| Area | State | What a sellable product needs |
| --- | --- | --- |
| Org tenancy | Absent (never-build) | `organizations` above `events`; the composite-FK discipline makes this a bounded change, and **billing is blocked behind it** |
| User management | Absent | Signup, password reset, team invitations, role management UI. Today admins come from a CLI script with two hardcoded emails; admin JWTs have no revocation (`admin_sessions` table exists, unused) |
| Self-serve onboarding | Absent | Event creation (disabled button today), provisioning that isn't a 305-line manual runbook |
| Billing | Absent (confirmed zero) | Plans/entitlements/metering — from scratch, after tenancy |
| Email compliance | Partial | Bounce/complaint webhook + suppression list (a hard-bounced address is retried forever), `List-Unsubscribe` headers (Gmail/Yahoo bulk rules), CAN-SPAM physical address, unsubscribe beyond the single `task_reminder` template; stop signing 365-day unsubscribe JWTs with `SESSION_SECRET` |
| Data lifecycle / GDPR | Absent | Export, deletion/erasure, retention (rendered email bodies with PII grow unbounded), the missing `cleanupOrphans` R2 sweep (cron stub calls a function that doesn't exist), privacy policy/ToS/DPA |
| Observability | Thin | Error tracking + alerting (Sentry was never-build; nothing pages anyone), backup/restore runbook, rollback story |
| Security hardening | Partial | CSRF tokens or origin checks (only `sameSite: lax` today), security headers (no CSP/HSTS), rate limiting beyond the two login paths (public submit and `/api/v1` are unlimited), remove `TEST_AUTH=1` from the publicly reachable preview (`wrangler.jsonc:40` — passwordless admin for any known email) |

## 5. Gap tier 4 — demo-expedient decisions to revisit

Recorded in `PLAN.md` resolutions and `DECISIONS.md`; each was right for the demo and should be
a deliberate product decision now:

- **Auto-confirm on accept** (res. #15): speakers never actually confirm; publication, invites,
  and task fan-out all hang off a status the speaker never set. A real confirm CTA is needed.
- **Decision emails to primary contact only**; co-speakers learn via the portal.
- **The auth fallback is now the shipping auth** — fine mechanically, but there is no path to
  SSO/OAuth/MFA/reset, which mid-market conference buyers ask about early.
- **"Never bump" version pins** and **Workers Free constraints as architecture** (bundle gates,
  no charts lib, 50-emails/min sequential outbox ceiling — a 2,000-recipient decision blast
  takes 40 minutes). Move to paid plan assumptions and a real cost model.
- **Hand-authored SQL migrations with generation disabled**: the Drizzle TS schema does not
  model the composite FKs/views/triggers, so schema and SQL can silently drift.
- **Cut lines that are buyer table stakes**, currently cut or at risk: speaker edit-until-close,
  server-side drafts, drag-and-drop scheduling, week/track/room views, keyed API, reminder
  ladder, impersonation/event-switcher. Reclassify §9 from same-day amputation triggers to a
  roadmap.
- **Demo scaffolding to delete before any customer sees the repo or app**: committed demo
  credentials and fixed OTP `424242` in `docs/demo-script.md`, `EMAIL_FALLBACK_UI`,
  `/api/test/login`, the 34 MB `Requirements.odt`, `docs/spend/` ceremony.
- **A free backlog already specced** in `plan/analysis/*` but never modularized — highest-value:
  honoring `contacts.unsubscribed_at` fleet-wide (the column exists; nothing reads it), an
  organizer view + CSV export of portal-form responses (flagged "obviously needed" in the
  analysis itself), bulk segmented sends with preview, and white-labeling.

---

## 6. Where to spend effort

1. **Finish the wiring, in dependency order** (largest block, pure execution): decision
   mutations + `notifyDecisions` → the four seed bodies → form builder writes + event creation →
   agenda/sessions server → portal tasks/profile + upload UI → comms admin over the real log →
   public pages onto `published_*` views (which also fixes the failing cache assertion). Flip
   each module's e2e gate as it lands.
2. **Prove email end-to-end this week**: domain, SPF/DKIM/DMARC, one delivered Gmail/Outlook
   OTP and decision email. Everything downstream (portal login, notify, invites, reminders)
   depends on it, and it has the longest external lead time.
3. **Close the trust gaps cheaply and now**: remove `TEST_AUTH` from preview, add security
   headers and submit-path rate limits, wire a Resend bounce webhook, extend unsubscribe
   handling fleet-wide, add Sentry (the `AppError`/logger seam makes this ~one file).
4. **Then the commercial layer, in order**: org tenancy → signup/reset/invites → self-serve
   event creation → billing. Do not start billing before tenancy.
5. **Update `plan/status.md`** and keep the evidence discipline — it is the best process asset
   here; it just needs to reflect PRs #25–#52.

What *not* to spend effort on yet: Airtable export, embed configurator polish, week/track/room
views, dashboard extras, AI review — all still correctly below the line until the loop above is
closed.
