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

1. **Decision loop UI first**: M17's drawer and bulk actions onto the merged `transitionStatus`
   / `notifyQueues` routes (#57 landed the server half) — the core organizer action, now one UI
   away.
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

Ledger rev. 7 already proved the deployed thin slice: real OTP, deployed submit with routing,
admin sign-in, edge-cached public schedule, and **Gmail delivery from the verified
`mail.openboard.events` subdomain** (SPF/DKIM aligned). What remains:

- The rest of the email track: Outlook probe, calendar-invite delivery, DMARC confirmation, a
  production sending key — and, product-side, bounce/complaint handling (P3/M46).
- Browser R2 presign/PUT/CORS round-trip (needs a seeded headshot → `contacts.ts`); a green
  `Deploy` workflow run (deploys are still a laptop operation); the 50-concurrent load test; the
  production half of the provisioning checklist.

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

## Sequencing evaluation: front-load the long tails (added at rev. 8)

The gate/phase ordering above is correct for its own logic — decision UI first, then seeds,
then surfaces — and status §6's queue (M17 drawer → `contacts.ts` → M12 builder) is the right
critical path for the judged bar. The correction this section makes is different: several items
currently parked in "later" phases have **long external tails or compounding costs**, and a
strictly sequential P1→P4 reading would start them too late. They are cheap to *start* and
expensive to *discover late*, so they should run as a parallel slow-cooker lane beside P1,
ordered here by tail length × trickiness:

1. **The email deliverability tail** (external, weeks of calendar time; P2/M46). Gmail is
   proven; Outlook/Microsoft acceptance is notoriously slow and opaque, DMARC propagation takes
   days, a production sending domain needs reputation warm-up, and the bounce webhook needs
   real bounces to validate against. Every step is an hour of work followed by days of waiting —
   the definition of a task to start now and finish whenever.
2. **The Better Auth deployed spike** (unknown-risk gate for the whole P4 chain). M42–M44 and
   M49 all assume Better Auth works on workerd inside the bundle budget. A one-day spike — a
   deployed sign-in round-trip plus `pnpm worker:size` — converts that assumption into evidence
   while the auth surface is still small. If it fails, the fallback (keep jose, add OAuth
   directly) re-plans three modules; better to know before they are designed in detail.
3. **The org-tenancy schema decision** (M43; compounding). Every feature merged on single-event
   assumptions raises the migration cost. The UI and membership flows can wait, but the schema
   shape should not: an ADR plus an additive `organizations` table and nullable
   `events.organization_id` lands cheaply *now* under the additive-only migration rule, and
   turns M43 from a schema migration into a backfill.
4. **The 50-concurrent load test** (existential unknown, now unblocked). The deployed submit
   endpoint exists, so the test is runnable today. If Neon's per-transaction WebSocket `Pool`
   misbehaves under load, the documented fallback rewrites the `withTx` paths as CTEs — a
   rewrite whose cost grows with every new transaction path. An afternoon now bounds the risk.
5. **A green `Deploy` workflow run** (process tail). Every deploy so far is a laptop operation,
   and rev. 7's own findings (a rewritten migration silently not applying) are exactly the
   failure class a pipeline catches. One green run makes every subsequent deploy cheaper and
   safer; until then each deploy re-risks the same mistakes.
6. **The Workers Paid / Queues decision** (architecture fork; M46/M49 cost model). The
   sequential outbox caps at ~50 emails/minute; bulk sends and reminder fan-out will breach it.
   Moving dispatch to Cloudflare Queues changes the jobs architecture and requires the paid
   plan — decide the plan tier early so the dispatcher's successor can be designed once, not
   retrofitted.
7. **Schema-drift debt** (compounding; already bit once). The Drizzle TS schema cannot express
   the composite FKs/views/triggers, migrations are hand-authored, and rev. 7 found `sb-dev`/
   `sb-test` silently running an older schema while ~300 tests passed. Each new migration
   widens the gap. Cheap containment now: a CI step that diffs a PGlite-applied `drizzle/`
   against a schema dump, so drift fails a PR instead of a deploy (Atlas remains the future
   candidate for a real fix).
8. **e2e activation** (rot compounds). The six spec skeletons exist but their step bodies are
   placeholder stubs, so the gates in `e2e/helpers/landed.ts` rightly stay closed — flipping
   them over empty steps would falsely certify checkpoints. The activation work is implementing
   the step bodies for the modules with deployed proof (M15/M16/M17/M21/M34/M40 first), flipping
   each gate in the same change, then running the suite against the preview on every deploy.
9. **Retention/GDPR groundwork** (grows with data; M47). Full compliance waits for P4, but
   token/session/rendered-email retention jobs should land before the first real event's data
   accumulates — deleting a year of PII later is a project; a cron that trims from day one is a
   file.

What this explicitly does **not** change: the judged-bar critical path. Items 1–9 are
individually small starts (a spike, an ADR, a test run, a cron) that fit around the P1 wiring
work without displacing it.

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
