# openboard — product roadmap

**Created:** Aug 9, 2026 (status rev. 7) · **Companion audit:** [`../docs/product-readiness.md`](../docs/product-readiness.md)

This document extends the plan beyond the judged bar toward a sellable product. It does not
change `PLAN.md`'s frozen contracts, invariants, or single-writer rules — those are product
assets and stay binding. It does two things `PLAN.md` deliberately did not: it reclassifies the
§9 cut lines from same-day amputation triggers into roadmap items, and it adds the commercial
scope (`M42+`) that was on the never-build list for the hackathon.

Precedence: while the recovery gates in [`status.md`](status.md) §5 are open, they order all
work. This roadmap's Phase P1 is intentionally the same work as R2/R3 — closing the demo-adapter
debt serves both bars at once.

---

## Phase P1 — close the wiring debt (same work as R2/R3)

The server layer largely exists and is tested; most remaining work is wiring surfaces to it, in
dependency order:

1. **Decision loop first**: the accept/decline/waitlist mutations and `notifyDecisions`
   (M18 completion) — the core organizer action, currently existing only as comments in
   `src/db/client.ts`.
2. The four stub seed bodies (contacts, submissions, agenda, evaluation) so a fresh database is
   demonstrably non-empty.
3. Form-builder DB writes and event creation (M11/M12 completion) — today forms exist only via
   seed and the "New event" button is disabled.
4. Agenda/sessions server (M28 + `moveSession`), portal task runtime (M25) and profile writes,
   upload UI onto the already-complete R2 routes (M07's missing consumer).
5. Evaluation/scoring server (M19), comms admin over the real `listLog` (M37 minimum).
6. Public schedule/speakers/embeds onto the `published_*` views (M32/M33) — replacing the
   `useDemo()` client components. (The failing cache-header smoke assertion is a separate item:
   its fix is already merged in PRs #26/#44 and needs only a redeploy plus header evidence.)
7. Flip each module's gate in `e2e/helpers/landed.ts` as it lands; the specs are already written.

## Phase P2 — external proof

- **Email end-to-end, first and urgently**: verified sending subdomain, SPF/DKIM/DMARC, one
  delivered Gmail and Outlook OTP + decision email, evidence recorded in `DECISIONS.md`. Longest
  external lead time; everything customer-visible depends on it.
- Deployed admin sign-in round-trip; browser R2 presign/PUT/CORS; a green `Deploy` workflow run;
  the 50-concurrent load test; the remaining provisioning checklist.

## Phase P3 — trust and compliance (cheap, do alongside P1/P2)

- Disable `TEST_AUTH` on the preview, or network-restrict the preview — a **release gate before
  any customer-facing or non-demo deployment**, not a data-dependent cleanup (the route mints an
  admin session for any known email regardless of what data is behind it); delete the committed
  demo credentials and fixed OTP from `docs/demo-script.md` before any customer sees the repo.
- Security headers (CSP, HSTS, referrer policy), origin checks or CSRF tokens on state-changing
  routes, rate limits on the public submit path and `/api/v1`.
- Resend bounce/complaint webhook + a suppression status in `COMM_STATUSES`; `List-Unsubscribe`
  headers; a CAN-SPAM physical-address slot on `events`; honor `contacts.unsubscribed_at`
  fleet-wide (the column exists; nothing reads it beyond `task_reminder`).
- Error tracking + alerting (the `AppError`/logger seam makes Sentry roughly a one-file change);
  a backup/restore and rollback runbook; implement the missing `cleanupOrphans` R2 sweep the
  cleanup cron already points at.

## Phase P4 — the commercial layer (new modules)

Strictly ordered; do not start a later module before its predecessor's schema lands.

| ID | Module | Scope sketch | Depends on |
|---|---|---|---|
| M42 | Product auth: Better Auth + Google | Replace the jose/PBKDF2 fallback for admin auth with Better Auth (Drizzle adapter) with email+password **and Google as a social provider**; server-side revocable sessions (finally using an `admin_sessions`-shaped store); password reset + email verification through the existing outbox. Portal OTP/magic-link stays on the custom, tested implementation for now; migrating it onto Better Auth's magic-link plugin is a later, optional step. See `DECISIONS.md`, "Product auth direction". | P2's deployed-auth proof |
| M43 | Organization tenancy | `organizations` above `events`, membership + roles, the composite-FK chain extended one level. The existing event-scoping discipline makes this bounded rather than a rewrite. | M42 |
| M44 | User management | Self-serve signup, team invitations (through the outbox), role management UI, admin session/audit views. | M42, M43 |
| M45 | Self-serve onboarding | Event creation flow (un-disabling M11's button is the last step, not the first), guided setup replacing the manual provisioning runbook. | M43, M44 |
| M46 | Email compliance & deliverability ops | P3's comms items productized: suppression list UI, per-domain reputation visibility, bulk segmented sends with preview (from the analysis backlog), unsubscribe tokens signed with a dedicated key rather than `SESSION_SECRET`. | P2 email proof |
| M47 | Data lifecycle & GDPR | Contact/org data export, right-to-erasure, retention jobs for tokens/sessions/rendered email bodies, privacy policy/ToS/DPA docs. | M43 |
| M48 | Observability & ops | Alerting thresholds, uptime checks against `/api/health`, Neon PITR/restore rehearsal, R2 lifecycle rules. | — (start anytime) |
| M49 | Billing | Plans/entitlements/metering hung off `organizations`. **Blocked on M43 by construction** — there is nowhere to attach a plan today. | M43, M44 |

Also promoted from the analysis-docs backlog (specced, never modularized, high buyer value):
organizer view + CSV export of portal-form responses; speaker confirm CTA (replacing
resolution 15's auto-confirm — publication, invites, and task fan-out currently hang off a
status the speaker never set); white-labeling; the §9 cut-line features that are buyer table stakes
(edit-until-close, server-side drafts, drag-and-drop scheduling, reminder ladder, keyed API).

## Explicitly still deferred

Airtable export, embed configurator polish, week/track/room views, dashboard extras, AI review —
below the line until P1/P2 close.

## Tooling and library adoptions

The current dependency list is deliberately lean and most hand-rolled choices (ICS builder,
sanitizer profiles, `aws4fetch`, raw `fetch` to Resend, `env.ts` validation) are better than
their library alternatives — they stay. What we adopt, by phase:

**Adopt during P1–P3:**

- **`@sentry/cloudflare`** — error tracking with grouping/alerting/releases; the
  `AppError`/logger seam makes it a near one-file add. Check `pnpm worker:size` after adding.
- **`@cloudflare/vitest-pool-workers`** — run the auth (Web Crypto), R2 signing, and dispatcher
  suites inside workerd instead of Node, closing the "proven on PGlite, unproven on Workers"
  runtime gap.
- **`@testing-library/react` + `happy-dom`** — the vitest environment is `node` and there are
  zero component tests today; P1 is almost entirely UI wiring, exactly where regressions will
  land.
- **Cloudflare native rate-limiting bindings / WAF rules** (not an npm dependency) for the
  public submit path and `/api/v1`. CSRF likewise stays a small origin check in `defineHandler`
  rather than a library.
- **Cloudflare Queues** for email dispatch: keep the outbox table and idempotency unchanged, let
  the cron scan and a queue consumer send with concurrency — removes the ~50 emails/minute
  sequential ceiling. Requires the paid Workers plan, which the product needs anyway.

**Adopt when the phase lands:**

- **`stripe`** (fetch HTTP client) — M49 only; nothing to do before the org layer exists.
- **Charts** — when the Workers-Free bundle rule relaxes, prefer something small (Observable
  Plot or uPlot) over heavyweight chart libraries.
- **`next-intl`** — only if selling into non-English markets becomes real.

**Future possibilities (noted, not adopted):**

- **Hyperdrive** — if P2's load test shows the per-transaction WebSocket `Pool` handshake cost
  matters, Hyperdrive pooling is the fix; not before the data says so.
- **Atlas** — schema-diff tooling that models the composite FKs/views/triggers drizzle-kit
  cannot, addressing the hand-authored-SQL drift risk recorded in `DECISIONS.md` ("Migration
  authorship"). Revisit when migration volume grows.

**Deliberately not adopting:** react-email (templates are DB-stored and organizer-editable — a
JSX email framework doesn't fit), the AWS SDK, Prisma, NextAuth (Better Auth decided), axios /
lodash / moment-class utilities. TanStack Table and Query are already present — the abstracts
pagination gap is wiring, not a missing library.

---

## The product auth decision (M42 detail)

**Question:** Google Auth or Better Auth? **Answer: both, in one move — Better Auth as the
framework, Google as a social provider inside it.** They are not alternatives: "Sign in with
Google" alone is not a product auth story (organizers not on Google Workspace are locked out;
you still need password reset, email verification, revocation, and eventually SSO/MFA answers),
while Better Auth without Google forfeits the lowest-friction signup path. Better Auth provides
both, plus the pieces the readiness audit flagged as absent: server-side revocable sessions,
reset/verification flows, and organization + admin plugins that line up with M43/M44 rather than
needing bespoke builds.

**Why this is now viable when the S4 spike wasn't:** S4 never got a credential-backed deployed
verdict under the hackathon clock, so M06a adopted the jose/PBKDF2 fallback. The ecosystem has
since matured — Better Auth supports Postgres via the Drizzle adapter and has maintained
Cloudflare Workers/OpenNext integration paths with working examples. The fallback was a deadline
decision, not a compatibility verdict.

**Guardrails carried over from the repo's own evidence culture:**

1. The jose/PBKDF2 fallback **remains the shipping auth until a deployed Better Auth round-trip
   is proven** on the preview (S4 redone properly), including a `pnpm worker:size` check — the
   bundle budget currently sits at ~1.3 MiB of 3 MiB.
2. Existing PBKDF2 password hashes migrate via Better Auth's custom password-hashing hooks (no
   forced resets).
3. Do not enable `cookieCache` together with `secondaryStorage` — a known open bug treats an
   expired cookie cache as a logout instead of refreshing from storage.
4. `requireAdmin(eventId, role?)` stays the frozen, implementation-neutral contract; the swap
   happens behind the auth barrel exactly as `DECISIONS.md` planned for.
5. Portal speaker auth (OTP/magic link) is custom, tested, and working — it does not move in
   M42.

**M42 acceptance criteria:**

1. Legacy `users.password_hash` PBKDF2 credentials are detected and verified through Better
   Auth's custom password-hashing hooks, and rehashed to the new scheme on first successful
   sign-in — no forced resets, no orphaned accounts.
2. Existing `users` and `event_members` rows are preserved, and `requireAdmin(eventId, role?)`
   returns identical authorization decisions before and after the swap, including role ranking
   and the per-path role derivation.
3. Admin sessions move to a revocable server-side store that is fully isolated from
   `portal_sessions` and the portal token tables; portal auth behavior is unchanged.
4. Sign-out and admin-driven revocation invalidate sessions server-side, demonstrated on the
   deployed preview (a revoked session cannot reach an admin route).
