import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { eventOnboardingProgress, events } from "@/db/schema";
import { eventIdSchema, type EventId, type OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { OnboardingProgressUpdate, OnboardingStep } from "../progress-types";

export type ActiveOnboardingProgress = { eventId: EventId; step: OnboardingStep };

/**
 * Starts the durable checkpoint after the existing event create path has
 * produced a fully seeded, organization-scoped event. Stable-id retries keep
 * the existing step instead of moving an owner backwards.
 */
export async function startOrganizationOnboardingIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  eventId: EventId,
): Promise<void> {
  await dbOrTx.insert(eventOnboardingProgress)
    .values({ organizationId, eventId, step: "vocabulary" })
    .onConflictDoNothing({ target: eventOnboardingProgress.eventId });
}

export async function getActiveOrganizationOnboardingIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
): Promise<ActiveOnboardingProgress | null> {
  const [row] = await dbOrTx.select({
    eventId: eventOnboardingProgress.eventId,
    step: eventOnboardingProgress.step,
  })
    .from(eventOnboardingProgress)
    .where(eq(eventOnboardingProgress.organizationId, organizationId))
    .orderBy(desc(eventOnboardingProgress.updatedAt), desc(eventOnboardingProgress.eventId))
    .limit(1);
  if (!row) return null;
  if (row.step !== "vocabulary" && row.step !== "form") {
    throw new AppError("INTERNAL", "Onboarding checkpoint has an invalid step");
  }
  return { eventId: eventIdSchema.parse(row.eventId), step: row.step };
}

export const getActiveOrganizationOnboarding = (organizationId: OrganizationId): Promise<ActiveOnboardingProgress | null> =>
  getActiveOrganizationOnboardingIn(db, organizationId);

/**
 * Advances (or completes) one organization's event setup. Event ownership is
 * checked independently of the checkpoint row so completion is idempotent:
 * a lost successful response can safely be replayed after the row is gone.
 */
export async function updateOrganizationOnboardingIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  input: OnboardingProgressUpdate,
): Promise<OnboardingProgressUpdate> {
  const [ownedEvent] = await dbOrTx.select({ id: events.id }).from(events).where(and(
    eq(events.id, input.eventId),
    eq(events.organizationId, organizationId),
  )).limit(1);
  if (!ownedEvent) throw new AppError("NOT_FOUND", "Event not found");

  if (input.step === "complete") {
    await dbOrTx.delete(eventOnboardingProgress).where(and(
      eq(eventOnboardingProgress.eventId, input.eventId),
      eq(eventOnboardingProgress.organizationId, organizationId),
    ));
    return input;
  }

  // Include the current step in the write predicate. Without it, two tabs
  // could both read `vocabulary`, then let the slower request overwrite a
  // committed `form` checkpoint and move setup backwards.
  const [updated] = await dbOrTx.update(eventOnboardingProgress)
    .set({ step: input.step, updatedAt: new Date() })
    .where(and(
      eq(eventOnboardingProgress.eventId, input.eventId),
      eq(eventOnboardingProgress.organizationId, organizationId),
      ...(input.step === "vocabulary" ? [eq(eventOnboardingProgress.step, "vocabulary")] : []),
    ))
    .returning();
  if (!updated) {
    const [current] = await dbOrTx.select({ step: eventOnboardingProgress.step })
      .from(eventOnboardingProgress)
      .where(and(
        eq(eventOnboardingProgress.eventId, input.eventId),
        eq(eventOnboardingProgress.organizationId, organizationId),
      ))
      .limit(1);
    if (!current) throw new AppError("CONFLICT", "This event setup is already complete");
    throw new AppError("CONFLICT", "Event setup cannot move back to an earlier step");
  }
  return input;
}

export const updateOrganizationOnboarding = (
  organizationId: OrganizationId,
  input: OnboardingProgressUpdate,
): Promise<OnboardingProgressUpdate> => updateOrganizationOnboardingIn(db, organizationId, input);
