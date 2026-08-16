import { z } from "zod";
import { eventIdSchema } from "@/shared/contracts";
import { demoProvisionPhaseSchema, type DemoProvisionPhase } from "./tour-schemas";

/**
 * First Fair — the demo provisioner's wire contracts.
 *
 * A sibling of `tour-schemas.ts` for the same reason that file is a sibling of
 * `progress-types.ts`: building the world and playing the tutorial are two
 * lifecycles that happen to share a row, and keeping their contracts apart is
 * what lets the provisioning screen ship without knowing a single thing about
 * chapters or steps.
 *
 * Nothing here describes *content*. The dataset lives in
 * `server/demo/dataset.ts` and never crosses the wire: the client is told which
 * phase is running and what to call it, never what that phase is about to
 * insert.
 */

/**
 * The phases that actually run a builder, in order. `ready` is the terminal
 * cursor value rather than a phase, and `failed` (which the migration's CHECK
 * allows) is deliberately never written by the orchestrator — see
 * `provisioning.ts`: leaving the cursor parked on the phase that threw is what
 * makes "Try that step again" a one-line replay instead of a recovery routine.
 */
export const DEMO_RUNNABLE_PHASES = [
  "event", "people", "forms", "submissions_a", "submissions_b",
  "evaluation", "agenda", "portal", "resources", "comms",
] as const;
export type DemoRunnablePhase = (typeof DEMO_RUNNABLE_PHASES)[number];

/** Ten phases, one HTTP request each — the number the progress bar counts to. */
export const DEMO_PHASE_COUNT = DEMO_RUNNABLE_PHASES.length;

/**
 * The provisioning screen's narration, one line per phase, mapped 1:1 onto the
 * phases that produce them (design §2.8). Keeping the copy here rather than in
 * the component is what stops the narration from drifting away from what the
 * server actually did: a phase cannot be added without its line, because the
 * record below is total.
 *
 * Present tense, active, specific — and honest about the two planted
 * conflicts, which is a promise Chapter 7 keeps.
 */
export const DEMO_PHASE_LABELS: Record<DemoProvisionPhase, string> = {
  event: "Booking Moscone West and eight tracks…",
  people: "Inviting 18 speakers who do not exist…",
  forms: "Opening the call for speakers…",
  submissions_a: "Collecting the first proposals…",
  submissions_b: "Collecting the rest of the proposals…",
  evaluation: "Handing you a review queue…",
  agenda: "Building a schedule with two problems in it…",
  portal: "Giving your speakers something to do…",
  resources: "Writing the speaker handbook…",
  comms: "Filling an outbox nobody will ever receive…",
  ready: "Your conference is ready.",
  failed: "That step did not take. Try it again, or continue without it.",
};

/**
 * What `POST …/demo` answers with, and the only thing the provisioning screen
 * needs: which phase is running, how far along it is, what to call it, and
 * whether the world is finished. `phaseIndex` is 1-based and counts the phase
 * *currently* being worked, so `7 of 10` reads the way a human counts.
 */
export const demoProvisionStateSchema = z.object({
  eventId: eventIdSchema,
  eventSlug: z.string().min(1),
  phase: demoProvisionPhaseSchema,
  phaseIndex: z.int().min(0).max(DEMO_PHASE_COUNT),
  phaseCount: z.literal(DEMO_PHASE_COUNT),
  label: z.string().min(1),
  done: z.boolean(),
});
export type DemoProvisionStateDTO = z.infer<typeof demoProvisionStateSchema>;

/**
 * `POST /api/internal/organizations/[organizationId]/demo`.
 *
 * - `provision` runs the next phase. Called in a loop by the provisioning
 *   screen, and safe to call again after a lost response: the phase is
 *   idempotent and the cursor advances by compare-and-set.
 * - `reset` deletes the demo event and rebuilds it from phase one at the same
 *   deterministic id (design §5.3).
 * - `skip` is the server half of the provisioning screen's *"Continue without
 *   it"* (design §2.8): it moves the cursor straight to `ready` without running
 *   the phase that would not take, so a half-built world is still a usable
 *   sandbox instead of a dead end. The tour marks the affected chapters
 *   unavailable rather than breaking.
 */
export const demoProvisionRequestSchema = z.object({
  mode: z.enum(["provision", "reset", "skip"]).default("provision"),
});
export type DemoProvisionRequest = z.infer<typeof demoProvisionRequestSchema>;

/**
 * `DELETE /api/internal/organizations/[organizationId]/demo`. Owner-only, and
 * the typed confirmation is required by the product's first destructive event
 * writer — a demo is disposable, but it is still an event, and the person
 * pressing this has usually customized it.
 */
export const demoDeleteRequestSchema = z.object({
  confirm: z.literal("DELETE"),
});
export type DemoDeleteRequest = z.infer<typeof demoDeleteRequestSchema>;

export const demoDeleteResultSchema = z.object({ deleted: z.literal(true) });
export type DemoDeleteResult = z.infer<typeof demoDeleteResultSchema>;
