import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events } from "@/db/schema";
import { getOrganizationMemberRoleIn, recordOrganizationAuditEventIn } from "@/features/organizations";
import { AppError } from "@/shared/lib/errors";
import type { EventId, OrganizationId, UserId } from "@/shared/contracts";
import { demoEventId } from "./ids";

/**
 * First Fair — the product's first destructive event writer (design §5.3),
 * deliberately the smallest one that can exist.
 *
 * There is no `deleteEvent` anywhere else in `src/`, and this is not it: the
 * three predicates below are all inside the DELETE's own WHERE clause, so this
 * function is *structurally* incapable of removing a real event. Not "checks
 * first and then deletes" — a prior read plus a later delete is a race and an
 * invitation to a future refactor that keeps the delete and drops the read.
 *
 * Residue, enumerated: the cascade covers every child table (including the
 * cursor and the achievement log, through their composite key into `events`);
 * `crm_*.target_event_id` is `ON DELETE SET NULL`, which is the right behaviour
 * for a prospect whose target event went away; no R2 object is written at
 * provisioning time, and anything the organizer uploaded during the tour is
 * swept by the existing orphan cron; `organization_usage_counters` was never
 * incremented for a demo, so there is nothing to unwind; and the
 * `demo_provisioned` milestone stays, correctly — that funnel event did happen.
 */
export async function deleteDemoEventIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  eventId: EventId,
): Promise<{ deleted: true }> {
  const [deleted] = await dbOrTx.delete(events).where(and(
    eq(events.id, eventId),
    eq(events.organizationId, organizationId),
    // The whole safety argument, in one line and in the predicate itself.
    eq(events.isDemo, true),
  )).returning();
  if (!deleted) throw new AppError("NOT_FOUND", "Demo event not found");
  return { deleted: true };
}

/**
 * `DELETE /api/internal/organizations/[organizationId]/demo` — discarding the
 * demo for good.
 *
 * Owner-only, in addition to the route's own `organizationAuth({ role:
 * "owner" })`, because this is the one demo action with no undo: an organizer
 * can reset the world as often as they like, but removing it takes the resume
 * pill, the quest log and anything the organizer customised with it. Reset
 * calls the structural writer above directly, and is deliberately available one
 * role lower.
 */
export async function deleteDemoEventForActorIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<{ deleted: true }> {
  const role = await getOrganizationMemberRoleIn(dbOrTx, organizationId, actorUserId);
  if (role !== "owner") throw new AppError("FORBIDDEN", "Only an organization owner can delete the demo event");

  const eventId = demoEventId(organizationId);
  const result = await deleteDemoEventIn(dbOrTx, organizationId, eventId);
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "demo.deleted", null, { eventId });
  return result;
}

export const deleteDemoEventForActor = (
  actorUserId: UserId,
  organizationId: OrganizationId,
): Promise<{ deleted: true }> => deleteDemoEventForActorIn(db, actorUserId, organizationId);
