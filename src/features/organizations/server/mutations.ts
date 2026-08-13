import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import {
  organizationDtoSchema,
  type EventId,
  type MemberRole,
  type OrganizationDTO,
  type OrganizationId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { RESERVED_SLUGS, slugify } from "@/shared/lib/slug";
import type { CreateOrganizationInput } from "../schemas";

/**
 * M43 organization writes.
 *
 * Resolution #4 confines `withTx` to eight named runtime functions and this
 * feature is not one of them, so every write below is a *single* statement.
 * Where a write has to be atomic across two tables — creating an organization
 * and its first owner — it is one data-modifying CTE rather than a ninth
 * transactional path, the same technique M50's evaluation writes use. An
 * organization can therefore never exist without an owner: either the whole
 * statement commits or none of it does.
 */

const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;
const ORGANIZATIONS_SLUG_UNIQUE = "organizations_slug_key";

/**
 * Drizzle wraps the driver error and keeps the original as `cause`, so the
 * constraint name is a level or two down. Mirrors `features/events/server/
 * db-errors.ts` — kept local rather than imported so this feature does not
 * reach into another feature's private server module.
 */
function isConstraintViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const entry = current as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (entry.constraint === constraintName) return true;
    if (typeof entry.message === "string" && entry.message.includes(constraintName)) return true;
    current = entry.cause;
  }
  return false;
}

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError("VALIDATION", "Slug must be lowercase letters, numbers and single hyphens", { field: "slug" });
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    throw new AppError("VALIDATION", `“${slug}” is a reserved word and cannot be used as a slug`, { field: "slug" });
  }
}

type OrganizationRow = { id: string; name: string; slug: string; created_at: Date | string };

/**
 * Create an organization and make `ownerUserId` its owner, atomically.
 *
 * The membership CTE is data-modifying, so Postgres runs it even though the
 * final SELECT does not reference it — that is what makes "no ownerless
 * organization" a database guarantee rather than a convention the next caller
 * has to remember.
 *
 * M49 extends the same CTE with `first_subscription`: every organization,
 * self-serve or explicitly created, gets a `'free'`-plan `organization_
 * subscriptions` row the moment it exists, the same all-or-nothing guarantee
 * as the owner row — `getOrganizationEntitlementsIn` never has to handle "an
 * organization with no subscription" as a normal case. Pre-M49 organizations
 * got theirs from `drizzle/0012_billing_scaffold.sql`'s backfill instead.
 */
export async function createOrganizationIn(
  dbOrTx: DbOrTx,
  ownerUserId: UserId,
  input: CreateOrganizationInput,
): Promise<OrganizationDTO> {
  const name = input.name.trim();
  const slug = slugify((input.slug ?? "").trim() || name);
  assertValidSlug(slug);
  try {
    const result = await dbOrTx.execute(sql`
      WITH created AS (
        INSERT INTO organizations (name, slug) VALUES (${name}, ${slug})
        RETURNING id, name, slug, created_at
      ), first_owner AS (
        INSERT INTO organization_members (user_id, organization_id, role)
        SELECT ${ownerUserId}::uuid, created.id, 'owner' FROM created
      ), first_subscription AS (
        INSERT INTO organization_subscriptions (organization_id, plan_id)
        SELECT created.id, 'free' FROM created
      )
      SELECT id, name, slug, created_at FROM created
    `);
    const [row] = rowsOf<OrganizationRow>(result);
    if (!row) throw new AppError("INTERNAL", "Could not load the created organization");
    return organizationDtoSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: new Date(row.created_at).toISOString(),
    });
  } catch (error) {
    if (isConstraintViolation(error, ORGANIZATIONS_SLUG_UNIQUE)) {
      throw new AppError("VALIDATION", "That slug is taken", { field: "slug" });
    }
    throw error;
  }
}
export const createOrganization = (ownerUserId: UserId, input: CreateOrganizationInput): Promise<OrganizationDTO> =>
  createOrganizationIn(db, ownerUserId, input);

/**
 * The last-owner guard, shared by the two writers below.
 *
 * An organization left with nobody who can administer it is a lockout, and a
 * lockout is not recoverable through the product — it needs direct database
 * access. So the guard has to hold under *concurrency*, not just in a
 * single-caller test, and the obvious formulation does not:
 *
 * ```sql
 * ... WHERE role <> 'owner' OR EXISTS (SELECT 1 FROM organization_members other
 *                                      WHERE ... other.role = 'owner')
 * ```
 *
 * In READ COMMITTED (every statement here runs as its own implicit
 * transaction), that `EXISTS` reads the *statement snapshot*. Postgres
 * re-evaluates the qual against the newest version of the row being written —
 * that is why the guard looks like it works — but the subquery over the
 * organization's *other* rows keeps reading the snapshot taken before the
 * concurrent writer committed. Two owners demoted or removed at the same
 * instant therefore each see the other as proof that an owner remains, both
 * statements succeed, and the organization is left with zero owners.
 *
 * This CTE is what closes it. `FOR UPDATE` on the owner rows does two things a
 * plain subquery does not:
 *
 * 1. It **serialises** concurrent writers — the second statement blocks on the
 *    first statement's row lock instead of racing it.
 * 2. On unblocking it **re-reads** each locked row at the latest committed
 *    version and re-applies the qual (`role = 'owner'`) to it — Postgres's
 *    EvalPlanQual path. A row the winner just demoted no longer matches and
 *    drops out of the CTE, so the loser's guard counts the owner set as it
 *    actually is, not as it was when its snapshot was taken.
 *
 * `ORDER BY user_id` fixes the lock order across all callers, so two
 * concurrent statements queue rather than deadlock. The CTE feeds the
 * *source* of each write (the `INSERT … SELECT`'s `WHERE`, the `DELETE`'s
 * `WHERE`), which is evaluated before the target row is locked for writing —
 * that ordering is what keeps the row lock and the CTE lock from being taken
 * in opposite orders by two callers.
 *
 * Still one statement, so PLAN resolution #4's eight-`withTx` list is
 * untouched: the implicit transaction around a single statement is exactly the
 * scope these locks need.
 */
function lockedOwners(organizationId: OrganizationId) {
  return sql`
    SELECT user_id FROM organization_members
    WHERE organization_id = ${organizationId}::uuid AND role = 'owner'
    ORDER BY user_id
    FOR UPDATE
  `;
}

/**
 * Add a member, or change an existing member's role — one upsert.
 *
 * Demoting the final owner fails; promoting anyone, adding anyone, and
 * demoting an owner while another owner exists all succeed. See
 * `lockedOwners` for why the guard is a locking CTE rather than the
 * `ON CONFLICT … WHERE EXISTS` it replaced.
 */
export async function setOrganizationMemberIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  userId: UserId,
  role: MemberRole,
): Promise<MemberRole> {
  const result = await dbOrTx.execute(sql`
    WITH owners AS (${lockedOwners(organizationId)})
    INSERT INTO organization_members (user_id, organization_id, role)
    SELECT ${userId}::uuid, ${organizationId}::uuid, ${role}::member_role
    WHERE ${role}::member_role = 'owner'
       OR NOT EXISTS (SELECT 1 FROM owners WHERE owners.user_id = ${userId}::uuid)
       OR EXISTS (SELECT 1 FROM owners WHERE owners.user_id <> ${userId}::uuid)
    ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING role
  `);
  const [row] = rowsOf<{ role: MemberRole }>(result);
  if (!row) throw new AppError("VALIDATION", "An organization must keep at least one owner");
  return row.role;
}
export const setOrganizationMember = (organizationId: OrganizationId, userId: UserId, role: MemberRole): Promise<MemberRole> =>
  setOrganizationMemberIn(db, organizationId, userId, role);

/** Same last-owner guard as `setOrganizationMemberIn`, in one guarded DELETE. */
export async function removeOrganizationMemberIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  userId: UserId,
): Promise<void> {
  const result = await dbOrTx.execute(sql`
    WITH owners AS (${lockedOwners(organizationId)})
    DELETE FROM organization_members
    WHERE organization_id = ${organizationId}::uuid
      AND user_id = ${userId}::uuid
      AND (
        NOT EXISTS (SELECT 1 FROM owners WHERE owners.user_id = ${userId}::uuid)
        OR EXISTS (SELECT 1 FROM owners WHERE owners.user_id <> ${userId}::uuid)
      )
    RETURNING user_id
  `);
  if (rowsOf(result).length === 0) {
    throw new AppError("VALIDATION", "That member is not in this organization, or is its last owner");
  }
}
export const removeOrganizationMember = (organizationId: OrganizationId, userId: UserId): Promise<void> =>
  removeOrganizationMemberIn(db, organizationId, userId);

/**
 * Move an event into an organization — the repair/import path for events that
 * landed in the default organization at migration time.
 *
 * Once M47/M49 hang organization-scoped rows off
 * `(event_id, organization_id)`, this statement stops being free: the
 * composite foreign key added by `drizzle/0010_organization_tenancy.sql` has
 * no `ON UPDATE CASCADE`, so Postgres will refuse to move an event that still
 * has organization-scoped children. That refusal is the correct behavior —
 * silently re-parenting a billing or export row across tenants is exactly what
 * the composite chain exists to prevent — and whoever adds the first such
 * table owns deciding what a move means for it.
 */
export async function assignEventToOrganizationIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  organizationId: OrganizationId,
): Promise<void> {
  const result = await dbOrTx.execute(sql`
    UPDATE events SET organization_id = ${organizationId}::uuid, updated_at = now()
    WHERE id = ${eventId}::uuid
    RETURNING id
  `);
  if (rowsOf(result).length === 0) throw new AppError("NOT_FOUND", "Event not found");
}
export const assignEventToOrganization = (eventId: EventId, organizationId: OrganizationId): Promise<void> =>
  assignEventToOrganizationIn(db, eventId, organizationId);
