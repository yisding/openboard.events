import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events } from "@/db/schema";
import { assertOrganizationCanCreateEventIn, incrementOrganizationUsageIn } from "@/features/billing";
import { createEventIn, type CreateEventInput } from "@/features/events";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
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

export const provisionOrganizationEvent = (
  actorUserId: UserId,
  organizationId: OrganizationId,
  input: CreateEventInput,
): Promise<EventDTO> => provisionOrganizationEventIn(db, actorUserId, organizationId, input);
