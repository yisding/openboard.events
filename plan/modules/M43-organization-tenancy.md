# M43 — Organization tenancy

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, no active claim. `organizations` sits above `events` via additive migration `drizzle/0010_organization_tenancy.sql`: `organizations`, `organization_members` (role ∈ owner/admin/member), and `events.organization_id` (`NOT NULL` with a database default pointing at a fixed default-organization row the migration inserts, backfilled from `event_members` at each admin's strongest existing role — so every pre-existing event and admin lands in the default org automatically, with no orphaned event and no invented membership for a user who had none). `requireOrganizationAdmin`/`authorizeOrganization` (in `src/features/auth/server/admin.ts`, exported next to the untouched per-event guards) share only `getAdminIdentity`, `roleSatisfies`, and the UNAUTHORIZED/FORBIDDEN split with M06a's event-scoped guards — a second, parallel authorization axis, not a replacement. `events` gains `UNIQUE (id, organization_id)`, extending the same composite-FK pattern event-scoped child tables already use, so organization-scoped tables (M47's exports, M49's subscriptions/usage, M55's CRM) can pin `(event_id, organization_id)` and let Postgres reject a cross-tenant row outright rather than trusting application code. Last-owner protection is enforced with a `FOR UPDATE` row lock on the owner set inside the same transaction as the role/removal write, closing the TOCTOU window a plain `COUNT` check would leave open. All of this is proven via `tests/integration/organization-tenancy.test.ts` (20 cases: backfill correctness, schema-chain rejection of null/nonexistent/cross-org organization ids, last-owner protection under concurrent writers, cross-organization list isolation, primary-organization resolution). Remaining before `DONE`: deployed/browser evidence — no e2e spec exercises `/organizations/**` yet, and no request against `sb-web-preview` has created an organization, added a member, or observed the default-org backfill on real data. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`. |
| **Scheduled** | P4 commercial layer, second module (hard-blocked on M42). |
| **Size** | L |
| **Paths owned** | `src/db/schema/organizations.ts`, `src/features/organizations/**`, the `requireOrganizationAdmin`/`authorizeOrganization`/`organizationAuth` slice of `src/features/auth/server/{admin,guards}.ts`, `src/app/api/internal/organizations/route.ts`, `src/app/api/internal/organizations/[organizationId]/members/**`, `src/app/organizations/page.tsx`, `src/app/organizations/[organizationId]/{layout,page}.tsx`, `drizzle/0010_organization_tenancy.sql`, `tests/integration/organization-tenancy.test.ts`. |

## Objective

Add an organization layer above events — membership, roles, and the composite-FK chain extended
one level — bounded by the existing event-scoping discipline rather than a rewrite, so every later
P4 module (user management, onboarding, GDPR, billing, CRM) has one tenancy root to hang off.

## Dependencies

- **Hard:** M42 (Better Auth admin identity — `getAdminIdentity` is what `requireOrganizationAdmin`
  reads).
- **Downstream (gated on this module):** M44 (invitations/roles/audit), M45 (onboarding creates
  events scoped to an organization), M47 (organization data export), M49 (billing subscriptions
  pin to `organization_id`), M55 (CRM's `organization_contacts`).

## Provides (interfaces others consume)

```ts
// src/features/organizations/index.ts
export { getOrganization, getOrganizationIn, getOrganizationBySlug, getOrganizationBySlugIn,
  getEventOrganization, getEventOrganizationIn, getOrganizationMemberRole, getOrganizationMemberRoleIn,
  listOrganizationEvents, listOrganizationEventsIn, listOrganizationMembers, listOrganizationMembersIn,
  listOrganizationsForUser, listOrganizationsForUserIn,
  resolvePrimaryOrganization, resolvePrimaryOrganizationIn } from "./server/queries";
export { createOrganization, createOrganizationIn, assignEventToOrganization, assignEventToOrganizationIn,
  setOrganizationMember, setOrganizationMemberIn,
  removeOrganizationMember, removeOrganizationMemberIn } from "./server/mutations";

// src/features/auth/index.ts (this module's guard slice)
export { authorizeOrganization, requireOrganizationAdmin } from "./server/admin";
export { organizationAuth } from "./server/guards";
```

## Contract and data additions

- `drizzle/0010_organization_tenancy.sql` (additive): `organizations`, `organization_members`,
  `events.organization_id` (`NOT NULL DEFAULT <default-org-uuid>`, backfilled), `events_id_organization_key
  UNIQUE (id, organization_id)`.
- No `src/shared/contracts/**` additions beyond `src/shared/contracts/organization.ts` (new file,
  in-scope for this module: `OrganizationDTO`, `OrganizationMembership`, role schemas).

## Acceptance criteria

Proven (PGlite, code-complete):

1. Every pre-existing event lands in the default organization; every existing admin gets
   default-organization membership at their strongest event role; a user with no event-membership
   role gets none invented (`organization-tenancy.test.ts:94,103,112`).
2. The column default means an insert naming no organization still works
   (`organization-tenancy.test.ts:117`).
3. An event referencing a nonexistent or null organization is refused by the schema; an
   organization-scoped child pinning `(event_id, organization_id)` rejects a cross-organization pair
   (`organization-tenancy.test.ts:129,156`).
4. An organization cannot be deleted while it still owns events (`organization-tenancy.test.ts:140`).
5. `createOrganizationIn` creates the organization and its first owner atomically
   (`organization-tenancy.test.ts:183`); a duplicate or reserved slug is rejected
   (`:190`); an organization can never lose its last owner, verified both by static count and by two
   concurrent membership writers racing under a real row lock (`:199`, `:212`, `:246`).
6. One organization's events/members never leak into another's list, including the legacy
   `/events` list scoped correctly to caller org+event membership (`:272`, `:295`); primary
   organization resolves by role then age (`:325`); organization role ranking refuses a member of a
   different organization (`:356`); the per-event contract is unchanged by this module's addition
   (`:377`).
7. `pnpm exec vitest run tests/integration/organization-tenancy.test.ts` is green (20/20) — one
   per AC line-citation above, which sum to exactly 20.

Deployed evidence — **outstanding**:

8. Create an organization through `/organizations` on the deployed preview, add a member, and
   confirm the invited member's role and event visibility.
9. Confirm on `sb-test`/`sb-dev` (already applied) that the default-organization backfill produced
   correct rows against real, non-seed data, not just PGlite fixtures.
10. No `e2e/**` spec exercises this module yet — one is owed before `DONE`.

## Guardrails

- Organization scope is enforced in the query/mutation layer, never inferred from which UI
  screen rendered a request.
- Last-owner protection takes a row lock on the owner set inside the same transaction as the
  membership write — a plain pre-check `COUNT` is not sufficient (closes exactly the race
  `organization-tenancy.test.ts:246` exercises).
- `requireOrganizationAdmin`/`authorizeOrganization` share `getAdminIdentity`/`roleSatisfies`/the
  UNAUTHORIZED-FORBIDDEN split with the per-event guards but remain a distinct axis — an
  organization role is never substituted for an event role or vice versa.
