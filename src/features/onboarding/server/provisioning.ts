import { and, eq } from "drizzle-orm";
import { db, withAdvisoryLock, type DbOrTx } from "@/db/client";
import { events } from "@/db/schema";
import { assertOrganizationCanCreateEventIn, incrementOrganizationUsageIn } from "@/features/billing";
import { createEventIn, type CreateEventInput } from "@/features/events";
import { getOrganizationMemberRoleIn, resolvePrimaryOrganizationIn } from "@/features/organizations";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
import { AppError } from "@/shared/lib/errors";
import type { EventDTO, OrganizationId, UserId } from "@/shared/contracts";
import { startOrganizationOnboardingIn } from "./progress";

/**
 * Self-serve onboarding's organization-aware event create. The tenant is
 * carried by `createEventIn`'s INSERT, while a caller-generated id makes a
 * committed-but-lost response replayable. Recovery runs before the live-count
 * entitlement gate because the original event may have consumed the final
 * slot. The usage counter remains best-effort display data; retries do not
 * increment it again.
 */
export async function provisionOrganizationEventIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
  input: CreateEventInput,
): Promise<EventDTO> {
  // A committed response may be lost after the event has already consumed the
  // organization's final entitlement slot. Recognize that exact stable-id
  // replay before checking capacity; `createEventIn` then validates the slug
  // correlation and returns (or heals) the same event.
  if (input.id) {
    const [retry] = await dbOrTx.select({ id: events.id }).from(events).where(and(
      eq(events.id, input.id),
      eq(events.organizationId, organizationId),
    )).limit(1);
    if (retry) {
      const event = await createEventIn(dbOrTx, actorUserId, input, organizationId);
      await startOrganizationOnboardingIn(dbOrTx, organizationId, event.id);
      await tryRecordOrganizationOnboardingMilestoneIn(dbOrTx, organizationId, "event_created", actorUserId);
      return event;
    }
  }
  await assertOrganizationCanCreateEventIn(dbOrTx, organizationId);
  // The organization is part of the INSERT itself. There is no intermediate
  // default-tenant row to strand if a later seed/metering call fails.
  const event = await createEventIn(dbOrTx, actorUserId, input, organizationId);
  await startOrganizationOnboardingIn(dbOrTx, organizationId, event.id);
  await tryRecordOrganizationOnboardingMilestoneIn(dbOrTx, organizationId, "event_created", actorUserId);
  await incrementOrganizationUsageIn(dbOrTx, organizationId, "events");
  return event;
}

/**
 * The plan's event cap is a check-then-act, and nothing about the check holds
 * anything: `assertOrganizationCanCreateEventIn` counts, `createEventIn`
 * inserts, and on the autocommit HTTP handle each is its own transaction. Two
 * requests from one organization sitting at four of five events both counted
 * four, both passed, and both inserted — a double-click was enough, and a
 * scripted burst overshot without bound.
 *
 * Serialize the whole attempt per organization so the second one's count runs
 * after the first one's insert has committed. The lock is a session lock on its
 * own connection rather than `pg_advisory_xact_lock` inside `withTx`, because
 * `createEventIn` recovers from a duplicate slug by catching the unique
 * violation and reading the colliding row — an aborted transaction cannot do
 * that, and "That slug is taken" would become a 500. See `withAdvisoryLock`.
 *
 * Keyed on the organization, so two organizations never wait on each other.
 */
const eventCapLockKey = (organizationId: OrganizationId): string => `billing:event-cap:${organizationId}`;

export const provisionOrganizationEvent = (
  actorUserId: UserId,
  organizationId: OrganizationId,
  input: CreateEventInput,
): Promise<EventDTO> => withAdvisoryLock(
  eventCapLockKey(organizationId),
  () => provisionOrganizationEventIn(db, actorUserId, organizationId, input),
);

/**
 * Compatibility entry for the legacy organization-blind events endpoint.
 * Organization members still receive the full guided provisioning path —
 * including role and plan checks — while a hand-bootstrapped administrator
 * with no organization keeps the original single-tenant bootstrap behavior.
 */
export async function provisionEventForActorIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  input: CreateEventInput,
): Promise<EventDTO> {
  const organizationId = await resolveProvisioningOrganizationIn(dbOrTx, actorUserId);
  if (!organizationId) return createEventIn(dbOrTx, actorUserId, input);
  return provisionOrganizationEventIn(dbOrTx, actorUserId, organizationId, input);
}

/**
 * The organization this actor provisions into, once its access has been
 * checked — `null` for a hand-bootstrapped administrator with no organization,
 * who keeps the original single-tenant bootstrap path.
 *
 * Split out so the runtime entry below can resolve the organization *before*
 * taking the lock keyed on it, without duplicating the role check.
 */
async function resolveProvisioningOrganizationIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
): Promise<OrganizationId | null> {
  const organizationId = await resolvePrimaryOrganizationIn(dbOrTx, actorUserId);
  if (!organizationId) return null;

  const role = await getOrganizationMemberRoleIn(dbOrTx, organizationId, actorUserId);
  if (role !== "owner" && role !== "organizer") {
    throw new AppError("FORBIDDEN", "Only organization organizers can create events");
  }
  return organizationId;
}

export const provisionEventForActor = async (actorUserId: UserId, input: CreateEventInput): Promise<EventDTO> => {
  // The ungated bootstrap path has no cap to race against, so it needs no lock.
  const organizationId = await resolveProvisioningOrganizationIn(db, actorUserId);
  if (!organizationId) return createEventIn(db, actorUserId, input);
  return provisionOrganizationEvent(actorUserId, organizationId, input);
};
