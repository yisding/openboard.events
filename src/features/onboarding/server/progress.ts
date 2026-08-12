import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { eventMembers, eventOnboardingProgress, events, forms } from "@/db/schema";
import { eventIdSchema, formIdSchema, type EventId, type FormId, type OrganizationId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { OnboardingProgressUpdate, OnboardingStep } from "../progress-types";

export type ActiveOnboardingProgress = { eventId: EventId; formId: FormId | null; step: OnboardingStep };

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
    formId: eventOnboardingProgress.formId,
    step: eventOnboardingProgress.step,
  })
    .from(eventOnboardingProgress)
    .where(and(
      eq(eventOnboardingProgress.organizationId, organizationId),
      inArray(eventOnboardingProgress.step, ["vocabulary", "form"]),
    ))
    .orderBy(desc(eventOnboardingProgress.updatedAt), desc(eventOnboardingProgress.eventId))
    .limit(1);
  if (!row) return null;
  if (row.step !== "vocabulary" && row.step !== "form") {
    throw new AppError("INTERNAL", "Onboarding checkpoint has an invalid step");
  }
  return {
    eventId: eventIdSchema.parse(row.eventId),
    formId: row.formId ? formIdSchema.parse(row.formId) : null,
    step: row.step,
  };
}

/** Finds the newest checkpoint this user can actually advance. Organization
 * membership alone deliberately does not widen event-level access. */
export async function getActiveOrganizationOnboardingForUserIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  userId: UserId,
): Promise<ActiveOnboardingProgress | null> {
  const [row] = await dbOrTx.select({
    eventId: eventOnboardingProgress.eventId,
    formId: eventOnboardingProgress.formId,
    step: eventOnboardingProgress.step,
  })
    .from(eventOnboardingProgress)
    .innerJoin(eventMembers, and(
      eq(eventMembers.eventId, eventOnboardingProgress.eventId),
      eq(eventMembers.userId, userId),
      inArray(eventMembers.role, ["owner", "organizer"]),
    ))
    .where(and(
      eq(eventOnboardingProgress.organizationId, organizationId),
      inArray(eventOnboardingProgress.step, ["vocabulary", "form"]),
    ))
    .orderBy(desc(eventOnboardingProgress.updatedAt), desc(eventOnboardingProgress.eventId))
    .limit(1);
  if (!row) return null;
  if (row.step !== "vocabulary" && row.step !== "form") {
    throw new AppError("INTERNAL", "Onboarding checkpoint has an invalid step");
  }
  return {
    eventId: eventIdSchema.parse(row.eventId),
    formId: row.formId ? formIdSchema.parse(row.formId) : null,
    step: row.step,
  };
}

export const getActiveOrganizationOnboardingForUser = (
  organizationId: OrganizationId,
  userId: UserId,
): Promise<ActiveOnboardingProgress | null> => getActiveOrganizationOnboardingForUserIn(db, organizationId, userId);

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

  const [current] = await dbOrTx.select({
    formId: eventOnboardingProgress.formId,
    step: eventOnboardingProgress.step,
  })
    .from(eventOnboardingProgress)
    .where(and(
      eq(eventOnboardingProgress.eventId, input.eventId),
      eq(eventOnboardingProgress.organizationId, organizationId),
    ))
    .limit(1);

  if (input.step === "complete") {
    // No row supports events created before durable checkpoints existed.
    if (!current) return input;
    if (current.step === "complete") {
      if (current.formId && current.formId !== input.formId) {
        throw new AppError("CONFLICT", "A different form completed this setup");
      }
      return input;
    }
    if (!input.formId || current.formId !== input.formId) {
      throw new AppError("CONFLICT", "Finish the onboarding form associated with this setup");
    }
    const [completed] = await dbOrTx.update(eventOnboardingProgress)
      .set({ step: "complete", updatedAt: new Date() })
      .where(and(
        eq(eventOnboardingProgress.eventId, input.eventId),
        eq(eventOnboardingProgress.organizationId, organizationId),
        eq(eventOnboardingProgress.formId, input.formId),
        eq(eventOnboardingProgress.step, current.step),
      ))
      .returning();
    if (!completed) {
      const [latest] = await dbOrTx.select({ step: eventOnboardingProgress.step })
        .from(eventOnboardingProgress)
        .where(and(
          eq(eventOnboardingProgress.eventId, input.eventId),
          eq(eventOnboardingProgress.organizationId, organizationId),
        ))
        .limit(1);
      if (latest?.step !== "complete") throw new AppError("CONFLICT", "Onboarding progress changed; reload and try again");
    }
    return input;
  }

  if (!current) throw new AppError("CONFLICT", "This event setup is already complete");
  // A stale tab may retry association after its completion response was lost.
  // Treat that replay as success without moving the tombstone backwards.
  if (current.step === "complete") return input;
  if (current.step === "form" && input.step === "vocabulary") {
    throw new AppError("CONFLICT", "Event setup cannot move back to an earlier step");
  }

  if (input.formId) {
    if (current.formId && current.formId !== input.formId) {
      throw new AppError("CONFLICT", "A different form is already associated with this setup");
    }
    const [ownedForm] = await dbOrTx.select({ id: forms.id }).from(forms).where(and(
      eq(forms.id, input.formId),
      eq(forms.eventId, input.eventId),
      eq(forms.context, "cfp"),
    )).limit(1);
    if (!ownedForm) throw new AppError("NOT_FOUND", "Form not found");
  }

  // Include the current step in the write predicate. Without it, two tabs
  // could both read `vocabulary`, then let the slower request overwrite a
  // committed `form` checkpoint and move setup backwards.
  const [updated] = await dbOrTx.update(eventOnboardingProgress)
    .set({
      step: input.step,
      updatedAt: new Date(),
      ...(input.formId ? { formId: input.formId } : {}),
    })
    .where(and(
      eq(eventOnboardingProgress.eventId, input.eventId),
      eq(eventOnboardingProgress.organizationId, organizationId),
      eq(eventOnboardingProgress.step, current.step),
      ...(input.formId
        ? [current.formId
          ? eq(eventOnboardingProgress.formId, current.formId)
          : isNull(eventOnboardingProgress.formId)]
        : []),
    ))
    .returning();
  if (!updated) {
    const [latest] = await dbOrTx.select({ step: eventOnboardingProgress.step })
      .from(eventOnboardingProgress)
      .where(and(
        eq(eventOnboardingProgress.eventId, input.eventId),
        eq(eventOnboardingProgress.organizationId, organizationId),
      ))
      .limit(1);
    if (latest?.step === "complete") return input;
    if (!latest) throw new AppError("CONFLICT", "This event setup is already complete");
    throw new AppError("CONFLICT", "Onboarding progress changed; reload and try again");
  }
  return input;
}

export const updateOrganizationOnboarding = (
  organizationId: OrganizationId,
  input: OnboardingProgressUpdate,
): Promise<OnboardingProgressUpdate> => updateOrganizationOnboardingIn(db, organizationId, input);
