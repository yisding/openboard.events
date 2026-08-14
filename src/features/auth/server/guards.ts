import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { apiKeys, events } from "@/db/schema";
import { eventIdSchema, organizationIdSchema, type ApiKeyId } from "@/shared/contracts";
import type { HandlerGuard, RouteParams } from "@/shared/server/handler";
import { AppError } from "@/shared/lib/errors";
import { getAdminIdentity, requireAdmin, requireOrganizationAdmin } from "./admin";
import { sha256 } from "@/shared/lib/crypto";
import { requirePortalByEventId } from "./portal";

/**
 * Every `/api/internal/[eventId]/…` route's guard. `role` defaults to
 * `"organizer"`, the same default `agendaAuth` and `tasksAdminAuth` already
 * use, and the same bar `requiredRoleForEventPath` puts on every admin page
 * outside `/events/[eventId]/review`.
 *
 * Membership is not a role. Without a default, `authorizeAdmin` is satisfied by
 * *any* `event_members` row, so a bare guard admitted a reviewer to every
 * organizer surface — including the speaker roster, whose names, emails and
 * per-contact submission codes/titles join straight back to the blind queue and
 * undo an `anonymize_authors` round. The default is therefore fail-closed: a
 * route a reviewer genuinely needs (their queue, their own scoring, the
 * submission they were assigned) opts in with an explicit
 * `{ role: "reviewer" }`, which is grep-able and checked by
 * `scripts/check-invariants.sh`.
 */
export const adminAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard => async (_request, eventId) => {
  if (!eventId) throw new AppError("VALIDATION", "eventId route parameter is required");
  const session = await requireAdmin(eventId, options?.role ?? "organizer");
  return { actorId: session.userId, role: session.role };
};

/**
 * M43 — the guard for an `/api/internal/organizations/[organizationId]/…`
 * route. Same shape and same fail-closed default as `adminAuth` above
 * (organizer unless a route explicitly asks for less), one level up: it reads
 * `organization_members`, never `event_members`.
 *
 * It is not a substitute for `adminAuth`. An event-scoped route keeps using
 * `adminAuth`, because organization membership is not event access — a route
 * that wants both says both, in that order.
 *
 * **Known property of the default organization, stated so nobody has to
 * rediscover it.** `drizzle/0010_organization_tenancy.sql` backfilled every
 * pre-M43 admin into `DEFAULT_ORGANIZATION_ID` at their *strongest* event
 * role, so an organizer of one legacy event holds organizer rights over that
 * one shared tenant — member listing, the audit log, the org export, the CRM.
 * That rollup is not an oversight and cannot be softened after the fact: a
 * "reviewer floor plus explicit promotion" would have left the default
 * organization with **zero owners**, and `requireOwnerForOwnershipChange`
 * (`organizations/server/membership.ts`) lets only an owner grant ownership —
 * an unrecoverable lockout needing direct database access, the very thing the
 * last-owner guard exists to prevent.
 *
 * What *was* fixable has been fixed rather than argued with: the legacy
 * `/events` list is scoped to the caller (`listEventsIn`) and new events file
 * under the actor's own organization (`resolvePrimaryOrganization`), so the
 * shared tenant no longer grows or leaks a fleet directory. Splitting the
 * legacy tenant per customer is a data-migration decision with a human in the
 * loop, not a guard default to flip here.
 */
export const organizationAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard => async (_request, _eventId, params) => {
  const raw = stringParam(params, "organizationId");
  const organizationId = organizationIdSchema.safeParse(raw);
  if (!organizationId.success) throw new AppError("VALIDATION", "organizationId route parameter is required");
  const session = await requireOrganizationAdmin(organizationId.data, options?.role ?? "organizer");
  return { actorId: session.userId, role: session.role };
};

/**
 * M44 — any authenticated admin identity, no event or organization scope.
 * For routes that resolve their own scope from something other than the URL
 * — "which organizations am I in", "accept this invitation token", "my own
 * sessions" — where requiring a route-param scope like `adminAuth`/
 * `organizationAuth` do would be backwards: the whole point is the caller
 * does not yet know (or need) the organization id.
 */
export const authenticatedAuth = (): HandlerGuard => async () => {
  const identity = await getAdminIdentity();
  if (!identity) throw new AppError("UNAUTHORIZED", "Sign in required");
  return { actorId: identity.userId, role: "authenticated" };
};

export const publicAuth = (): HandlerGuard => async () => null;

export const portalAuth = (): HandlerGuard => async (_request, eventId) => {
  if (!eventId) throw new AppError("VALIDATION", "eventId route parameter is required");
  const session = await requirePortalByEventId(eventId);
  return { actorId: session.contactId, role: "portal" };
};

function stringParam(params: RouteParams, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export async function authenticateApiKey(dbOrTx: DbOrTx, request: Parameters<HandlerGuard>[0], eventId: Parameters<HandlerGuard>[1], params: RouteParams) {
  const authorization = request.headers.get("authorization") ?? "";
  const raw = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!raw.startsWith("ob_live_")) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const keyHash = await sha256(raw);
  const slug = stringParam(params, "slug");
  if (!eventId && !slug) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const [key] = await dbOrTx.select({ id: apiKeys.id, eventId: apiKeys.eventId })
    .from(apiKeys)
    .innerJoin(events, eq(events.id, apiKeys.eventId))
    .where(and(
      eq(apiKeys.keyHash, keyHash),
      eventId ? eq(apiKeys.eventId, eventId) : eq(events.slug, slug ?? ""),
    ))
    .limit(1);
  if (!key) throw new AppError("UNAUTHORIZED", "Invalid API key");
  await dbOrTx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { actorId: key.id as ApiKeyId, role: "api_key", eventId: eventIdSchema.parse(key.eventId) };
}

// Bearer tokens are not browser cookies, so cross-site pages cannot forge one.
export const apiKeyAuth = (): HandlerGuard => Object.assign(
  (async (request, eventId, params) => authenticateApiKey(db, request, eventId, params)) as HandlerGuard,
  { csrfExempt: true },
);
