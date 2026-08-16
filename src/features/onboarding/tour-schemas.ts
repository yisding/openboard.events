import { z } from "zod";
import { eventIdSchema, formIdSchema, organizationIdSchema } from "@/shared/contracts";

/**
 * First Fair — the guided tour's wire contracts.
 *
 * Deliberately a sibling of `progress-types.ts` rather than part of it: the
 * setup wizard's checkpoint and the tutorial's cursor are different rows, in
 * different tables, with different lifecycles, and the whole point of the
 * demo design is that a tutorial can never be mistaken for unfinished setup.
 *
 * Nothing here imports the tour *script*. The script (chapters, steps, copy)
 * is domain data owned by the client-side tour; the server only ever handles
 * opaque chapter and step identifiers, so adding a chapter is a data change
 * and never a server change.
 */

/** Mirrors `event_demo_tour_state_ck` (`drizzle/0044`). */
export const TOUR_STATUSES = ["not_started", "active", "paused", "complete"] as const;
export const tourStatusSchema = z.enum(TOUR_STATUSES);
export type TourStatus = z.infer<typeof tourStatusSchema>;

/** Mirrors `event_tour_steps_outcome_ck` (`drizzle/0044`). */
export const TOUR_STEP_OUTCOMES = ["completed", "skipped"] as const;
export const tourStepOutcomeSchema = z.enum(TOUR_STEP_OUTCOMES);
export type TourStepOutcome = z.infer<typeof tourStepOutcomeSchema>;

/**
 * Mirrors `event_demo_tour_phase_ck` (`drizzle/0044`). The provisioning
 * orchestrator owns the runners for these phases; this enum exists so a tour
 * reader can say "the world is still being built" without importing the
 * orchestrator, and the migration's CHECK is what keeps the two honest.
 */
export const DEMO_PROVISION_PHASES = [
  "event", "people", "forms", "submissions_a", "submissions_b",
  "evaluation", "agenda", "portal", "resources", "comms", "ready", "failed",
] as const;
export const demoProvisionPhaseSchema = z.enum(DEMO_PROVISION_PHASES);
export type DemoProvisionPhase = z.infer<typeof demoProvisionPhaseSchema>;

/**
 * Chapter and step identifiers are opaque to the server, but not unbounded:
 * they are written to a `text` column by a client the organizer controls, and
 * they come back out into a `role="dialog"` card. A slug shape keeps them
 * loggable, greppable and safe to render, without pinning the script's
 * vocabulary in a place a copy change would have to migrate.
 */
export const tourChapterIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u, "Invalid tour chapter");
export const tourStepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u, "Invalid tour step");

/**
 * Side quests are steps whose id carries this prefix. The curtain call counts
 * them separately ("17 of 19 objectives · 2 side quests") and the quest log
 * lists them, so the server has to be able to tell them apart — and a naming
 * convention the script test pins is cheaper than a second column that could
 * disagree with the script.
 */
export const TOUR_QUEST_STEP_PREFIX = "quest.";

/**
 * The world snapshot every `via: "world"` objective is judged against.
 *
 * One flat, cheap, event-scoped record: an objective is "the world reached
 * this state", never "the client called this handler", which is what makes a
 * cross-tab, cross-device or post-refresh completion register at all.
 */
export const tourWorldSchema = z.object({
  /** Live (non-deleted) builder fields across the event's forms. */
  formFields: z.number().int(),
  /** Published immutable form snapshots. */
  formVersions: z.number().int(),
  submissionsTotal: z.number().int(),
  pendingCount: z.number().int(),
  acceptedCount: z.number().int(),
  /** Reviews *this organizer* has actually submitted. */
  reviewsByMe: z.number().int(),
  /**
   * Decision mail the organizer has caused, counted across every terminal
   * status rather than only `queued`. On a demo event the dispatcher skips
   * each row within a minute, so a queued-only count would fall back to its
   * baseline while the player was still reading the card.
   */
  decisionEmailsQueued: z.number().int(),
  sessionsScheduled: z.number().int(),
  /** Room, speaker and track collisions, counted exactly as `detectConflicts` counts them. */
  conflictCount: z.number().int(),
  publishedSessions: z.number().int(),
  embedEnabled: z.boolean(),
  templateUpdatedAt: z.string().nullable(),
  portalTaskCompletions: z.number().int(),
  resourcePagesPublished: z.number().int(),
  contactsUpdatedAt: z.string().nullable(),
});
export type TourWorld = z.infer<typeof tourWorldSchema>;

export const WORLD_FACT_KEYS = Object.keys(tourWorldSchema.shape) as readonly WorldFactKey[];
export type WorldFactKey = keyof TourWorld;
export const worldFactKeySchema = tourWorldSchema.keyof();

/**
 * The persisted baseline: the value of the facts an armed step cares about,
 * as they stood the moment it armed. Partial by construction — a step arms
 * against the one or two facts its objective names, never the whole world.
 */
export const tourBaselineSchema = z.partialRecord(
  worldFactKeySchema,
  z.union([z.number(), z.boolean(), z.string(), z.null()]),
);
export type TourBaseline = z.infer<typeof tourBaselineSchema>;

/** `GET|PATCH /api/internal/events/[eventId]/tour`. */
export const tourStateSchema = z.object({
  eventId: eventIdSchema,
  chapter: tourChapterIdSchema,
  stepId: tourStepIdSchema,
  status: tourStatusSchema,
  armedStepId: tourStepIdSchema.nullable(),
  armedBaseline: tourBaselineSchema.nullable(),
  /** Objectives finished, oldest first. Side quests are listed separately. */
  completed: z.array(tourStepIdSchema),
  questsDone: z.array(tourStepIdSchema),
  skipped: z.array(tourStepIdSchema),
  world: tourWorldSchema,
});
export type TourStateDTO = z.infer<typeof tourStateSchema>;

/**
 * What the event layout hands the shell. Everything the tour needs that the
 * *script* cannot know: where the player is, what they have already done, and
 * the handful of real ids and names the copy interpolates.
 */
export const demoTourContextSchema = z.object({
  organizationId: organizationIdSchema,
  eventName: z.string(),
  eventSlug: z.string(),
  /** The demo's call for speakers, for the chapters that route into it. */
  cfpFormId: formIdSchema.nullable(),
  /**
   * A form on this event that can still be *restructured* — no non-draft
   * submission is pinned to any of its versions.
   *
   * The call for speakers itself is not that form and cannot be: it is
   * carrying two dozen proposals, and `assertStructuralAllowed` refuses to add
   * a question to a form somebody has already answered. That lock is a
   * feature, so the tour teaches it rather than fighting it — and the "add a
   * question" objective has to happen somewhere the product actually allows
   * one, which is what this id is for.
   *
   * Null when every form on the event is locked — which is not only a skipped
   * forms phase: this is "the first form carrying no non-draft submission", so
   * ordinary free play reaches it as soon as somebody answers the last empty
   * form. `supportedTourSteps` drops the steps that interpolate it rather than
   * routing to `/events/{id}/forms/` and arming an objective against a form
   * that does not exist.
   */
  editableFormId: formIdSchema.nullable(),
  datasetVersion: z.number().int(),
});
export type DemoTourContext = z.infer<typeof demoTourContextSchema>;

export const demoTourBootstrapSchema = tourStateSchema.extend({
  provisionPhase: demoProvisionPhaseSchema,
  /** `false` while the world is still being built; the tour may not start yet. */
  provisionReady: z.boolean(),
  /**
   * Whether the caller is the organizer `event_demo_tour.user_id` names.
   *
   * A demo event can have more than one organizer, but it has exactly one
   * cursor and one armed baseline — and the fact `judge.score` arms on
   * (`reviewsByMe`) is counted per caller. So the demo *context* is shared
   * (every organizer sees the ribbon, the badge and the demo-aware palette)
   * while the cursor is not: `false` means the shell shows the demo but does
   * not mount the tour, and the tour's own writers refuse this caller.
   */
  isTourOwner: z.boolean(),
  /**
   * The phase "Continue without it" jumped over, or `null` on a world that
   * built in full. Everything from this phase onwards never ran, so the tour
   * drops the chapters that depend on it and says so, rather than routing the
   * player to a screen with nothing on it (design §2.8).
   */
  skippedAtPhase: demoProvisionPhaseSchema.nullable().default(null),
  context: demoTourContextSchema,
});
export type DemoTourBootstrap = z.infer<typeof demoTourBootstrapSchema>;

/**
 * `PATCH …/tour` — one writer for both cursor moves and arming.
 *
 * `expectedStepId` is the compare-and-set: the update only lands if the row
 * still sits where the caller last saw it, so a stale second tab cannot drag
 * an advanced tour backwards and a double-fired advance applies once.
 *
 * `armedStepId` present means "this step is armed"; the server keeps any
 * baseline it already holds for that same step rather than re-capturing one,
 * which is the whole reason the baseline is a column and not client state.
 * Omitting it releases the arm when the cursor leaves the armed step.
 */
export const tourCursorPatchSchema = z.object({
  expectedStepId: tourStepIdSchema,
  chapter: tourChapterIdSchema,
  stepId: tourStepIdSchema,
  status: tourStatusSchema,
  armedStepId: tourStepIdSchema.optional(),
  armedBaseline: tourBaselineSchema.optional(),
}).superRefine((input, context) => {
  if (input.armedBaseline && !input.armedStepId) {
    context.addIssue({ code: "custom", path: ["armedStepId"], message: "A baseline needs the step it was captured for" });
  }
});
export type TourCursorPatch = z.infer<typeof tourCursorPatchSchema>;

/** `POST …/tour/steps` — the append-only achievement log. */
export const tourStepRecordSchema = z.object({
  stepId: tourStepIdSchema,
  outcome: tourStepOutcomeSchema.default("completed"),
});
export type TourStepRecord = z.infer<typeof tourStepRecordSchema>;
