# Product readiness: gaps between the current build and a sellable product

**Date:** Aug 9, 2026 · **Baseline:** `main` after PR #55 (ledger rev. 7 — the deployed
thin-slice proof) · **Goal reframed:** the plan optimizes for a judged hackathon demo; this
document assesses the same work against a different bar — a product a conference organizer would
pay for.

The one-line verdict: **there are two products in this repo.** The engine layer — schema, auth,
submit pipeline, outbox dispatcher, R2 storage — is genuinely production-shaped and better than
most early SaaS codebases. The surface layer — most of the admin UI and all of the public pages —
still renders from a localStorage demo adapter, and the plan's own cut lines removed things a
buyer treats as table stakes. The gap is not quality; it is wiring, proof, and commercial scope
that was never planned.

> **Annotation, 2026-08-12 — §2's central finding is closed.** This is a dated audit and its
> findings are left as written. The one that has since been resolved is the biggest: the
> localStorage demo adapter is **deleted**. `src/app/layout.tsx` no longer mounts `DemoProvider`,
> `src/shared/demo/` is gone along with the `isCredentialFreeLocalDemo()` predicate, and every
> surface §2 lists under *Still demo-only* — events index/settings, form builder,
> evaluation/scoring, agenda, communications admin, speakers/tasks/resources admin, embeds admin,
> portal profile/tasks/resources, and the public schedule and speaker pages — now has exactly one
> data source: Postgres. The related "demo scaffolding to delete" bullet in §7 is partly done too:
> the committed demo credentials and the fixed OTP `424242` are gone from `docs/demo-script.md`
> and from the code, while `EMAIL_FALLBACK_UI`, `/api/test/login` and the 34 MB `Requirements.odt`
> remain (`docs/spend/` is already gone). Everything else below still stands on its own evidence.

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
public page renders localStorage). The cache-header issue is separate and now closed: the fix
merged in PRs #26/#44 and ledger rev. 7 records the deployed proof (`s-maxage`,
`x-nextjs-cache: HIT`) — it never depended on the public-page database rewrite.

**Missing outright (not demo, not server — absent):**

- The decision loop's remaining UI. *(Updated after PRs #57/#61:)* `transitionStatus` and
  `notifyQueues` exist behind organizer-auth routes with 11 PGlite cases, and #61 landed the
  abstracts decision bar (bulk queue/decide + a working Notify button). Still missing: the
  detail drawer, "notified ✓" row state, and a deployed accept→notify→email round-trip.
- Task completion runtime (`completeTaskViaResponse` / `completeTaskViaUpload`), session CRUD
  and `moveSession`, event creation (button disabled), form authoring writes (the builder never
  touches the DB — forms exist only via seed).
- No UI calls the R2 upload routes; the presign/finalize machinery is complete and untested by
  any real user path.
- 3 of 8 seed bodies are stubs (submissions, agenda, evaluation — contacts landed in #65 with
  real headshots), so a freshly seeded DB still shows an empty abstracts table and public
  schedule.
- All 22 Playwright e2e tests skip: every module in `e2e/helpers/landed.ts` is `landed: false`.

This tier is the long pole and it is pure execution — the server layer beneath most of these
surfaces already exists and is tested. The plan already knows this; `plan/status.md` calls it
STACK-DEMO / SERVER-GAP, and ledger rev. 7/8 now carries the per-module PR record for #25–#52
and the deployed thin-slice evidence, so the instruments are current again.

## 3. Gap tier 2 — unproven externals

Per the repo's own evidence rules, code that hasn't been demonstrated against the real service
doesn't count. Ledger rev. 7 retired the biggest items on this list: the deployed thin slice is
green (real OTP, deployed submit with routing into Neon), an admin was bootstrapped and signed
in on the preview, and — the one that mattered most — **email was actually delivered** to a real
Gmail inbox from the verified `mail.openboard.events` subdomain with SPF and DKIM aligned.

Still unproven:

- The rest of the email track: an Outlook probe, calendar-invite delivery, DMARC policy
  confirmation, a production API key, and any bounce/complaint handling.
- A browser R2 presign/PUT/CORS round-trip (blocked on a seeded headshot → `contacts.ts`), the
  50-concurrent load test, a green `Deploy` workflow run (all runs so far skipped; deploys are
  still a laptop operation), and the production half of the provisioning checklist — secrets,
  `sb-prod` migration, production health/cron.

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

1. **Finish the wiring, in dependency order** (largest block, pure execution): decision **UI**
   (M17 drawer + bulk actions onto #57's merged transition/notify routes) → the four seed
   bodies → form builder writes + event creation → agenda/sessions server → portal
   tasks/profile + upload UI → comms admin over the real log → public pages onto `published_*`
   views. Flip each module's e2e gate as it lands.
2. **Finish the email track**: Gmail delivery from the verified subdomain is proven (ledger
   rev. 7); still open are the Outlook probe, calendar-invite delivery, DMARC confirmation, a
   production sending key, and a bounce/complaint webhook. Deliverability groundwork has the
   longest external lead time, so keep it moving in parallel with the wiring.
3. **Close the trust gaps cheaply and now**: remove `TEST_AUTH` from preview, add security
   headers and submit-path rate limits, wire a Resend bounce webhook, extend unsubscribe
   handling fleet-wide, add Sentry (the `AppError`/logger seam makes this ~one file).
4. **Then the commercial layer, in order**: org tenancy → signup/reset/invites → self-serve
   event creation → billing. Do not start billing before tenancy.
5. **Keep the ledger's evidence discipline** — it is the best process asset here. Rev. 7/8 now
   reflect PRs #25–#52 and the deployed proof; keep every future claim cited the same way.

What *not* to spend effort on yet: Airtable export, embed configurator polish, week/track/room
views, dashboard extras, AI review — all still correctly below the line until the loop above is
closed.
