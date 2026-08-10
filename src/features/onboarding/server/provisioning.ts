import { db, type DbOrTx } from "@/db/client";
import { assertOrganizationCanCreateEventIn, incrementOrganizationUsageIn } from "@/features/billing";
import { createEventIn, type CreateEventInput } from "@/features/events";
import { assignEventToOrganizationIn } from "@/features/organizations";
import type { EventDTO, OrganizationId, UserId } from "@/shared/contracts";

/**
 * M45 — self-serve onboarding's only server write, and it is not a new write
 * at all: this composes M11's `createEventIn` (event insert + owner
 * membership + default template/format seeding) with M43's
 * `assignEventToOrganizationIn` (the single-column `UPDATE events SET
 * organization_id = …` that already existed for exactly this purpose — see
 * that function's own doc comment and `organizations/server/invitations.ts`'s
 * `organizationHomeEventId`, which has said since M44 landed that home-event
 * resolution stays `null` "until M45's event-creation flow lands").
 *
 * `eventsHubAuth` (M11) never learned about organizations — any signed-in
 * admin may call `createEvent`, and without an explicit organization the row
 * takes `events.organization_id`'s column DEFAULT
 * (`drizzle/0010_organization_tenancy.sql`). Both halves of that seam have
 * since been closed on the legacy route itself: `POST /api/internal/events`
 * resolves the actor's own organization before calling `createEvent`, and
 * `listEventsIn` is scoped to the caller's event/organization memberships
 * rather than returning the whole fleet. This function remains the explicit
 * path — it *names* its organization instead of deriving one, and it is the
 * only one that enforces M49's plan limits — so a self-serve org's events are
 * scoped and metered from the moment they exist.
 *
 * Resolution #4 confines `withTx` to eight named runtime functions and this
 * feature is not one of them, so this stays two single-statement-shaped calls
 * in sequence rather than a ninth transactional path — the same non-atomic-
 * but-safe composition `createEventIn`'s own doc comment already accepts for
 * its two seeding calls. The window between them (a moment where the row
 * exists under the default org) is not a new risk: `assignEventToOrganizationIn`
 * is a plain guarded `UPDATE` with no side effects to replay, so a crash
 * between the two calls leaves a fully-formed, fully-seeded event that is
 * merely still under the default org — re-running this same composition with
 * a fresh slug fixes the *next* event, and reassigning the orphaned one is
 * one more `assignEventToOrganization` call, not a repair path that needs
 * inventing here.
 *
 * M49 adds the entitlement gate at the front: `assertOrganizationCanCreateEventIn`
 * is the events-per-org limit, checked *before* `createEventIn` does any
 * writes so a plan at its cap never gets an orphaned/under-seeded row out of
 * this non-atomic sequence. The usage counter increment at the end is
 * best-effort display data, not load-bearing for that check (which always
 * re-counts live) — the same non-atomic-but-safe posture as the two seeding
 * calls this function already composes.
 */
export async function provisionOrganizationEventIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  organizationId: OrganizationId,
  input: CreateEventInput,
): Promise<EventDTO> {
  await assertOrganizationCanCreateEventIn(dbOrTx, organizationId);
  const event = await createEventIn(dbOrTx, actorUserId, input);
  await assignEventToOrganizationIn(dbOrTx, event.id, organizationId);
  await incrementOrganizationUsageIn(dbOrTx, organizationId, "events");
  return event;
}

export const provisionOrganizationEvent = (
  actorUserId: UserId,
  organizationId: OrganizationId,
  input: CreateEventInput,
): Promise<EventDTO> => provisionOrganizationEventIn(db, actorUserId, organizationId, input);
