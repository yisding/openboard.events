# M06a — Admin auth

| | |
|---|---|
| **Status** | IN REVIEW — **PR-OPEN** in [PR #11](https://github.com/yisding/symmetrical-happiness/pull/11): jose HS256 session cookies, Web Crypto PBKDF2 verification, `requireAdmin(eventId, role?)`, admin/API-key/cron/public guard factories, middleware redirects, a sign-in attempt throttle, and `pnpm admin:bootstrap`. S4 had no credential-backed deployed verdict, so the pre-decided Workers-safe fallback was adopted and recorded in `DECISIONS.md`. Blocking: the `admin_login_attempts` migration must move out of the already-applied `0000_init.sql`, reviewers must not reach organizer routes, and the deployed auth round-trip is still unproven. See [`../status.md`](../status.md) §2a. |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Sat AM — gates CP1 (Sat noon); every admin surface unblocks on it |
| **Size** | M |
| **Paths owned** | `src/features/auth/index.ts` (creates the barrel; [M06b](./M06b-portal-auth.md) appends its exports), `src/features/auth/server/admin.ts`, `src/features/auth/server/guards.ts`, `src/features/auth/better-auth.ts` (or `server/fallback-session.ts`), `src/features/auth/components/login-form.tsx`, `src/app/(admin)/login/page.tsx`, `src/app/api/auth/[...all]/route.ts`, `src/app/api/test/login/route.ts`, `src/middleware.ts` ([M06b](./M06b-portal-auth.md) appends the portal matcher), `src/db/schema/auth.ts` **content only** (the file is [M03](./M03-db-schema-migrations.md)'s; changes go through the architect's own migration) |

## Objective
An organizer signs in on the deployed preview, lands on `/events`, and every `/events/*` route is gated. `requireAdmin(eventId, role?)` is the single authorization call every admin query and mutation makes, and it behaves identically whether better-auth survived spike S4 or the jose+WebCrypto fallback was adopted. A reviewer signs in and sees reviewer surfaces only. A `TEST_AUTH=1`-gated login route lets Playwright in without touching the UI.

## Dependencies
- **Hard (blocks start):** [M03](./M03-db-schema-migrations.md) (`users`, `event_members`, and the auth tables migrated on sb-dev), [M04](./M04-shared-libs.md) (`getEnv`, `AppError`, `defineHandler`), and **[M01](./M01-scaffold-ci-deploy.md)'s spike S4 verdict** — which of the two implementations to build. Do not re-run the spike; read `DECISIONS.md`.
- **Soft (start against stub/fixture):** the login page can be built against [M05a](./M05a-admin-shell-ui.md)'s shadcn `<Form>` primitives as they land the same morning; seeded users come from [M09](./M09-seed-demo-script.md)'s `contacts`/`users` seed module, which can be a two-row inline insert until the orchestrator lands.

## Provides (interfaces others consume)
```ts
// @/features/auth
export async function requireAdmin(eventId: EventId, role?: MemberRole): Promise<AdminSession>;
export type AdminSession = { userId: UserId; email: string; name: string; role: MemberRole; eventId: EventId };
export async function getAdminSession(): Promise<AdminSession | null>;   // nullable variant for layouts
export const adminAuth: (opts?: { role?: MemberRole }) => HandlerGuard;   // for defineHandler
export const apiKeyAuth: () => HandlerGuard;                             // hashed bearer keys (M40)
export const cronAuth: () => HandlerGuard;                               // x-cron-secret (M08)
export const publicAuth: () => HandlerGuard;
```
- Routes: `/login`, `POST /api/auth/[...all]` (or the fallback's `POST /api/auth/{sign-in,sign-out}`), `POST /api/test/login` (**only mounted when `TEST_AUTH=1`**).
- `src/middleware.ts` gating `/events/*`.
- Consumed by: [M05a](./M05a-admin-shell-ui.md) (layout gate), [M11](./M11-events-feature.md), [M12](./M12-form-builder-core.md), [M13b](./M13b-rules-ui.md), [M14](./M14-form-settings-notifications.md), [M17](./M17-abstracts-table.md), [M18](./M18-submission-mutations-notify.md), **[M19](./M19-evaluation-scoring.md) (`role: 'reviewer'`)**, [M20](./M20-csv-export.md), [M23](./M23-tasks-admin.md), [M24](./M24-portal-form-builder.md), [M26](./M26-resource-pages.md), [M27](./M27-speakers-admin.md), [M28](./M28-sessions-crud.md)–[M33](./M33-embed-shells.md), [M37](./M37-comms-admin-ui.md)–[M40](./M40-public-api.md); and by [M06b](./M06b-portal-auth.md) for the impersonation path.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — real signatures, fake session (first 20 minutes)
Replace the [M02](./M02-shared-contracts.md) throwing stubs in `src/features/auth/index.ts` with a working `requireAdmin` that, under `TEST_AUTH=1`, returns a fixture `AdminSession` for the seeded organizer, and otherwise throws `AppError('UNAUTHORIZED')`. Push immediately: [M11](./M11-events-feature.md) and [M17](./M17-abstracts-table.md) start their server halves Sat AM and only need the shape.
- **Done when:** a feature `server/queries.ts` can `await requireAdmin(eventId)` and typecheck, and `TEST_AUTH=1 pnpm dev` renders an admin page.

### 2. Implementation A — better-auth (only if spike S4 passed)
`src/features/auth/better-auth.ts`: better-auth with the email+password provider and the Drizzle adapter over `@/db/client`; session storage in Postgres; cookie name `ob_admin`, `httpOnly`, `Secure`, `SameSite=Lax`, 7-day expiry. Mount `POST /api/auth/[...all]`.
Roles are **not** better-auth roles — they live in `event_members(user_id, event_id, role)` and are read by `requireAdmin`. A user with no `event_members` row for that event gets `FORBIDDEN`, never a redirect loop.

### 3. Implementation B — the pre-decided fallback (resolution #11, only if S4 failed)
~50 lines, no library: `jose` HS256 JWT in the same `ob_admin` cookie signed with `SESSION_SECRET`, payload `{userId, email, iat, exp}`. Credentials checked against `users.password_hash` computed with **Web Crypto PBKDF2-SHA256** (100k iterations, per-user salt stored in the hash string) — **never bcrypt/scrypt native modules** (they do not run on Workers). Sign-out clears the cookie. Same `requireAdmin` signature, same cookie name, same role lookup — **a swap touches only `features/auth`.**
- **Done when (either implementation):** sign-in on the **deployed preview** sets the cookie and an authenticated route returns the session; sign-out clears it.

### 4. `requireAdmin` + guards
```ts
export async function requireAdmin(eventId: EventId, role?: MemberRole) {
  const s = await readSession();                     // cookie → session row/JWT
  if (!s) throw new AppError('UNAUTHORIZED');
  const m = await db.select().from(eventMembers)
    .where(and(eq(eventMembers.userId, s.userId), eq(eventMembers.eventId, eventId)));
  if (!m[0]) throw new AppError('FORBIDDEN');
  if (role && !satisfies(m[0].role, role)) throw new AppError('FORBIDDEN');
  return { userId: s.userId, email: s.email, name: s.name, role: m[0].role, eventId };
}
```
Role ordering: `owner ⊇ organizer ⊇ reviewer`. `requireAdmin(eventId, 'reviewer')` therefore admits organizers too; **a reviewer must be rejected by organizer-scoped calls**, which is what makes [M19](./M19-evaluation-scoring.md)'s "reviewer sees reviewer surfaces only" true rather than cosmetic.
`adminAuth({role})` wraps it for `defineHandler` so route handlers never hand-roll the check.
- **Done when:** a PGlite/integration test asserts organizer→reviewer-scoped call passes, reviewer→organizer-scoped call throws `FORBIDDEN`, and a member of event B calling event A throws `FORBIDDEN`.

**Session/cookie facts, fixed here so no other module guesses:**

| | Admin ([M06a](./M06a-admin-auth.md)) | Portal ([M06b](./M06b-portal-auth.md)) |
|---|---|---|
| Cookie | `ob_admin` | `ob_portal_{eventId}` (event-keyed name — two events, two cookies) |
| Scope | user (cross-event) | **per (contact, event)** |
| Lifetime | 7 days | 30 days |
| Flags | httpOnly, Secure, SameSite=Lax, path `/` | same |
| Storage | better-auth session table **or** JWT (no server row) | `portal_sessions` row, `token_hash` only |
| Authorization | `requireAdmin(eventId, role?)` per call | `requirePortal(eventSlug)` + `contactId` in every repo fn |
| Middleware | redirect-only on `/events/*` | redirect-only on `/portal/*` |

### 4b. `apiKeyAuth` and `cronAuth` (small, land them now — three modules need them)
- `apiKeyAuth()` — reads `Authorization: Bearer ob_live_…`, sha256s it, looks it up in `api_keys` (hashed at rest), resolves the event, returns `{eventId, keyId}`; a bad key returns the **envelope** `{error:{code:'UNAUTHORIZED'}}` with 401, never a redirect ([M40](./M40-public-api.md)).
- `cronAuth()` — constant-time compare of the `x-cron-secret` header against `CRON_SECRET`; wrong secret → 401 ([M08](./M08-jobs-worker.md)).
Both live beside `adminAuth` so `defineHandler` has one guard vocabulary.
- **Done when:** `curl -H 'x-cron-secret: wrong' -X POST /api/jobs/outbox` returns 401 and the correct secret reaches the handler.

### 5. `/login` page
shadcn `<Form>` + `react-hook-form` + `zodResolver` over a contracts schema. Email + password, inline errors, a single generic "Invalid email or password" for both wrong-email and wrong-password (no user enumeration), redirect to `?next=` or `/events`. Branded minimally — this is admin chrome, not a judged surface.
Print the seeded organizer and reviewer credentials in [M09](./M09-seed-demo-script.md)'s stdout and `docs/demo-script.md`; **judges need the reviewer login to walk feature #4.**

### 6. `src/middleware.ts`
Matcher `['/events/:path*']` → redirect to `/login?next=<path>` when the admin cookie is absent. Also sets the standard security headers on all responses (with `/embed/*` excluded — those need `frame-ancestors *` from `next.config.ts`). Cookie presence only; **authorization happens in `requireAdmin`**, never in middleware (middleware cannot hit the DB cheaply and must not be the security boundary).
[M06b](./M06b-portal-auth.md) appends the `/portal/:path*` matcher to this same file — coordinate in one commit each, no parallel edits.
- **Done when:** `curl -I https://<preview>/events/x/dashboard` returns a 307 to `/login`, and with the cookie returns 200.

### 7. `POST /api/test/login` (`TEST_AUTH=1` only)
Body `{email}` → mints the admin session cookie for that seeded user with **no password**. The route module returns 404 unless the flag is set at build time, so it is absent from the production build. [M10](./M10-e2e-release.md)'s Playwright specs use it instead of driving the login form.
- **Done when:** `TEST_AUTH=1` build serves it, default build 404s it, and `curl -X POST .../api/test/login -d '{"email":"organizer@…"}' -i` returns `set-cookie`.

### 8. Impersonation hand-off
Expose `getAdminSession()` for [M06b](./M06b-portal-auth.md)'s "Open portal as X": the portal session it mints carries `impersonated_by_user_id` from this session so impersonated writes stay attributable. M06a provides the reader; **M06b owns the minting and the banner.**

### Guard factories for `defineHandler` (all five ship from this module's barrel)
`adminAuth()`, `portalAuth()` (M06b fills the body), `cronAuth()`, `publicAuth()`, and **`apiKeyAuth()`** — each returns a `HandlerGuard`, and route files call them (`defineHandler({ auth: adminAuth(), … })`, never a string, never a bare guard reference; [M04](./M04-shared-libs.md) §8).
- **`apiKeyAuth()`** parses `Authorization: Bearer …`, sha256s the value, looks up `api_keys` **scoped to the route's `eventId`**, updates `last_used_at` fire-and-forget (never blocking the response), and throws `UNAUTHORIZED` otherwise. It is the **only** hashed-bearer verification in the repo — [M40](./M40-public-api.md) owns key *lifecycle* (`createApiKey`/`listApiKeys`/`revokeApiKey`) but must not hand-roll a second `requireApiKey`.
- **Done when:** a key issued for event A returns 401 on event B's `/api/v1/events/[slug]/stats`, and a missing/garbage bearer returns the `{"error":{"code":"UNAUTHORIZED"}}` envelope.

## Acceptance criteria
Catalog AC, verbatim: *admin logs in on deployed preview; reviewer role sees reviewer surfaces only.*

```bash
# deployed preview
curl -i -X POST https://<preview>/api/auth/sign-in -d '{"email":"organizer@…","password":"…"}'  # set-cookie
curl -i https://<preview>/events/<id>/dashboard -H "cookie: ob_admin=…"                          # 200
curl -i https://<preview>/events/<id>/dashboard                                                  # 307 → /login
pnpm vitest run tests/integration/auth.test.ts   # role matrix: organizer/reviewer/other-event
pnpm exec playwright test e2e/admin-setup.spec.ts  # (M10) logs in via /api/test/login
```

## Guardrails
- **One signature, two implementations.** `requireAdmin(eventId, role?)` is frozen at CP1. Whichever S4 outcome shipped, no downstream module knows or cares — that is the entire point of resolution #11.
- **No native password libraries.** bcrypt/scrypt/argon2 native bindings do not run on workerd. Web Crypto PBKDF2 only, in the fallback path.
- **Authorization is per-event, always.** `requireAdmin` takes `eventId` first, like every repo function (R4). A guard that checks "is logged in" without the event is the cross-event data leak this architecture exists to prevent.
- **Middleware is a redirect, not a gate.** Never rely on it for authorization; a route handler that skips `requireAdmin` because "middleware already checked" is a review-blocker.
- **Do not couple to [M06b](./M06b-portal-auth.md).** Admin auth and portal auth are deliberately decoupled (risk #4) so a portal-auth slip cannot delay every admin surface. Shared code between them is limited to the barrel file and the cookie helpers.
- **Time-box the spike fallout.** If the chosen implementation is still not signing in on the **deployed** preview after 90 minutes, switch to the other one immediately and note it in `DECISIONS.md`. CP1 needs admin login working; it does not care which library did it.
- Edge cases to build now: no `event_members` row → friendly "you don't have access to this event" page, not a loop; expired cookie mid-session → redirect preserving `?next=`; two browser tabs signing out → the second sees the friendly state, not a crash; email stored lower-trimmed to match the `contacts`/`users` CHECK.

## If blocked
- **S4 verdict missing:** build the fallback (Implementation B). It is ~50 lines, has zero platform risk, and satisfies every AC. Record that better-auth was skipped for time.
- **Neon unavailable:** implement against PGlite and the role matrix test; wire the deployed check when the DB is back.
- **Login working early:** write the reviewer-role integration test and the `TEST_AUTH` route (both are [M10](./M10-e2e-release.md) prerequisites), then start [M06b](./M06b-portal-auth.md), which is the Sat-PM item on the same lane.
