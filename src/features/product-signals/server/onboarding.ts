import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { events, organizationOnboardingMilestones } from "@/db/schema";
import type { EventId, OrganizationId, UserId } from "@/shared/contracts";
import { log } from "@/shared/lib/log";

/**
 * Mirrors `organization_onboarding_milestones_name_ck`. That CHECK is the
 * database half of this union, and `tryRecord…` below deliberately swallows
 * write failures, so a value added here without widening the constraint would
 * not fail loudly — it would make the funnel go quietly dark. The two are
 * changed together, always (the demo/tour trio landed with `drizzle/0044`).
 */
export type OnboardingMilestone =
  | "signup_completed"
  | "email_verified"
  | "event_created"
  | "form_published"
  | "public_form_visited"
  // First Fair. `demo_provisioned` deliberately carries "the tutorial started"
  // too: a demo exists only because someone asked for one. A demo is never an
  // `event_created`, because a tutorial must not look like a conversion.
  | "demo_provisioned"
  | "tour_completed"
  // The number that actually matters: a real event created by an organizer who
  // learned the product in the demo first.
  | "real_event_after_demo";

export type OrganizationOnboardingMilestone = {
  milestone: OnboardingMilestone;
  actorUserId: UserId | null;
  occurredAt: string;
};

/**
 * Keep the signal useful without becoming surveillance: only the first
 * occurrence of a fixed milestone is retained for an organization. No caller
 * can attach request metadata, and replays/retries cannot inflate the funnel.
 */
export async function recordOrganizationOnboardingMilestoneIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  milestone: OnboardingMilestone,
  actorUserId: UserId | null = null,
): Promise<boolean> {
  const [inserted] = await dbOrTx.insert(organizationOnboardingMilestones)
    .values({ organizationId, milestone, actorUserId })
    .onConflictDoNothing({
      target: [organizationOnboardingMilestones.organizationId, organizationOnboardingMilestones.milestone],
    })
    .returning();
  return Boolean(inserted);
}

/** Records verification only for a workspace this user created by signup.
 * An invited teammate verifying their address must not look like a second
 * customer conversion for the existing organization. */
export async function recordSignupEmailVerifiedIn(dbOrTx: DbOrTx, userId: UserId): Promise<boolean> {
  const signups = await dbOrTx.select({ organizationId: organizationOnboardingMilestones.organizationId })
    .from(organizationOnboardingMilestones)
    .where(and(
      eq(organizationOnboardingMilestones.milestone, "signup_completed"),
      eq(organizationOnboardingMilestones.actorUserId, userId),
    ));
  if (signups.length === 0) return false;
  const inserted = await dbOrTx.insert(organizationOnboardingMilestones)
    .values(signups.map(({ organizationId }) => ({ organizationId, milestone: "email_verified" as const, actorUserId: userId })))
    .onConflictDoNothing({
      target: [organizationOnboardingMilestones.organizationId, organizationOnboardingMilestones.milestone],
    })
    .returning();
  return inserted.length > 0;
}

async function recordEventOnboardingMilestoneIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  milestone: "event_created" | "form_published",
  actorUserId: UserId | null,
): Promise<boolean> {
  const [event] = await dbOrTx.select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return false;
  return recordOrganizationOnboardingMilestoneIn(dbOrTx, event.organizationId as OrganizationId, milestone, actorUserId);
}

function signalFailure(error: unknown, requestId: string, milestone: OnboardingMilestone): false {
  log({
    level: "warn",
    msg: `onboarding milestone write failed: ${error instanceof Error ? error.message : "unknown"}`,
    requestId,
    feature: "onboarding",
    code: milestone,
  });
  return false;
}

/** Product signals must never turn a completed customer action into a 500. */
export async function tryRecordOrganizationOnboardingMilestoneIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  milestone: OnboardingMilestone,
  actorUserId: UserId | null = null,
): Promise<boolean> {
  try {
    return await recordOrganizationOnboardingMilestoneIn(dbOrTx, organizationId, milestone, actorUserId);
  } catch (error) {
    return signalFailure(error, organizationId, milestone);
  }
}

export async function tryRecordEventOnboardingMilestoneIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  milestone: "event_created" | "form_published",
  actorUserId: UserId | null = null,
): Promise<boolean> {
  try {
    return await recordEventOnboardingMilestoneIn(dbOrTx, eventId, milestone, actorUserId);
  } catch (error) {
    return signalFailure(error, eventId, milestone);
  }
}

export async function tryRecordSignupEmailVerifiedIn(dbOrTx: DbOrTx, userId: UserId): Promise<boolean> {
  try {
    return await recordSignupEmailVerifiedIn(dbOrTx, userId);
  } catch (error) {
    return signalFailure(error, userId, "email_verified");
  }
}

export async function listOrganizationOnboardingMilestonesIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
): Promise<OrganizationOnboardingMilestone[]> {
  const rows = await dbOrTx.select({
    milestone: organizationOnboardingMilestones.milestone,
    actorUserId: organizationOnboardingMilestones.actorUserId,
    occurredAt: organizationOnboardingMilestones.occurredAt,
  })
    .from(organizationOnboardingMilestones)
    .where(eq(organizationOnboardingMilestones.organizationId, organizationId))
    .orderBy(asc(organizationOnboardingMilestones.occurredAt), asc(organizationOnboardingMilestones.milestone));
  return rows.map((row) => ({
    milestone: row.milestone as OnboardingMilestone,
    actorUserId: row.actorUserId as UserId | null,
    occurredAt: row.occurredAt.toISOString(),
  }));
}
