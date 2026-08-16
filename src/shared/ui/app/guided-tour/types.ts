import type { PopoverPlacement } from "@/shared/ui/app/popover-position";

/**
 * The guided tour engine's vocabulary — deliberately domain-free.
 *
 * Nothing here knows what a submission, a session or a demo event is. A tour
 * is a list of steps, each with an anchor to point at and an objective that
 * decides when it is done; the *script* that fills those in is feature data
 * and lives with the feature that owns it. That separation is what keeps the
 * shell's import graph `shell -> shared` and keeps a real-event organizer from
 * downloading a single byte of tutorial copy.
 */

export type TourStepKind = "beat" | "observe" | "act";

export type TourPlacement = PopoverPlacement;

export type TourRoute = {
  /** `:token` segments are substituted from `TourBootstrap.context`. */
  path: string;
  query?: Readonly<Record<string, string>>;
};

/**
 * The anchor ladder, best first. A selector that already exists in the
 * stylesheet costs nothing and cannot rot silently; an accessible name is the
 * next best because an AST test already freezes it; a `data-tour` attribute is
 * a pinned contract and therefore a liability, so it is the last resort.
 */
export type TourAnchorSpec =
  | { kind: "selector"; css: string }
  | { kind: "role"; role: string; name: string }
  | { kind: "tour-id"; id: string }
  | { kind: "none" };

export type TourWorldDelta = "increased" | "decreased" | "changed";

/**
 * How a step decides it is finished.
 *
 * `world` is the important one: it asks the server whether reality has reached
 * the objective, which is why completing a step in another tab, on another
 * device, after a refresh, or by a route the tour never mentioned all count.
 */
export type TourObjective =
  | { via: "route"; path: string; query?: Readonly<Record<string, string>> }
  | { via: "dom"; present: string }
  | { via: "world"; fact: string; delta: TourWorldDelta }
  | { via: "self" };

export type TourReward = { emoji: string; line: string; drops?: number };

/** A control the coach card owns. Clicking it satisfies a `via: "self"` step. */
export type TourStepAction = { label: string; href: string; newTab?: true };

export type TourStep = {
  /** Stable across releases: it is stored in the achievement log. */
  id: string;
  chapter: string;
  kind: TourStepKind;
  /** The objective, imperative. */
  title: string;
  /** The stake, never the noun. */
  body: string;
  route?: TourRoute;
  anchor?: TourAnchorSpec;
  placement?: TourPlacement;
  /**
   * Set `false` for a step whose anchor lives inside a native `<dialog>`: the
   * dialog's own `::backdrop` is already the scrim, and nothing z-indexed can
   * paint above the top layer anyway.
   */
  spotlight?: boolean;
  /** Required for `kind: "act"`. */
  objective?: TourObjective;
  /** Revealed on "Show me how", or on its own once the player looks stuck. */
  hint?: string;
  reward?: TourReward;
  /** A side quest: offered from the card's tray, never blocking the arc. */
  optional?: true;
  /** Skipped below the mobile breakpoint, with copy rather than silently. */
  desktopOnly?: true;
  /**
   * Renders as a `Modal` instead of an anchored card. The two beats that earn
   * owning the screen are the cold open and the curtain call; `modal-wide` is
   * the curtain call's shape.
   */
  presentation?: "card" | "modal" | "modal-wide";
  /** Overrides "Continue" on a `beat`. */
  continueLabel?: string;
  /** Adds a quiet secondary control that pauses the tour, e.g. "I'll poke around myself". */
  declineLabel?: string;
  action?: TourStepAction;
};

export type TourChapter = {
  id: string;
  name: string;
  /** Offered in sequence with a one-click skip, never hidden behind a disclosure. */
  optional?: true;
  /**
   * Shown by the engine when this chapter is dropped for want of screen. A
   * silently skipped chapter reads as a bug, so a chapter with `desktopOnly`
   * steps owes the player a sentence.
   */
  mobileNote?: string;
  /**
   * Shown when the host names this chapter in `TourBootstrap.unavailableChapters`
   * — for the demo tour, when the provisioning phase this chapter depends on
   * never ran. A different sentence from `mobileNote` because it is a
   * different apology: nothing is wrong with the screen, there is simply
   * nothing there to point at.
   */
  unavailableNote?: string;
};

export type TourStatus = "not_started" | "active" | "paused" | "complete";

export type TourStepOutcome = "completed" | "skipped";

export type TourWorldValue = number | string | boolean | null;

/** One server-computed snapshot of "has the world reached the objective yet". */
export type TourWorld = Readonly<Record<string, TourWorldValue>>;

export type TourCursor = {
  chapter: string;
  stepId: string;
  status: TourStatus;
  /**
   * The step whose baseline is persisted. Held on the server, not in memory:
   * a reload while a step is armed must not re-capture the baseline at the
   * current value, or an action already taken becomes invisible.
   */
  armedStepId?: string | null;
  armedBaseline?: TourWorld | null;
};

/** One server answer to "where is the player, and what does the world look like". */
export type TourStateWire = {
  chapter: string;
  stepId: string;
  status: TourStatus;
  /**
   * When the row this payload describes was last written — an opaque, sortable
   * version string (an ISO timestamp, in the product). Optional: a host that
   * does not supply one gets the old behaviour, where every payload is treated
   * as current.
   */
  updatedAt?: string | null | undefined;
  armedStepId?: string | null | undefined;
  armedBaseline?: TourWorld | null | undefined;
  completed: readonly string[];
  questsDone: readonly string[];
  world: TourWorld;
};

export type TourCursorPatch = {
  chapter: string;
  stepId: string;
  status: TourStatus;
  /** CAS: the server rejects the write if the cursor has moved underneath it. */
  expectedStepId: string;
  /** Present means "this step is armed"; absent releases the arm. */
  armedStepId?: string;
  armedBaseline?: TourWorld;
};

/**
 * How the engine talks to whatever holds the cursor. The default is the
 * repo's `api()` client against `statePath`/`stepsPath`; supplying one by hand
 * is what lets `/kitchen-sink` and the unit tests drive the whole engine with
 * no server, no network stub and no route.
 */
export type TourTransport = {
  read: () => Promise<TourStateWire>;
  patch: (patch: TourCursorPatch) => Promise<TourStateWire>;
  record: (stepId: string, outcome: TourStepOutcome) => Promise<void>;
};

/**
 * Everything the engine needs, assembled by whichever route module owns the
 * tour. `null` is a complete answer: no tour here, render the children.
 */
export type TourBootstrap = {
  /** Namespaces localStorage and the query cache. The event id, in practice. */
  scopeId: string;
  /** Path under `/api/internal` for the cursor + world snapshot (GET, PATCH). */
  statePath: string;
  /** Path under `/api/internal` for the achievement log (POST). */
  stepsPath: string;
  /** Overrides the two paths above. For harnesses and tests. */
  transport?: TourTransport;
  chapters: readonly TourChapter[];
  steps: readonly TourStep[];
  /**
   * Chapters the host knows have nothing to point at, dropped whole with their
   * `unavailableNote` handed to the next surviving step. The engine stays
   * domain-free: *why* a chapter is unavailable is the host's business.
   */
  unavailableChapters?: readonly string[];
  cursor: TourCursor;
  /**
   * The version of the row `cursor` was read from, in the same ordering as
   * `TourStateWire["updatedAt"]`.
   *
   * A server render is a *snapshot*, and snapshots arrive late: a
   * `router.refresh()` fired by an unrelated mutation re-renders this host with
   * a cursor read before the tour's own advance committed. The engine adopts a
   * cursor from a new render only when the render is newer than everything it
   * has already applied — otherwise a stale payload rewinds the player to a
   * step they finished a minute ago. Omit it and every render is trusted, which
   * is right for a harness with one writer.
   */
  updatedAt?: string | null | undefined;
  completed: readonly string[];
  questsDone: readonly string[];
  world: TourWorld;
  /** Substituted into `:token` segments of every step route. */
  context: Readonly<Record<string, string>>;
};

/** What the engine sends the host when the tour reaches its end. */
export type TourCompletion = { via: "finished" | "skipped" };
