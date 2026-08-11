# M42 — Product auth: Better Auth + Google

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, no active claim. Admin/organizer auth runs on Better Auth (Drizzle adapter) behind a single switch point, `ADMIN_AUTH_PROVIDER` (`fallback` \| `better-auth`, default `fallback`), read once in `src/features/auth/server/admin.ts`'s `getAdminIdentity` and nowhere else — `requireAdmin`/`authorizeAdmin`/`requiredRoleForEventPath`/`roleSatisfies` are untouched on both sides of the switch. Migration `drizzle/0009_product_auth.sql` adds `admin_accounts`/`admin_verifications`, finally populates the `admin_sessions` table `0000_init.sql` created and nothing had ever written to, adds `users.email_verified`/`image`, and backfills a `credential` `admin_accounts` row from every existing `users.password_hash` (`upsertCredentialAccount`, also called live on every fallback-path password write so the two auth stores never drift). A Better Auth `password` hook verifies legacy PBKDF2 hashes and rewrites them to a v2 scheme on first successful sign-in via a `WHERE password = <old value>` guarded update, so a concurrent second sign-in is a no-op; `users.password_hash` is left untouched so the switch stays a clean revert. Revocation is a row delete in `admin_sessions`, re-read on every request — no cookie cache (deliberately: `better-auth`'s "`cookieCache` + `secondaryStorage`" bug is why, per `DECISIONS.md` "Product auth direction"). Google is wired as a social provider with account linking on; self-serve email/password sign-up is deliberately left closed at this layer (`config.emailAndPassword.disableSignUp = true` in `better-auth.ts`) because M44's invitation/organization-provisioning hook is the intended front door. Password reset and email verification run through the existing outbox (`src/features/auth/server/admin-mail.ts`, `admin-password.ts`) rather than Better Auth's built-in mailer, and mirror every write back to `users.password_hash` so the jose/PBKDF2 fallback stays usable in a revert. Full round-trip on the **shipping** (`fallback`) provider is deployed-proven (`docs/evidence/rev13-deployed-run.md` §2b: 401 → 200 with `ob_admin` → cookie authorizes a real `requireAdmin` read → 401 with no cookie → sign-out → **replaying the pre-sign-out cookie still returns 200**, deliberately reproducing the exact gap this module exists to close, since the fallback cookie is a self-contained JWT with no server record). **The Better Auth round-trip itself is not deployed-proven**: `ADMIN_AUTH_PROVIDER` is unset on `sb-web-preview` (holds its default `fallback`), and the preview carries no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`BETTER_AUTH_URL` — every Better Auth path (`get-session`, `sign-in/email`, `sign-in/social`, `callback/google`) answers this app's own `404 NOT_FOUND` (`DECISIONS.md` "S4 redo attempt — blocked on preview configuration, not on code," 2026-08-10). The rehash-on-login *precondition* is proven on `sb-test` instead: after `pnpm admin:bootstrap`, both seeded admins hold a legacy `pbkdf2-sha256$…` value in both `users.password_hash` and `admin_accounts.password` under `provider_id='credential'`. Remaining before `DONE`: the S4 redo itself (deployed Better Auth sign-in round-trip, deployed revocation proof — delete the `admin_sessions` row, replay the cookie, expect 401 — deployed rehash-on-login, the Google consent redirect, and a real `pnpm worker:size` measurement), all blocked on the owner action in `needs_owner` below, not on missing code. See [`../status.md`](../status.md) §2g and [`../../DECISIONS.md`](../../DECISIONS.md) "Product auth direction" / "S4 redo attempt". |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`, owner-reauthorized after the standing M42 hold. |
| **Scheduled** | P4 commercial layer, first module (gates M43/M44/M45/M49 by construction). |
| **Size** | L |
| **Paths owned** | `src/features/auth/server/better-auth.ts`, `src/features/auth/server/credential-account.ts`, `src/features/auth/server/sessions.ts`, `src/features/auth/server/admin-mail.ts`, `src/features/auth/server/admin-password.ts`, the `admin`/`guards` slice of `src/features/auth/server/admin.ts` and `guards.ts` touched for the switch point, `src/app/api/auth/[...action]/route.ts` (replacing `src/app/api/auth/[action]/route.ts`), `src/app/api/internal/me/sessions/**`, `src/app/account/**`, `src/app/login/forgot/page.tsx`, `src/app/login/reset/page.tsx`, `src/features/auth/components/{forgot-password-form,reset-password-form,sessions-panel}.tsx`, `drizzle/0009_product_auth.sql`, `tests/integration/admin-auth-better-auth.test.ts`, `tests/integration/admin-auth-mail.test.ts`, `tests/unit/admin-auth-route-throttle.test.ts`. |

## Objective

Replace the jose/PBKDF2 fallback for admin/organizer auth with Better Auth (Drizzle adapter),
supporting email+password **and Google as a social provider**, with server-side revocable sessions
(finally using the `admin_sessions`-shaped store `0000_init.sql` provisioned but never wrote to)
and password reset/email verification through the existing outbox — without breaking
`requireAdmin(eventId, role?)`'s frozen, implementation-neutral contract or the shipping fallback's
correctness while the swap is unproven deployed.

## Dependencies

- **Hard:** P2's deployed-auth proof (jose/PBKDF2 fallback working end-to-end, deployed) as the
  baseline the switch must not regress.
- **Downstream (gated on this module):** M43 (organization tenancy shares `getAdminIdentity`), M44
  (user management layers invitations/sessions/audit on this switch point), M45 (onboarding calls
  through the same admin identity), M49 (billing checkout/portal require an authenticated admin
  identity).

## Provides (interfaces others consume)

```ts
// src/features/auth/index.ts (barrel)
export { authenticateAdmin, authorizeAdmin, getAdminSession, requireAdmin,
  requiredRoleForEventPath, roleSatisfies } from "./server/admin";
export { clearAdminLoginThrottle, revokeAdminSessions, throttleAdminLogin } from "./server/admin";
export { hashAdminPassword, needsRehash, verifyAdminPassword } from "./server/admin-password";
export { upsertCredentialAccount } from "./server/credential-account";
export { listAdminSessions, listAdminSessionsIn,
  revokeAdminSessionById, revokeAdminSessionByIdIn } from "./server/sessions";
export { adminAuth, apiKeyAuth, authenticatedAuth, cronAuth,
  organizationAuth, portalAuth, publicAuth } from "./server/guards";
```

`requireAdmin`'s signature and authorization decisions are unchanged by the provider switch — this
is the contract every downstream P4 module (and every pre-existing admin route) depends on staying
implementation-neutral.

## Contract and data additions

- `drizzle/0009_product_auth.sql` (additive): `admin_accounts` (Better Auth's account table,
  `provider_id` ∈ `credential`/`google`), `admin_verifications`; new columns on the pre-existing but
  never-populated `admin_sessions` (`token`, nullable `token_hash`, `ip_address`, `user_agent`,
  `updated_at`); `users.email_verified`/`image`; a data backfill inserting one `credential`
  `admin_accounts` row per existing `users.password_hash`; two new `template_key` enum values
  (`admin_password_reset`, `admin_email_verification`) via the enum-recreate pattern (the
  `communication_logs` secret-payload CHECK dropped and re-added around the retype).
- `ADMIN_AUTH_PROVIDER` env var (`fallback` default, `better-auth` opt-in), read once in
  `getAdminIdentity`.
- No change to `src/shared/contracts/**` — the switch is entirely server-side; DTOs crossing the
  wire (`AdminSession`, route responses) are unchanged.

## Acceptance criteria

Proven on `main`/PGlite/`sb-test` (code-complete):

1. Legacy `users.password_hash` PBKDF2 credentials are detected and verified through Better Auth's
   custom password-hashing hooks, and rehashed to the new scheme on first successful sign-in — no
   forced resets, no orphaned accounts (`tests/integration/admin-auth-better-auth.test.ts:122`).
2. Existing `users`/`event_members` rows are preserved, and `requireAdmin(eventId, role?)` returns
   identical authorization decisions before and after the swap, including role ranking and per-path
   role derivation (`admin-auth-better-auth.test.ts:179`).
3. Admin sessions move to a revocable server-side store fully isolated from `portal_sessions` and
   the portal token tables; portal auth behavior is unchanged (`admin-auth-better-auth.test.ts:146`).
4. A session resolves from its cookie and stops resolving the moment its `admin_sessions` row is
   deleted (`admin-auth-better-auth.test.ts:162`).
5. Self-serve signup is closed at this layer; M44's invitation/organization path is the front door
   (`admin-auth-better-auth.test.ts:231` proves the *mechanism* works when driven directly — closing
   the door is a product decision documented here, not a bug).
6. Password reset and self-serve-signup writes mirror back to `users.password_hash`, keeping the
   fallback usable as a revert path (`admin-auth-better-auth.test.ts:260`, `:294`).
7. `pnpm exec vitest run tests/integration/admin-auth-better-auth.test.ts tests/integration/admin-auth-mail.test.ts tests/unit/admin-auth-route-throttle.test.ts` is green.

Deployed evidence (the S4 redo — **outstanding**, blocked on `needs_owner` below):

8. A deployed Better Auth sign-in round-trip (email+password) against `sb-web-preview` with
   `ADMIN_AUTH_PROVIDER=better-auth`.
9. A deployed revocation proof: delete the signed-in session's `admin_sessions` row, replay its
   cookie, and observe 401 (contrast with the fallback's proven-broken behavior in
   `docs/evidence/rev13-deployed-run.md` §2b, which is exactly the gap this AC closes).
10. Deployed rehash-on-login: `admin_accounts.password` for a legacy admin changes from
    `pbkdf2-sha256$…` to a Better Auth v2 scheme after one successful deployed sign-in (the
    precondition — both rows already holding the legacy value — is proven; §2b).
11. The Google consent redirect, followed to a real Google account, landing back on
    `/api/auth/callback/google` with a session.
12. `pnpm worker:size` measured with the Better Auth path live and compared against the ~1.3 MiB (of
    3 MiB) baseline the guardrail in `DECISIONS.md` "Product auth direction" recorded before this
    module shipped.

## Guardrails

- The jose/PBKDF2 fallback remains the shipping auth until AC 8–11 are proven deployed — this
  module's own merge did not flip the default.
- `cookieCache` is never enabled together with `secondaryStorage` (known upstream bug: an expired
  cookie cache is treated as logout instead of refreshed from storage).
- `requireAdmin(eventId, role?)` stays the frozen, implementation-neutral contract; every caller
  goes through it, never through a provider-specific check.
- Portal speaker auth (OTP/magic link) does not move onto Better Auth in this module.

## needs_owner

1. Set `ADMIN_AUTH_PROVIDER=better-auth` as a `sb-web-preview` worker var/secret, install
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_URL=https://sb-web-preview.yi-ding.workers.dev`
   as worker secrets (currently `.dev.vars`-only, local-dev, per `DECISIONS.md`), add that origin's
   `/api/auth/callback/google` to the Google OAuth client's authorized redirect URIs, then redeploy.
   Only then are AC 8–11 executable.
2. A real Google login (AC 11) is a human step even after (1).
