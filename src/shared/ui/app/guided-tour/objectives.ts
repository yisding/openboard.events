import type {
  TourChapter,
  TourObjective,
  TourRoute,
  TourStep,
  TourWorld,
  TourWorldDelta,
} from "./types";

/**
 * The pure half of the engine: route substitution, objective predicates,
 * polling cadence and progress arithmetic. Everything here is a function of
 * its arguments, so the interesting behaviour is testable without a DOM, a
 * network or a clock.
 */

export type TourRouteContext = Readonly<Record<string, string>>;

/** Substitutes `:token` segments from the bootstrap's context. */
export function resolveTourPath(path: string, context: TourRouteContext): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (whole, key: string) => context[key] ?? whole);
}

export function tourHref(route: TourRoute, context: TourRouteContext): string {
  const path = resolveTourPath(route.path, context);
  const entries = Object.entries(route.query ?? {});
  if (entries.length === 0) return path;
  const search = new URLSearchParams(entries.map(([key, value]) => [key, resolveTourPath(value, context)]));
  return `${path}?${search.toString()}`;
}

export type TourLocation = { pathname: string; query: Readonly<Record<string, string>> };

/**
 * True when the browser is where the step wanted it.
 *
 * Extra query parameters are allowed on purpose: arming a chapter with
 * `?status=pending&arm=1` must still match an objective that only cares about
 * `status`, and a filter the organizer added themselves must not un-complete
 * a step they already finished.
 */
export function routeMatches(
  route: { path: string; query?: Readonly<Record<string, string>> },
  location: TourLocation,
  context: TourRouteContext,
): boolean {
  if (resolveTourPath(route.path, context) !== location.pathname) return false;
  return Object.entries(route.query ?? {}).every(
    ([key, value]) => location.query[key] === resolveTourPath(value, context),
  );
}

/**
 * True when the world moved the way the step asked, measured against the
 * baseline captured when the step armed — not against the value at page load.
 */
export function worldSatisfied(
  fact: string,
  delta: TourWorldDelta,
  baseline: TourWorld | null,
  world: TourWorld | null,
): boolean {
  if (!baseline || !world) return false;
  const before = baseline[fact];
  const after = world[fact];
  if (before === undefined || after === undefined) return false;
  if (delta === "changed") return !Object.is(before, after);
  if (typeof before !== "number" || typeof after !== "number") return false;
  return delta === "increased" ? after > before : after < before;
}

export type ObjectiveContext = {
  location: TourLocation;
  routeContext: TourRouteContext;
  world: TourWorld | null;
  baseline: TourWorld | null;
  /** Whether the `via: "dom"` target is currently mounted. */
  domPresent: boolean;
  /** Whether the coach card's own control has been used. */
  selfDone: boolean;
};

export function objectiveSatisfied(objective: TourObjective | undefined, context: ObjectiveContext): boolean {
  if (!objective) return false;
  switch (objective.via) {
    case "route":
      return routeMatches(objective, context.location, context.routeContext);
    case "dom":
      return context.domPresent;
    case "world":
      return worldSatisfied(objective.fact, objective.delta, context.baseline, context.world);
    case "self":
      return context.selfDone;
  }
}

/* --- polling cadence ---------------------------------------------------- */

export const POLL_BASE_MS = 2_000;
export const POLL_CEILING_MS = 10_000;
/** How long a step may sit unchanged before the interval starts stretching. */
export const POLL_CALM_AFTER_MS = 30_000;
/** A tutorial that hangs is worse than one that yields. */
export const POLL_HARD_STOP_MS = 600_000;
/** How long the player may look stuck before the hint offers itself. */
export const HINT_REVEAL_MS = 25_000;
/** How long an `observe` anchor must be on screen to count as looked at. */
export const OBSERVE_DWELL_MS = 1_200;
/** After this, an anchor that never mounted is treated as absent. */
export const ANCHOR_TIMEOUT_MS = 6_000;
/**
 * How long a step will hold its card back for an anchor that has not mounted
 * yet.
 *
 * The card is drawn beside its anchor, so drawing it before the anchor
 * resolves means drawing it in the middle of the screen and then moving it —
 * the double-take that reads as flicker. An anchor already on the page
 * resolves before the first paint and this never runs; one that arrives with a
 * navigation, a drawer or a query boundary is worth a quarter of a second of
 * patience. Past that the card appears anyway, because a tutorial that shows
 * nothing is worse than one that shows something in the wrong place — it just
 * does not yet say *why* there is no spotlight, which is `NOTICE_AFTER_MS`
 * below. Well short of `ANCHOR_TIMEOUT_MS`, the much longer wait before an
 * anchor is declared missing outright.
 */
export const ANCHOR_SETTLE_MS = 250;
/**
 * How long an unresolved anchor stays unexplained before the card says so.
 *
 * `ANCHOR_TIMEOUT_MS` is when an anchor is declared *missing*, and hanging the
 * notice off that alone left the two steps whose control genuinely does not
 * exist yet — the workshop question before Format is Workshop, the visibility
 * inspector before a question with a rule is selected — sitting for six seconds
 * with a card docked in the corner, no spotlight, and not a word about why. The
 * player has no way to tell that from a broken tutorial.
 *
 * `ANCHOR_SETTLE_MS` is too twitchy to reuse: at a quarter of a second an
 * anchor that arrives with a query boundary would flash the notice on its way
 * to being found. A second and a half is past every anchor that is merely late
 * and well short of the timeout, so the notice reads as an explanation rather
 * than a blink.
 */
export const NOTICE_AFTER_MS = 1_500;

/**
 * 2 s while anything is happening; once a step has been open for half a
 * minute with no movement, stretch by half each time up to ten seconds. The
 * player who wandered off costs one query per ten seconds, and the player who
 * is actually working still gets a two-second response.
 */
export function nextPollIntervalMs(
  current: number,
  { armedForMs, changed }: { armedForMs: number; changed: boolean },
): number {
  if (changed) return POLL_BASE_MS;
  if (armedForMs < POLL_CALM_AFTER_MS) return POLL_BASE_MS;
  return Math.min(Math.round(current * 1.5), POLL_CEILING_MS);
}

export function worldChanged(before: TourWorld | null, after: TourWorld | null): boolean {
  if (!before || !after) return before !== after;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) if (!Object.is(before[key], after[key])) return true;
  return false;
}

/* --- script arithmetic -------------------------------------------------- */

export type TourAvailability = {
  /** Below the mobile breakpoint, `desktopOnly` steps cannot run. */
  mobile: boolean;
  /**
   * Chapters the *host* says have nothing to point at — for the demo tour,
   * the ones whose provisioning phase never landed. Unlike `desktopOnly`,
   * this drops the whole chapter, because the objection is to the world
   * rather than to the screen.
   */
  unavailableChapters?: readonly string[];
};

/**
 * The steps that can actually run here, plus the chapters dropped to get
 * there. A silently skipped chapter reads as a bug, so the caller says so in
 * copy — see `skipNotices`, which hands each dropped chapter's line to the
 * next step that survived.
 */
export function visibleTourSteps(
  steps: readonly TourStep[],
  { mobile, unavailableChapters = [] }: TourAvailability,
): { steps: readonly TourStep[]; droppedChapters: readonly string[] } {
  const unavailable = new Set(unavailableChapters);
  if (!mobile && unavailable.size === 0) return { steps, droppedChapters: [] };
  const isDropped = (step: TourStep) => unavailable.has(step.chapter) || (mobile && step.desktopOnly === true);
  const kept = steps.filter((step) => !isDropped(step));
  const dropped = [...new Set(steps.filter(isDropped).map((step) => step.chapter))];
  return { steps: kept, droppedChapters: dropped };
}

/**
 * Where a cursor lands when the step it names is not one this viewport runs.
 *
 * The wrong answer is "the first visible step": a player who got to Chapter 7
 * on a laptop and opened the same demo on a phone would be shown the cold open
 * and, on their next advance, have six chapters of progress written back over
 * the top. So the resolution walks *forward* through the full script from
 * where the cursor actually is, to the first step that survived — the same
 * direction `skipNotices` walks, so the dropped chapters' apology is
 * already attached to whatever this returns. A drop that runs to the end of
 * the script resolves to the last surviving step, because "come back on a
 * laptop" is still worth saying when there is nothing after it.
 */
export function resolveVisibleStepId(
  all: readonly TourStep[],
  visible: readonly TourStep[],
  stepId: string,
  completed: readonly string[] = [],
): string | null {
  const visibleIds = new Set(visible.map((step) => step.id));
  if (visibleIds.has(stepId)) return stepId;
  const index = all.findIndex((step) => step.id === stepId);
  if (index < 0) {
    // A cursor this build has never heard of: a step a release renamed or
    // retired out from under a tour somebody was half-way through. The
    // resolution is *persisted*, so answering "start at the top" would not
    // merely look like a restart, it would write one over an organizer's
    // progress. The first objective they have not finished is both the honest
    // place and the one the dashboard's own rescue card offers.
    return visible.find((step) => step.optional !== true && !completed.includes(step.id))?.id
      ?? visible[0]?.id
      ?? null;
  }
  for (let cursor = index + 1; cursor < all.length; cursor += 1) {
    const candidate = all[cursor];
    if (candidate && visibleIds.has(candidate.id)) return candidate.id;
  }
  return visible.at(-1)?.id ?? null;
}

/** Steps in the golden path, i.e. everything that is not a side quest. */
export function arcSteps(steps: readonly TourStep[]): readonly TourStep[] {
  return steps.filter((step) => step.optional !== true);
}

export type TourProgress = {
  chapter: TourChapter | null;
  chapterIndex: number;
  chapterCount: number;
  stepIndex: number;
  stepCount: number;
  percent: number;
};

/**
 * Progress is reported in chapters, not steps: "Chapter 6 of 10 — The grid" is
 * a legible number and "step 19 of 31" is not. The bar itself still fills by
 * step so it moves on every objective rather than once a chapter.
 */
export function tourProgress(
  chapters: readonly TourChapter[],
  steps: readonly TourStep[],
  stepId: string,
): TourProgress {
  const arc = arcSteps(steps);
  const stepIndex = arc.findIndex((step) => step.id === stepId);
  const current = steps.find((step) => step.id === stepId) ?? null;
  const arcChapters = chapters.filter((chapter) => arc.some((step) => step.chapter === chapter.id));
  const chapterIndex = current ? arcChapters.findIndex((chapter) => chapter.id === current.chapter) : -1;
  const stepCount = arc.length;
  // A side quest is not on the arc, so it has no arc index — and falling back
  // to zero reported "Chapter 8 of 10" beside a bar at 0%, because the chapter
  // a quest borrows *is* on the arc. Report the arc position its chapter ends
  // at instead: opening a quest from the tray is a detour, not a restart.
  const chapterEnd = current
    ? arc.reduce((found, step, index) => (step.chapter === current.chapter ? index : found), -1)
    : -1;
  const resolvedIndex = stepIndex >= 0 ? stepIndex : Math.max(chapterEnd, 0);
  return {
    chapter: chapters.find((chapter) => chapter.id === current?.chapter) ?? null,
    chapterIndex: chapterIndex >= 0 ? chapterIndex + 1 : 0,
    chapterCount: arcChapters.length,
    stepIndex: resolvedIndex + 1,
    stepCount,
    percent: stepCount === 0 ? 0 : Math.round((resolvedIndex / stepCount) * 100),
  };
}

/**
 * The next step of the golden path after `stepId`. Side quests are reachable
 * from the tray, never in sequence, so completing one returns the player to
 * where the arc left off rather than dropping them into the next quest.
 */
export function nextArcStepId(steps: readonly TourStep[], stepId: string): string | null {
  const arc = arcSteps(steps);
  const index = arc.findIndex((step) => step.id === stepId);
  if (index < 0) return arc[0]?.id ?? null;
  return arc[index + 1]?.id ?? null;
}

/**
 * The first step of the chapter after the one `stepId` belongs to.
 *
 * An id that is not on the golden path at all — a side quest — resolves to the
 * head of the arc rather than to `null`, the same way `nextArcStepId` does.
 * Collapsing "I do not know this step" into "there is no next chapter" is how
 * a caller ends up calling `finish()` on a player who asked to skip a chapter.
 */
export function nextChapterStepId(steps: readonly TourStep[], stepId: string): string | null {
  const arc = arcSteps(steps);
  const current = arc.find((step) => step.id === stepId);
  if (!current) return arc[0]?.id ?? null;
  return arc.find((step, index) => step.chapter !== current.chapter && index > arc.indexOf(current))?.id ?? null;
}

export function chapterStepIds(steps: readonly TourStep[], chapter: string): readonly string[] {
  return arcSteps(steps).filter((step) => step.chapter === chapter).map((step) => step.id);
}

/**
 * Which step should carry the apology for a chapter the tour cannot run.
 *
 * The engine walks the full script in order; every chapter it had to drop
 * hands its note to the next step that survived, so the player is told "we
 * skipped ahead" at the moment it happens rather than never. A drop at the
 * very end attaches to the last surviving step, because "come back on a
 * laptop" is still worth saying when there is nothing after it.
 */
export function skipNotices(
  all: readonly TourStep[],
  visible: readonly TourStep[],
  chapters: readonly TourChapter[],
  unavailableChapters: readonly string[] = [],
): Readonly<Record<string, string>> {
  const visibleIds = new Set(visible.map((step) => step.id));
  const unavailable = new Set(unavailableChapters);
  const noteFor = (chapterId: string) => {
    const chapter = chapters.find((candidate) => candidate.id === chapterId);
    // Two reasons, two apologies: "come back on a laptop" is the wrong thing
    // to say about a chapter whose world was never built.
    return unavailable.has(chapterId) ? chapter?.unavailableNote ?? chapter?.mobileNote : chapter?.mobileNote;
  };
  const notices: Record<string, string> = {};
  let pending: string[] = [];
  for (const step of all) {
    if (!visibleIds.has(step.id)) {
      const note = noteFor(step.chapter);
      if (note && !pending.includes(note)) pending.push(note);
      continue;
    }
    if (pending.length === 0) continue;
    notices[step.id] = pending.join(" ");
    pending = [];
  }
  const last = visible.at(-1);
  if (pending.length > 0 && last) {
    notices[last.id] = [notices[last.id], ...pending].filter(Boolean).join(" ");
  }
  return notices;
}
