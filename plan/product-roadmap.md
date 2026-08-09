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
8. **e2e activation** (rot compounds). The gates in `e2e/helpers/landed.ts` are flipped for the
   modules with merged evidence as of rev. 8; from here, run the suite against the preview on
   every deploy and treat a failing unskipped step as signal, not noise. Specs that stay
   skipped while their surfaces evolve stop describing the product.
9. **Retention/GDPR groundwork** (grows with data; M47). Full compliance waits for P4, but
   token/session/rendered-email retention jobs should land before the first real event's data
   accumulates — deleting a year of PII later is a project; a cron that trims from day one is a
   file.

What this explicitly does **not** change: the judged-bar critical path. Items 1–9 are
individually small starts (a spike, an ADR, a test run, a cron) that fit around the P1 wiring
work without displacing it.

## Architecture & code-quality review recommendations (stacked on the rev. 8 evaluation)

A full-codebase review (schema/tooling, `src/shared`, `src/features`, `src/app` + API) confirms
the plan's own self-assessment — the server halves are rigorous, the demo adapter is the
dominant liability — but surfaced findings the corpus does not yet track. Every item below was
verified against the code on this branch; file references are current. Where a finding
strengthens an existing lane item, it says so instead of opening a new one.

### Fix now — small diffs, before any customer-facing deploy

These join P3's release-gate list; none is larger than an afternoon.

1. **Impersonation has no role check.** `createImpersonationLink`
   (`src/features/auth/server/portal.ts:268`) calls `requireAdmin(eventId)` with no role
   argument, so a **reviewer** can mint a 5-minute portal token for **any contact** and read
   their submissions and private files (`decideFileAccess` in `shared/server/r2.ts` grants every
   admin role full private-file access). Require `organizer`, and record the intended reviewer
   file-access policy while touching it.
2. **Page and API authorization disagree about reviewers.** `requiredRoleForEventPath`
   (`src/features/auth/server/admin.ts:28-32`) demands `organizer` for everything except
   `/events/{id}/review` — a page that does not exist — so reviewers get "Access denied" on
   every admin page (including Abstracts, whose own comment says "any member may read"), while
   the internal APIs (`api/internal/submissions/[eventId]/route.ts`) check membership with no
   role at all. Decide the reviewer surface once and align both layers; add a test that pins
   page-vs-API parity per role.
3. **Preview databases store live login credentials.** The dispatcher redacts magic-link/OTP
   values from persisted `body_rendered_html` only when `APP_ENV === "production"`
   (`src/features/comms/server/dispatcher.ts:58`). A preview with `EMAIL_MODE=send` both sends
   real email and stores unredacted 30-day single-use login links — one leaked row is an
   account takeover. Key redaction on `EMAIL_MODE === "send"` (or redact unconditionally); this
   belongs next to the existing `TEST_AUTH` preview release gate in P3.
4. **Per-address abuse on portal login.** `requestPortalLoginIn`
   (`src/features/auth/server/portal.ts:156`) calls `getOrCreateContact` before any gate, and
   the 3-per-10-min throttle is per **contact** — one IP can create unlimited contacts and fire
   an email per address. Add a per-IP cap (the admin login lockout table is the pattern to
   copy) ahead of the Cloudflare-native rate-limit adoption below.
5. **Unexpected 500s are unobservable.** `defineHandler` (`src/shared/server/handler.ts:70-84`)
   maps unknown errors to `INTERNAL` without ever logging message or stack — every production
   500 is a blind spot today. Log before mapping; this is the concrete reason the Sentry
   adoption item should not wait for "P1–P3 sometime".
6. **Verified small bugs**, each with a one-line fix:
   - `shared/ui/app/data-table.tsx:78` — `nullsLast` compares everything as strings with
     `{numeric: true}`, so `"4.5"` sorts before `"4.25"`; the Rating column mis-orders
     fractional averages (the very case the helper's comment cites).
   - `shared/ui/app/file-upload.tsx` — presign/finalize fetches are uncaught and fired with
     `void`; a network error is an unhandled rejection and the UI sticks on "Verifying…"
     forever. Wrap and surface an error phase.
   - `workers/jobs/index.ts:16-17` — the comment claims reminders and airtable "never share a
     tick", but %15 and %10-offset-5 collide at :15 and :45. Fix the modulus or the comment,
     and add an `AbortSignal` timeout to the dispatcher fetch while there (a hung origin
     currently holds the invocation until the platform kills it).
   - `src/app/submit/[eventSlug]/[formId]/done/page.tsx:5` — a missing query param fabricates
     confirmation code `"SESS-NEW"`; render "code unavailable" instead of a fake code.

### Sequencing amendment to P1: public pages should not be last

P1 item 6 wires public schedule/speakers/embeds onto the `published_*` views after everything
else. But these are the only surfaces where a **real** database currently shows **fixture**
data to the outside world: `/e/*/schedule`, `/e/*/speakers`, and `/embed/*` render `useDemo()`
client components with hard-coded Sep 15/16 tabs, so the public page and `/api/v1/.../schedule`
— two surfaces the code comments insist "cannot disagree" — disagree by construction, and the
`revalidate = 60` edge-cache story stays decorative until the page renders server data. The
embed-first positioning in `docs/user-flows.md` makes this the organizer's shop window, not a
trailing item. Recommendation: treat M32/M33 wiring as parallel-lane eligible (it has no
dependency on the decision-loop path) rather than sequenced behind items 1–5.

### Contain the demo fork while it drains

The demo adapter is not just unfinished wiring; it has already forked logic the architecture
forbids forking:

- `src/features/forms/cfp-wizard.tsx:152` contains a second, private `evaluateVisibility`,
  violating the "exactly one condition evaluator" invariant the CI greps exist to protect.
- `src/features/agenda/conflicts.ts:1` types its "real" logic against `@/shared/demo/types`.
- `shared/demo/types.ts` is a parallel domain model (untagged answer unions, unbranded ids,
  re-declared statuses) imported by ~30 feature files, so each surface swap is a semantic
  rewrite — plan surface estimates accordingly.

Cheap containment, same spirit as the schema-drift lane item: an ESLint `no-restricted-imports`
rule (not a grep — it can allowlist per-directory) that pins the current set of
`@/shared/demo` importers and fails on any **new** one, so the drain is monotonic; and a
one-off deletion of the duplicate evaluator in favor of `shared/lib/conditions.ts`.

### Consolidation debt — fold into P1 wiring as routes are touched

- **Three API error envelopes coexist**: `defineHandler`'s `{error:{code,message,fieldErrors}}`,
  v1's bare `{error:{code,message}}` (`api/v1/_lib.ts`), and hand-rolled try/catch in the four
  portal-auth routes plus `jsonRoute` in uploads (which its own comment admits is a
  duplicate). Converge on `defineHandler`'s shape as each route is next edited; also fix
  sign-in returning 401 "Invalid email or password" for malformed JSON (a 400).
- **`defineHandler` can't read params from the body**, so three routes rebuild a `NextRequest`
  with `eventId` smuggled into the query string
  (`api/internal/forms/[formId]/submit/route.ts:60-66`, `draft/route.ts`,
  `api/internal/portal/submissions/[id]/route.ts`). Add body-derived auth-param support to the
  framework and delete the three copies of the workaround.
- **Token hygiene**: every dispatch **attempt** mints a fresh 30-day magic-link token and
  365-day ICS token (`comms/server/context.ts:257`, `invites.ts:139`) with no revocation at
  issue — retries widen the set of live credentials. Mint once per logical notification (or
  revoke predecessors on re-issue), and fold token/session expiry into the retention lane item.
  Related fragility while in that file: `context.ts:256-258` builds `vars` by shallow-spread
  then **mutates the shared nested `portal` object** for the magic link to reach the result —
  any deep-copy refactor silently breaks every non-login email; make the link an explicit
  field.
- **The deadline-hour hot path fights its own lock.** `replaceAnswers`
  (`submissions/server/mutations.ts:137-149`) deletes-then-inserts one row per round trip and
  `notifyQueues` writes per-statement — inside transactions holding the event-row
  `FOR UPDATE` lock, over a per-transaction WebSocket `Pool` to Neon. Batch these into
  multi-row statements **before** running lane item 4's 50-concurrent load test, so the test
  measures the intended design rather than a known-fixable serialization.

### Smaller items, recorded so they don't rot

- Dead code sweep: `ensurePortalSession` (`auth/server/portal.ts:141`), `toPortalStatus`
  (`submissions/server/guards.ts:29`, zero call sites, re-implements
  `PORTAL_STATUS_LABEL`), the unused `ADD_REVIEW` reducer arm (`shared/demo/demo-provider.tsx`)
  whose semantics subtly differ from `UPSERT_REVIEW`, `QUERY_DEFAULTS`
  (`shared/lib/query-keys.ts`), and `CONDITION_OPERATORS` (`shared/contracts/enums.ts:70-73`).
- `shared/contracts/limits.ts:10-14` imports the `xss` runtime into the contracts layer (and
  the import sits below its use); move the check beside `lib/sanitize.ts`.
- `/api/health` publicly reports the Postgres server version and build SHA; drop the version.
- Deploy workflow: step-scope `CLOUDFLARE_API_TOKEN`/`DATABASE_URL_DIRECT` instead of job-level
  env, and pin CI's action tags to SHAs the way `deploy.yml` already does.
- Schema notes for the next additive migration: `submissions.form_version` has no FK to
  `form_versions(form_id, version)`; the outbox scan would prefer a
  `(next_attempt_at) WHERE status='queued'` partial index over the current
  `(event_id, status)` one; only `submissions` gets trigger-maintained `updated_at` while the
  freshness views `greatest(...)` over every table's — a forgotten app-side update means stale
  cache keys with no DB backstop. (All three feed lane item 7's drift-containment work; the TS
  mirror is already missing `submissions_event_submitted_idx`.)

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
