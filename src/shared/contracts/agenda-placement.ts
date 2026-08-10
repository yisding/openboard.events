import { z } from "zod";
import { roomIdSchema, sessionIdSchema } from "./ids";
import { conflictDtoSchema, scheduledSessionDtoSchema } from "./session";

/**
 * M54 — assisted agenda placement's wire contracts.
 *
 * The pure planner (`src/features/agenda/lib/suggest-placements.ts`) works in
 * epoch milliseconds; everything here is the ISO-string edge the preview/apply
 * routes and the auto-place dialog actually exchange.
 */

export const placementRejectionCountsSchema = z.object({
  roomOrSpeakerConflict: z.int().nonnegative(),
  blackout: z.int().nonnegative(),
  capacity: z.int().nonnegative(),
});
export type PlacementRejectionCounts = z.infer<typeof placementRejectionCountsSchema>;

export const placedSuggestionDtoSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string(),
  /** The session's `row_version` at preview time — carried back on Apply so
   * `moveSession`'s CAS has something to check. */
  version: z.int().positive(),
  dayKey: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  roomId: roomIdSchema.nullable(),
  roomName: z.string().nullable(),
});
export type PlacedSuggestionDTO = z.infer<typeof placedSuggestionDtoSchema>;

export const unplacedSuggestionDtoSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string(),
  reason: z.enum(["invalid_duration", "no_legal_slot"]),
  rejections: placementRejectionCountsSchema,
});
export type UnplacedSuggestionDTO = z.infer<typeof unplacedSuggestionDtoSchema>;

export const placementPreviewDtoSchema = z.object({
  placed: z.array(placedSuggestionDtoSchema),
  unplaced: z.array(unplacedSuggestionDtoSchema),
});
export type PlacementPreviewDTO = z.infer<typeof placementPreviewDtoSchema>;

export const applyPlacementInputSchema = z.object({
  sessionId: sessionIdSchema,
  version: z.int().positive(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  roomId: roomIdSchema.nullable(),
});
export type ApplyPlacementInput = z.infer<typeof applyPlacementInputSchema>;

export const applyPlacementsInputSchema = z.object({
  accepted: z.array(applyPlacementInputSchema).min(1).max(200),
});
export type ApplyPlacementsInput = z.infer<typeof applyPlacementsInputSchema>;

/**
 * One outcome per accepted row, never a single all-or-nothing verdict — the
 * apply flow "does not discard independent rows from the preview" (work
 * order), so a stale or skipped row must be reportable next to rows that
 * applied cleanly in the same batch.
 */
export const placementApplyOutcomeDtoSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), sessionId: sessionIdSchema, session: scheduledSessionDtoSchema, conflicts: z.array(conflictDtoSchema) }),
  z.object({ outcome: z.literal("skipped"), sessionId: sessionIdSchema, message: z.string() }),
  z.object({ outcome: z.literal("stale"), sessionId: sessionIdSchema, message: z.string() }),
  z.object({ outcome: z.literal("failed"), sessionId: sessionIdSchema, message: z.string() }),
]);
export type PlacementApplyOutcomeDTO = z.infer<typeof placementApplyOutcomeDtoSchema>;

export const placementApplyResultDtoSchema = z.object({ outcomes: z.array(placementApplyOutcomeDtoSchema) });
export type PlacementApplyResultDTO = z.infer<typeof placementApplyResultDtoSchema>;
