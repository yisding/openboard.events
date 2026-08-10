import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { emailTemplates, eventMembers, events, sessionFormats } from "@/db/schema";
import { seedDefaultTemplates } from "@/features/comms";
import { eventIdSchema, type EventDTO, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { RESERVED_SLUGS, slugify } from "@/shared/lib/slug";
import type { CreateEventInput, UpdateEventInput } from "../schemas";
import { isConstraintViolation } from "./db-errors";
import { getEventIn } from "./queries";

export {
  deleteVocabItem,
  deleteVocabItemIn,
  reorderVocab,
  reorderVocabIn,
  saveVocabItem,
  saveVocabItemIn,
} from "./vocab";

/**
 * Event create/update. Resolution #4 confines `withTx` to eight named
 * runtime functions; this feature is not one of them, so every write here is
 * either a single statement or a small sequence of idempotent
 * (`ON CONFLICT DO NOTHING` / re-runnable) statements over `neon-http` — see
 * the repair-path comment on `createEventIn` for how that sequence stays safe
 * without a transaction.
 */

const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;
const EVENTS_SLUG_UNIQUE = "events_slug_key";

const DEFAULT_FORMATS = [
  { name: "Keynote", defaultDurationMins: 45 },
  { name: "Talk", defaultDurationMins: 30 },
  { name: "Workshop", defaultDurationMins: 90 },
  { name: "Panel", defaultDurationMins: 45 },
  { name: "Break", defaultDurationMins: 15 },
] as const;

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError("VALIDATION", "Slug must be lowercase letters, numbers and single hyphens", { field: "slug" });
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    throw new AppError("VALIDATION", `“${slug}” is a reserved word and cannot be used as a slug`, { field: "slug" });
  }
}

function assertValidTimezone(timezone: string): void {
  if (!Intl.supportedValuesOf("timeZone").includes(timezone)) {
    throw new AppError("VALIDATION", "Unknown timezone", { field: "timezone" });
  }
}

async function seedDefaultFormatsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<void> {
  await dbOrTx.insert(sessionFormats).values(
    DEFAULT_FORMATS.map((format, index) => ({ eventId, name: format.name, defaultDurationMins: format.defaultDurationMins, sortOrder: index })),
  ).onConflictDoNothing({ target: [sessionFormats.eventId, sessionFormats.name] });
}

/** Both calls are `ON CONFLICT DO NOTHING` / upsert-shaped, so replaying them against an already-seeded event is a no-op. */
async function seedEventDefaultsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<void> {
  await seedDefaultTemplates(dbOrTx, eventId);
  await seedDefaultFormatsIn(dbOrTx, eventId);
}

async function isUnderSeededIn(dbOrTx: DbOrTx, eventId: EventId): Promise<boolean> {
  const [templateCount] = await dbOrTx.select({ count: sql<number>`count(*)::int` }).from(emailTemplates).where(eq(emailTemplates.eventId, eventId));
  const [formatCount] = await dbOrTx.select({ count: sql<number>`count(*)::int` }).from(sessionFormats).where(eq(sessionFormats.eventId, eventId));
  return (templateCount?.count ?? 0) < 8 || (formatCount?.count ?? 0) < 5;
}

/**
 * Under-seeding alone (`isUnderSeededIn`) is not a safe signal for "this row
 * is a crash orphan nobody owns yet": an organizer can legitimately trim
 * default formats/templates on a live, fully-created event well below the
 * 8/5 thresholds, and `eventMembers` carries no record of who created a row
 * or whether it ever finished seeding. The only signal `createEventIn`'s own
 * two-step sequence (insert -> grantOwner -> seed) leaves behind that a
 * different, unrelated caller cannot forge is *membership*: a crash before
 * `grantOwnerIn` ran leaves zero rows in `event_members` for the event; a
 * crash between `grantOwnerIn` and seeding leaves exactly one row, owned by
 * the original creator. Anything else — including a live event whose owner
 * later deleted formats — already has a legitimate, different owner and must
 * never be handed to a second caller. This closes the privilege-escalation
 * path where any signed-in admin could claim `owner` on someone else's event
 * by driving its format/template count below threshold.
 */
async function isRepairableOrphanIn(dbOrTx: DbOrTx, eventId: EventId, actorUserId: UserId): Promise<boolean> {
  const members = await dbOrTx.select({ userId: eventMembers.userId }).from(eventMembers).where(eq(eventMembers.eventId, eventId));
  const hasNoOwnerYet = members.length === 0;
  const soleOwnerIsRetryingActor = members.length === 1 && members[0]?.userId === actorUserId;
  if (!hasNoOwnerYet && !soleOwnerIsRetryingActor) return false;
  return isUnderSeededIn(dbOrTx, eventId);
}

async function grantOwnerIn(dbOrTx: DbOrTx, eventId: EventId, actorUserId: UserId): Promise<void> {
  await dbOrTx.insert(eventMembers)
    .values({ userId: actorUserId, eventId, role: "owner" })
    .onConflictDoUpdate({ target: [eventMembers.userId, eventMembers.eventId], set: { role: "owner" } });
}

/**
 * Not atomic by design (resolution #4 forbids a ninth `withTx` path): the
 * event row is inserted first, then `seedDefaultTemplates` and the 5 default
 * formats are seeded. If the process dies between those steps, the event
 * exists but is under-seeded — "not yet usable" per the work order. The
 * *retry* heals rather than duplicates: a second `createEvent` call with the
 * same slug hits the 23505 branch below. It only heals the colliding row —
 * rather than reporting "that slug is taken" — when `isRepairableOrphanIn`
 * confirms *both* that the row is under-seeded *and* that nobody but this
 * retrying actor could already own it (see that function's comment); a
 * live event whose real owner merely trimmed formats/templates below
 * threshold is never repaired out from under them. Both seeding calls are
 * themselves `ON CONFLICT DO NOTHING`, so re-running them against a
 * fully-seeded event is a no-op — a caller can never receive an event
 * missing its defaults.
 */
export async function createEventIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  input: CreateEventInput,
  organizationId?: OrganizationId,
): Promise<EventDTO> {
  const slugCandidate = slugify((input.slug ?? "").trim() || input.name);
  assertValidSlug(slugCandidate);
  assertValidTimezone(input.timezone);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!(endsAt.getTime() > startsAt.getTime())) {
    throw new AppError("VALIDATION", "Ends At must be after Starts At", { field: "endsAt" });
  }

  const eventId = eventIdSchema.parse(crypto.randomUUID());
  try {
    await dbOrTx.insert(events).values({
      id: eventId,
      name: input.name.trim(),
      slug: slugCandidate,
      eventType: input.eventType,
      websiteUrl: input.websiteUrl || null,
      location: input.location || null,
      physicalAddress: input.physicalAddress || null,
      timezone: input.timezone,
      startsAt,
      endsAt,
      theme: input.theme || null,
      // Omitted when the caller has no organization to name, which is what
      // leaves `events.organization_id`'s column DEFAULT in charge — the
      // additive shape `drizzle/0010_organization_tenancy.sql` relies on for
      // seeds and fixtures. Every *request-driven* caller now passes one: that
      // default is the migration's compatibility hinge, not a tenancy policy,
      // and letting it decide meant a self-serve organization's event landed in
      // the shared default tenant.
      ...(organizationId ? { organizationId } : {}),
    });
  } catch (error) {
    if (!isConstraintViolation(error, EVENTS_SLUG_UNIQUE)) throw error;
    const [colliding] = await dbOrTx.select({ id: events.id }).from(events).where(eq(events.slug, slugCandidate)).limit(1);
    if (colliding && await isRepairableOrphanIn(dbOrTx, colliding.id as EventId, actorUserId)) {
      const orphanId = colliding.id as EventId;
      await grantOwnerIn(dbOrTx, orphanId, actorUserId);
      await seedEventDefaultsIn(dbOrTx, orphanId);
      const healed = await getEventIn(dbOrTx, orphanId);
      if (!healed) throw new AppError("INTERNAL", "Could not load the repaired event");
      return healed;
    }
    throw new AppError("VALIDATION", "That slug is taken", { field: "slug" });
  }

  await grantOwnerIn(dbOrTx, eventId, actorUserId);
  await seedEventDefaultsIn(dbOrTx, eventId);
  const created = await getEventIn(dbOrTx, eventId);
  if (!created) throw new AppError("INTERNAL", "Could not load the created event");
  return created;
}
export const createEvent = (actorUserId: UserId, input: CreateEventInput, organizationId?: OrganizationId): Promise<EventDTO> =>
  createEventIn(db, actorUserId, input, organizationId);

/**
 * Optimistic concurrency keyed on the frozen `EventDTO.rowVersion` field
 * (the contract exposes no `updatedAt`, so this feature uses the same field
 * `submission.rowVersion`/`session.rowVersion` already carry for the same
 * purpose rather than adding one). Zero rows updated means somebody else's
 * save already moved the version — `STALE_WRITE` (R11), never a silent
 * overwrite.
 */
export async function updateEventIn(dbOrTx: DbOrTx, eventId: EventId, patch: UpdateEventInput, expectedRowVersion: number): Promise<EventDTO> {
  if (patch.slug) assertValidSlug(patch.slug);
  if (patch.timezone) assertValidTimezone(patch.timezone);
  const bundlesDates = patch.startsAt !== undefined || patch.endsAt !== undefined;
  if (bundlesDates && (!patch.startsAt || !patch.endsAt || !patch.timezone)) {
    throw new AppError("VALIDATION", "Changing the schedule requires Starts At, Ends At and Timezone together", { field: "startsAt" });
  }

  const [current] = await dbOrTx.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!current) throw new AppError("NOT_FOUND", "Event not found");

  const effectiveStartsAt = patch.startsAt !== undefined ? new Date(patch.startsAt) : current.startsAt;
  const effectiveEndsAt = patch.endsAt !== undefined ? new Date(patch.endsAt) : current.endsAt;
  if (!(effectiveEndsAt.getTime() > effectiveStartsAt.getTime())) {
    throw new AppError("VALIDATION", "Ends At must be after Starts At", { field: "endsAt" });
  }

  let updated;
  try {
    // Every column is re-stated from `patch` or `current` in one object
    // literal — not built up conditionally on a pre-typed variable — so
    // drizzle's `.set()` overload that accepts a raw `sql` expression for
    // `rowVersion` still applies.
    [updated] = await dbOrTx.update(events)
      .set({
        name: patch.name ?? current.name,
        slug: patch.slug ?? current.slug,
        eventType: patch.eventType ?? current.eventType,
        websiteUrl: patch.websiteUrl !== undefined ? (patch.websiteUrl || null) : current.websiteUrl,
        location: patch.location !== undefined ? (patch.location || null) : current.location,
        physicalAddress: patch.physicalAddress !== undefined ? (patch.physicalAddress || null) : current.physicalAddress,
        timezone: patch.timezone ?? current.timezone,
        startsAt: effectiveStartsAt,
        endsAt: effectiveEndsAt,
        theme: patch.theme !== undefined ? (patch.theme || null) : current.theme,
        logoFileId: patch.logoFileId !== undefined ? patch.logoFileId : current.logoFileId,
        backgroundFileId: patch.backgroundFileId !== undefined ? patch.backgroundFileId : current.backgroundFileId,
        rowVersion: sql`${events.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, eventId), eq(events.rowVersion, expectedRowVersion)))
      .returning();
  } catch (error) {
    if (isConstraintViolation(error, EVENTS_SLUG_UNIQUE)) throw new AppError("VALIDATION", "That slug is taken", { field: "slug" });
    throw error;
  }
  if (!updated) throw new AppError("STALE_WRITE", "This event changed since you loaded it. Refresh to see the latest.");
  return getEventIn(dbOrTx, eventId) as Promise<EventDTO>;
}
export const updateEvent = (eventId: EventId, patch: UpdateEventInput, expectedRowVersion: number): Promise<EventDTO> =>
  updateEventIn(db, eventId, patch, expectedRowVersion);
