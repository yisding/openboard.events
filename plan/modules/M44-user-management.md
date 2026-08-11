# M44 — User management

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, no active claim. Self-serve signup (`POST /api/auth/sign-up/email` via a Better Auth `databaseHooks.user.create.after` hook that either folds the new user into a matching pending invitation or creates a brand-new organization and makes them its owner — no account is ever created outside an organization), team invitations routed through the existing comms outbox (`organization_invited` template, join token minted at render time, not at invite time, so a revoked invitation can never render a working link), owner-only role/removal management layered on M43's DB-level last-owner guard, and self-service admin-session list/revoke over M42's now-populated `admin_sessions`. Migration `drizzle/0011_user_management.sql` (additive) adds `organization_invitations` (upserted on re-invite so a resend refreshes the same row rather than duplicating it) and `organization_audit_log` (append-only: role changes, removals, invitations issued/revoked/accepted). Ten new API routes under `/api/internal/organizations/**` and `/api/internal/me/sessions/**`; new UI at `/signup`, `/join`, `/organizations/[id]/team`, `/organizations/[id]/audit`, `/account/sessions`. Proven via `tests/integration/user-management.test.ts` (12 cases across invitations, role management, self-serve provisioning, invitation mail rendering, and session views). Remaining before `DONE`: deployed/browser evidence — no e2e spec drives `/signup`, `/join`, the team panel, the audit log, or `/account/sessions` against the deployed preview, and the `organization_invited` email has not been sent/received through a real deployed Resend call. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`. |
| **Scheduled** | P4 commercial layer, third module (hard-blocked on M42, M43). |
| **Size** | L |
| **Paths owned** | `src/features/organizations/server/{invitations,audit,membership,signup}.ts`, `src/features/organizations/components/{audit-log-panel,team-panel}.tsx`, `src/features/auth/components/{signup-form,join-invitation-view}.tsx`, `src/features/auth/server/sessions.ts`, `src/app/signup/page.tsx`, `src/app/join/page.tsx`, `src/app/organizations/[organizationId]/{team,audit}/page.tsx`, `src/app/account/**`, `src/app/api/internal/organizations/[organizationId]/{invitations,members,audit-log}/**`, `src/app/api/internal/organizations/invitations/accept/route.ts`, `src/app/api/internal/me/sessions/**`, `drizzle/0011_user_management.sql`, `tests/integration/user-management.test.ts`. |

## Objective

Let organizations grow their own membership without owner intervention: self-serve signup that
never orphans an account outside an organization, invite-by-email with a working revoke/expire
story, owner-controlled role/removal management on top of M43's last-owner guard, a light audit
trail, and self-service visibility/control over one's own admin sessions.

## Dependencies

- **Hard:** M42 (Better Auth identity + revocable `admin_sessions`), M43 (organization/membership
  schema and `requireOrganizationAdmin`).
- **Downstream (gated on this module):** M45 (onboarding assumes a signed-up, organization-scoped
  admin), M55 (CRM assumes user/role management exists for organization scoping).

## Provides (interfaces others consume)

```ts
// src/features/organizations/index.ts (this module's slice)
export { inviteOrganizationMember, inviteOrganizationMemberIn,
  listPendingOrganizationInvitations, listPendingOrganizationInvitationsIn,
  revokeOrganizationInvitation, revokeOrganizationInvitationIn,
  acceptOrganizationInvitationByToken, acceptOrganizationInvitationByTokenIn,
  findPendingInvitationByEmailIn, issueOrganizationInvitationTokenIn } from "./server/invitations";
export { listOrganizationAuditLog, listOrganizationAuditLogIn,
  recordOrganizationAuditEventIn } from "./server/audit";
export { changeOrganizationMemberRole, changeOrganizationMemberRoleIn,
  removeOrganizationMemberAudited, removeOrganizationMemberAuditedIn } from "./server/membership";
export { provisionOrganizationForNewUser, provisionOrganizationForNewUserIn } from "./server/signup";

// src/features/auth/index.ts (this module's slice)
export { listAdminSessions, listAdminSessionsIn,
  revokeAdminSessionById, revokeAdminSessionByIdIn } from "./server/sessions";
```

## Contract and data additions

- `drizzle/0011_user_management.sql` (additive): `organization_invitations` (upsert-on-resend),
  `organization_audit_log` (append-only); one new `template_key` enum value
  (`organization_invited`) via the same enum-recreate pattern `0009` established.
- No `src/shared/contracts/**` file added beyond the invitation/role schemas already declared in
  `src/features/organizations/schemas.ts` (M43-owned file, extended here).

## Acceptance criteria

Proven (PGlite, code-complete):

1. Inviting a teammate routes mail through the organization's home event and re-inviting refreshes
   the same row rather than duplicating it (`tests/integration/user-management.test.ts:81`).
2. Inviting anyone as owner is refused — ownership transfers, it is never invited directly
   (`user-management.test.ts:108`).
3. Inviting into an organization with no event to route mail through still creates the invitation
   row but queues nothing (`:114`).
4. Revoking a pending invitation works once and refuses a second revoke (`:125`).
5. Accepting a token is scoped to the exact identity it was sent to, and only once (`:139`).
6. An organizer can change a non-owner's role or remove a non-owner, but is refused if the target
   (or action) touches ownership (`:172`, `:194`).
7. Self-serve signup with no matching invitation creates a new organization and makes the signer its
   owner; a signup matching a pending invitation folds into that organization instead of creating a
   second one (`:213`, `:221`).
8. The invitation email's join token is minted at render time (not invite time), and a revoked
   invitation renders nothing (`:244`, `:275`).
9. Session views list and revoke only the caller's own sessions (`:295`).
10. `pnpm exec vitest run tests/integration/user-management.test.ts` is green (12/12) — one per AC
    line-citation above, which sum to exactly 12. **Verified at merge `7b9cf3a`.** On the current
    dirty working tree 3 of the 12 fail with `column "acceptance_seen_at" of relation "contacts"
    does not exist` — that is M59's uncommitted `contacts.acceptanceSeenAt` column
    (`drizzle/0016_speaker_moments.sql`) meeting this file's **hard-coded** `MIGRATIONS` array
    (`user-management.test.ts:38-43`, which stops at `0012`). It is a harness-staleness bug in
    M59's lane, not an M44 regression: any future migration touching a table this spec inserts
    into will break it the same way until that array is derived from `drizzle/meta/_journal.json`.

Deployed evidence — **outstanding**:

11. A deployed `/signup` → organization creation → sign-in round trip.
12. A deployed invite → real Resend email to the allowlisted address → `/join` acceptance round
    trip (the same allowlist/real-send pattern `docs/evidence/rev13-deployed-run.md` §5 used for
    `submission_accepted`, not yet run for `organization_invited`).
13. `/organizations/[id]/team`, `/organizations/[id]/audit`, and `/account/sessions` rendered and
    interacted with in a browser against the deployed preview. No `e2e/**` spec covers any of this
    yet.

## Guardrails

- No account is ever created outside an organization — the `databaseHooks.user.create.after` hook
  is the one place that invariant is enforced; it must never be bypassed by a direct `INSERT INTO
  users` elsewhere in this module's surface.
- Role/removal management for owners routes through M43's row-locked last-owner guard; this module
  adds the audit trail and UI, not a second ownership check.
- All invitation and other mail goes through `enqueueEmail`/the outbox — no direct
  `communication_logs` writes and no second sender.
- Self-service session revoke only ever deletes the caller's own `admin_sessions` rows — it is not
  the same code path as M42's organizer-driven revocation, but must produce the identical
  post-condition (session stops resolving on the next request).
