"use client";

/**
 * The generic guided-tour engine.
 *
 * The shell mounts `GuidedTourMount` and knows nothing else about it — not
 * what a demo event is, not what the steps say, not which endpoint holds the
 * cursor. Everything domain-shaped arrives as a `TourBootstrap` prop from the
 * route module that owns the tour, which is what keeps the shell's import
 * graph `shell -> shared` and keeps tutorial copy out of a real-event
 * organizer's bundle.
 *
 * Load it lazily; it has no reason to exist on a page with no tour:
 *
 *   const GuidedTourMount = dynamic(
 *     () => import("@/shared/ui/app/guided-tour").then((module) => module.GuidedTourMount),
 *     { ssr: false },
 *   );
 *
 * A feature that wants to shave a poll interval off an objective should import
 * `emitTourSignal` from `./guided-tour/signals` directly, so the emitter costs
 * fifteen lines rather than the whole engine.
 */

export { GuidedTourMount, tourKeys } from "./provider";
export { TourAnchor, useTourAnchor, resolveAnchorElement, measurableElement, portalTargetFor, tourIdPresent } from "./anchor";
export type { TourAnchorState, TourAnchorStatus, TourRect } from "./anchor";
export { TourCoach, TourPill } from "./coach";
export type { TourCoachMode, TourCoachProps } from "./coach";
export { TourScrim } from "./scrim";
export { forgetTourMirror, readTourMirror, writeTourMirror } from "./mirror";
export type { MirroredCursor } from "./mirror";
export { emitTourSignal, onTourSignal } from "./signals";
export { prefersReducedMotion, useMobileTourViewport, useReducedMotion, TOUR_MOBILE_QUERY } from "./media";
export {
  ANCHOR_SETTLE_MS,
  ANCHOR_TIMEOUT_MS,
  HINT_REVEAL_MS,
  OBSERVE_DWELL_MS,
  POLL_BASE_MS,
  POLL_CALM_AFTER_MS,
  POLL_CEILING_MS,
  POLL_HARD_STOP_MS,
  arcSteps,
  chapterStepIds,
  skipNotices,
  nextArcStepId,
  nextChapterStepId,
  nextPollIntervalMs,
  objectiveSatisfied,
  resolveTourPath,
  routeMatches,
  tourHref,
  tourProgress,
  visibleTourSteps,
  worldChanged,
  worldSatisfied,
} from "./objectives";
export type { ObjectiveContext, TourLocation, TourProgress, TourRouteContext } from "./objectives";
export type {
  TourAnchorSpec,
  TourBootstrap,
  TourChapter,
  TourCompletion,
  TourCursor,
  TourCursorPatch,
  TourStateWire,
  TourTransport,
  TourObjective,
  TourPlacement,
  TourReward,
  TourRoute,
  TourStatus,
  TourStep,
  TourStepAction,
  TourStepKind,
  TourStepOutcome,
  TourWorld,
  TourWorldDelta,
  TourWorldValue,
} from "./types";
