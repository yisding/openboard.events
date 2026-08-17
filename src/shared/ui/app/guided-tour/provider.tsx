"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { popoverPosition } from "@/shared/ui/app/popover-position";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { emojiRain } from "@/shared/ui/emoji-rain";
import { useToast } from "@/shared/ui/toast";
import { portalTargetFor, tourIdPresent, useMeasureEffect, useTourAnchor } from "./anchor";
import { TourCoach, TourPill, type TourCoachMode } from "./coach";
import { useMobileTourViewport } from "./media";
import { readTourMirror, writeTourMirror } from "./mirror";
import {
  ANCHOR_SETTLE_MS,
  HINT_REVEAL_MS,
  OBSERVE_DWELL_MS,
  POLL_BASE_MS,
  POLL_HARD_STOP_MS,
  arcSteps,
  chapterStepIds,
  skipNotices,
  nextArcStepId,
  nextChapterStepId,
  nextPollIntervalMs,
  objectiveSatisfied,
  resolveTourPath,
  resolveVisibleStepId,
  type TourLocation,
  tourHref,
  tourProgress,
  visibleTourSteps,
  worldChanged,
} from "./objectives";
import { onTourSignal } from "./signals";
import { TourScrim } from "./scrim";
import type { TourBootstrap, TourCompletion, TourCursor, TourStateWire, TourStatus, TourStep, TourStepOutcome, TourTransport, TourWorld } from "./types";

/**
 * The tour engine.
 *
 * Its one opinion, and the reason it is worth its weight: **objectives are
 * verified against server world-state, not against clicks.** Nothing here
 * scripts a click, subscribes to a feature's success handler or knows what a
 * submission is. It asks one endpoint "has the world reached the objective
 * yet", which is why completing a step in a second tab, on a phone, after a
 * refresh or by a route nobody anticipated all count.
 *
 * Everything else follows from that: no coupling from features into the tour,
 * no state to lose, and a spotlight the player can simply ignore.
 */

const COACH_WIDTH = 320;
const COACH_CLEARANCE = 260;

const tourWorldValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

/**
 * The wire shape the engine needs from whichever route owns the tour. It is
 * deliberately permissive about extra keys and about anything the host has not
 * written yet: a tour that hard-fails on an unfamiliar field would take the
 * whole admin shell down with it.
 */
const tourStateSchema = z.object({
  chapter: z.string(),
  stepId: z.string(),
  status: z.enum(["not_started", "active", "paused", "complete"]),
  updatedAt: z.string().nullish(),
  armedStepId: z.string().nullish(),
  armedBaseline: z.record(z.string(), tourWorldValueSchema).nullish(),
  completed: z.array(z.string()).default([]),
  questsDone: z.array(z.string()).default([]),
  world: z.record(z.string(), tourWorldValueSchema).default({}),
});

const recordedSchema = z.object({ recorded: z.boolean() });

/** The engine's default transport: the repo's own API client, nothing more. */
function httpTransport(statePath: string, stepsPath: string): TourTransport {
  return {
    read: () => api(statePath, tourStateSchema),
    patch: (patch) => api(statePath, tourStateSchema, { method: "PATCH", body: patch }),
    record: async (stepId, outcome) => {
      await api(stepsPath, recordedSchema, { body: { stepId, outcome } });
    },
  };
}

export const tourKeys = {
  all: (scopeId: string) => ["guided-tour", scopeId] as const,
  state: (scopeId: string) => ["guided-tour", scopeId, "state"] as const,
};

type StepRuntime = {
  /** The coach card's own control was used — the only `via: "self"` evidence. */
  selfDone: boolean;
  /** An `observe` anchor has been on screen long enough to count as looked at. */
  dwellDone: boolean;
  hintVisible: boolean;
  /** Ten minutes on one step. A tutorial that hangs is worse than one that yields. */
  stalled: boolean;
  pollMs: number;
};

const FRESH_RUNTIME: StepRuntime = { selfDone: false, dwellDone: false, hintVisible: false, stalled: false, pollMs: POLL_BASE_MS };

function union(current: readonly string[], incoming: readonly string[]): readonly string[] {
  const missing = incoming.filter((id) => !current.includes(id));
  return missing.length === 0 ? current : [...current, ...missing];
}

/**
 * Whether a step's href is somewhere the browser already is.
 *
 * Extra parameters on the *current* URL are allowed, exactly as `routeMatches`
 * allows them when judging an objective, and for the same reason: a filter the
 * organizer put there is theirs. Under exact-set equality, a step whose route
 * is a bare `/speakers` decided that `/speakers?missing=either` was somewhere
 * else — so it labelled the page "That control isn't on this screen right now"
 * and offered a trip whose only effect was to strip the filter the *previous*
 * step had just asked them to apply.
 *
 * The predicate `navigate` bails on is still this one, so a control offered on
 * the strength of it cannot turn out to be a no-op. Read from the router's
 * reactive values rather than `window.location`, which does not re-render
 * anything when it changes.
 */
function isCurrentLocation(href: string, location: TourLocation): boolean {
  const [path = "", search = ""] = href.split("?");
  if (path !== location.pathname) return false;
  return [...new URLSearchParams(search).entries()].every(([key, value]) => location.query[key] === value);
}


/**
 * Mounts the tour beside the shell's children.
 *
 * `null` is the answer for a real event, for a reviewer, and for anyone the
 * host decided should not see a tutorial — and it renders the children
 * untouched, with no context, no listeners and no bytes beyond this function.
 */
export function GuidedTourMount({ bootstrap, onComplete, onStatusChange, children }: {
  bootstrap?: TourBootstrap | null;
  /**
   * Fired once when the tour ends, either way. The host decides what a
   * finished tour means: recording a milestone, retiring the shell's ambient
   * hints (the player has now been personally shown the event switcher, so
   * beaconing it afterwards is condescending), swapping the resume pill for a
   * quest log. None of that is the engine's business.
   */
  onComplete?: (completion: TourCompletion) => void;
  /**
   * Fired whenever the tour's status changes in place — pausing, resuming,
   * starting, finishing.
   *
   * The host's own copy of the status came from a server render, and a soft
   * navigation reuses that render for the life of the session. Without this,
   * a host that gates anything on "is the tour running" — the command
   * palette's Resume entry, ambient hints — stays frozen on whatever was true
   * when the page loaded, and the palette drops Resume at exactly the moment
   * the player needs it.
   *
   * The live cursor travels with it for the same reason: a host offering
   * *"Resume the guided tour · Chapter 1"* to somebody who paused in Chapter 8
   * is not offering to resume, it is offering to lose seven chapters.
   */
  onStatusChange?: (status: TourStatus, cursor: TourCursor) => void;
  children?: ReactNode;
}) {
  if (!bootstrap) return <>{children}</>;
  return <>
    {children}
    {/* The tour layer is a sibling, not an ancestor: its query cache must not
        become the cache the page's own QueryBoundaries inherit. Suspense is
        what lets `useSearchParams` live in a statically-rendered route. */}
    <QueryBoundary>
      <Suspense fallback={null}>
        <GuidedTourLayer
          bootstrap={bootstrap}
          {...(onComplete ? { onComplete } : {})}
          {...(onStatusChange ? { onStatusChange } : {})}
        />
      </Suspense>
    </QueryBoundary>
  </>;
}

function GuidedTourLayer({ bootstrap, onComplete, onStatusChange }: {
  bootstrap: TourBootstrap;
  onComplete?: (completion: TourCompletion) => void;
  onStatusChange?: (status: TourStatus, cursor: TourCursor) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const { toast } = useToast();
  const mobile = useMobileTourViewport();

  const unavailableChapters = bootstrap.unavailableChapters;
  const { steps, notices } = useMemo(() => {
    const visible = visibleTourSteps(bootstrap.steps, { mobile, ...(unavailableChapters ? { unavailableChapters } : {}) });
    return {
      steps: visible.steps,
      notices: skipNotices(bootstrap.steps, visible.steps, bootstrap.chapters, unavailableChapters ?? []),
    };
  }, [bootstrap.steps, bootstrap.chapters, mobile, unavailableChapters]);

  const [cursor, setCursor] = useState<TourCursor>(() => bootstrap.cursor);
  const [completed, setCompleted] = useState<readonly string[]>(bootstrap.completed);
  const [questsDone, setQuestsDone] = useState<readonly string[]>(bootstrap.questsDone);
  const [world, setWorld] = useState<TourWorld>(bootstrap.world);
  const [baseline, setBaseline] = useState<TourWorld | null>(bootstrap.cursor.armedBaseline ?? null);
  const [runtime, setRuntime] = useState<StepRuntime>(FRESH_RUNTIME);
  const [celebrating, setCelebrating] = useState(false);
  const [domPresent, setDomPresent] = useState(false);
  const [pillHidden, setPillHidden] = useState(false);

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const armedAtRef = useRef(Date.now());
  const worldRef = useRef(world);
  /**
   * The cursor as the *server* last stated it: the bootstrap this layer
   * mounted with, then every patch reply, conflict re-read and poll.
   */
  const serverCursorRef = useRef<{ chapter: string; stepId: string; status: TourStatus }>({
    chapter: bootstrap.cursor.chapter,
    stepId: bootstrap.cursor.stepId,
    status: bootstrap.cursor.status,
  });
  /**
   * The newest row version this layer has seen, from any source: the bootstrap
   * it mounted with, every patch reply, every conflict re-read, every poll.
   *
   * It exists to answer one question the cursor alone cannot — *is this payload
   * newer than what I already know?* A host that supplies no version leaves
   * this `null` for the life of the session and the comparison stands down.
   */
  const appliedVersionRef = useRef<string | null>(bootstrap.updatedAt ?? null);
  /** Cursor writes still waiting for an answer. */
  const pendingWritesRef = useRef(0);
  /** Where the golden path was when the player stepped out into a side quest. */
  const arcReturnRef = useRef<string | null>(null);

  // Never `steps[0]`. A cursor naming a step this viewport dropped resolves
  // *forward* through the full script — see `resolveVisibleStepId` — so
  // resuming a laptop tour on a phone skips ahead with the chapter's apology
  // attached, instead of silently restarting at the cold open and then writing
  // that restart back to the server on the next advance.
  const resolvedStepId = useMemo(
    () => resolveVisibleStepId(bootstrap.steps, steps, cursor.stepId, completed),
    [bootstrap.steps, steps, cursor.stepId, completed],
  );
  const step: TourStep | null = useMemo(
    () => steps.find((candidate) => candidate.id === resolvedStepId) ?? null,
    [steps, resolvedStepId],
  );
  const sideQuests = useMemo(() => steps.filter((candidate) => candidate.optional === true), [steps]);
  const progress = useMemo(() => tourProgress(bootstrap.chapters, steps, resolvedStepId ?? cursor.stepId), [bootstrap.chapters, steps, resolvedStepId, cursor.stepId]);
  /**
   * Where this step lives, including for the steps that never say.
   *
   * A step with no `route` of its own is deliberately a *stay*: "Confirm the
   * queue" happens in a dialog its chapter already opened, and navigating on
   * entry would close it. The cost was that a player who wandered off — to the
   * dashboard, to another chapter's page — got a card with nothing to offer.
   * No "Take me there", and a notice reading "it appears once you have
   * started" about a control several pages away, which reads as the tutorial
   * having lost the plot. Inheriting the last route the chapter established
   * costs the stay nothing (the href is only consulted once the anchor has
   * timed out) and makes both the notice and the way back honest.
   */
  const stepRoute = useMemo(() => {
    if (!step) return undefined;
    if (step.route) return step.route;
    const index = steps.findIndex((candidate) => candidate.id === step.id);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = steps[cursor];
      // Only within the chapter: a chapter that opens on a route-less step is
      // saying "wherever you are", and borrowing the previous chapter's last
      // page would invent a destination its author never chose.
      if (!candidate || candidate.chapter !== step.chapter) return undefined;
      if (candidate.optional !== true && candidate.route) return candidate.route;
    }
    return undefined;
  }, [step, steps]);

  const running = cursor.status === "active" || cursor.status === "not_started";
  const anchor = useTourAnchor(step?.anchor, running && step?.presentation !== "modal" && step?.presentation !== "modal-wide");

  /* --- persistence ------------------------------------------------------ */

  const transport = useMemo(
    () => bootstrap.transport ?? httpTransport(bootstrap.statePath, bootstrap.stepsPath),
    [bootstrap.transport, bootstrap.statePath, bootstrap.stepsPath],
  );

  const applyServerState = useCallback((state: TourStateWire) => {
    // The achievement log is append-only, so the two lists are merged rather
    // than replaced: a response that raced the POST recording the step the
    // player just finished must not un-finish it.
    setCompleted((current) => union(current, state.completed));
    setQuestsDone((current) => union(current, state.questsDone));
    setWorld(state.world);
    // A baseline belongs to *one* step. Adopting whatever the row happens to
    // hold would let a reply describing somebody else's armed step re-baseline
    // the step on screen — a second tab arming step 20 makes this tab's next
    // poll measure step 12 against W20, so work the organizer has already done
    // becomes invisible and the objective can never fire. Same shape in one
    // tab: the poll `enabled: armed` fires alongside the arming PATCH, and if
    // it lands second it installs the *previous* step's baseline. Both writers
    // that set an arm (the effect below, the CONFLICT re-read) already pair the
    // two; this one is the outlier.
    if (state.armedBaseline && state.armedStepId === cursorRef.current.armedStepId) setBaseline(state.armedBaseline);
    // Every answer the server gives — a patch reply, a conflict re-read, a
    // poll — restates where the row is. Remembering it is what lets the
    // effect below tell "the route module has re-rendered with a cursor
    // somebody else moved" apart from "the route module has re-rendered".
    serverCursorRef.current = { chapter: state.chapter, stepId: state.stepId, status: state.status };
    // Answers travel forward only. A poll that raced a patch can come back
    // describing the row as it stood before the write, and remembering *its*
    // version would re-open the door to every render older than the write.
    if (state.updatedAt && (appliedVersionRef.current === null || state.updatedAt > appliedVersionRef.current)) {
      appliedVersionRef.current = state.updatedAt;
    }
  }, []);

  const patchCursor = useCallback(async (next: TourCursor, expectedStepId: string) => {
    pendingWritesRef.current += 1;
    try {
      const state = await transport.patch({
        chapter: next.chapter,
        stepId: next.stepId,
        status: next.status,
        expectedStepId,
        // Present means armed; absent releases the arm. Never `null`: the
        // server's patch schema takes these as optional, not nullable, and
        // "no arm" is an omission rather than a value.
        ...(next.armedStepId ? { armedStepId: next.armedStepId } : {}),
        ...(next.armedStepId && next.armedBaseline ? { armedBaseline: next.armedBaseline } : {}),
      });
      applyServerState(state);
    } catch (error) {
      // A lost or rejected write never breaks the tutorial: the cursor lives on
      // in React and in the localStorage mirror, and the next advance re-sends
      // it. A stale CAS means another tab moved first — adopt that, because two
      // tabs disagreeing about the current step is the one state worth healing.
      if (isAppError(error) && error.code === "CONFLICT") {
        try {
          const state = await transport.read();
          applyServerState(state);
          // The arm travels with the cursor. Dropping it here would leave the
          // client believing nothing is armed while the arming effect's deps
          // are all unchanged, so it would never re-fire — a step silently
          // unarmed for the rest of the session, which is exactly the
          // re-baselining the persisted baseline exists to prevent.
          setCursor({
            chapter: state.chapter,
            stepId: state.stepId,
            status: state.status,
            ...(state.armedStepId ? { armedStepId: state.armedStepId } : {}),
            ...(state.armedStepId && state.armedBaseline ? { armedBaseline: state.armedBaseline } : {}),
          });
        } catch {
          // Offline. Keep going locally.
        }
      }
    } finally {
      pendingWritesRef.current -= 1;
    }
  }, [applyServerState, transport]);

  const recordStep = useCallback(async (stepId: string, outcome: TourStepOutcome) => {
    try {
      await transport.record(stepId, outcome);
    } catch {
      // The achievement log is append-only and idempotent; a missed write is
      // recovered by the next read, and never by blocking the player.
    }
  }, [transport]);

  /* --- navigation ------------------------------------------------------- */

  const query = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const location = useMemo(() => ({ pathname, query }), [pathname, query]);
  // Read at call time, so `navigate` — and `goToStep`, `resume` and everything
  // else built on it — keeps one identity for the life of the tour instead of
  // churning on every route change.
  const locationRef = useRef(location);
  locationRef.current = location;

  const navigate = useCallback((href: string) => {
    if (typeof window === "undefined") return;
    // Measured against the *router's* location, through the very predicate
    // that decides whether "Take me there" is offered at all — so a control
    // the coach shows can never turn out to be a no-op.
    //
    // Never `window.location`, which disagrees for exactly as long as a
    // guarded navigation is outstanding: the unsaved-work guard answers the
    // Navigation API's `navigate` event with `intercept()`, and that commits
    // the URL immediately while the router stays put behind "Discard unsaved
    // work?". Decline the prompt and the address bar is left pointing at a
    // page the app never rendered — after which a `window.location` check
    // swallowed every further trip there in silence. That is precisely how a
    // dirty form builder made "Take me there" do nothing at all: no
    // navigation, no prompt, no message.
    if (isCurrentLocation(href, locationRef.current)) return;
    // Mandatory: an unguarded push would put the unsaved-work dialog in a fight
    // with the tour, and the tour would lose in a way that looks like a bug.
    //
    // Deliberately without a `destination` hint. That option asks the guard to
    // compare the target against `window.location` and skip its one-shot
    // allowance when the two match — right for a host action that ends in a
    // real unload, wrong here, because during the desync above it would hand
    // the push straight back to the interceptor and prompt a second time for
    // a move the organizer has already approved.
    runGuarded(() => allowNextNavigation(() => router.push(href)));
  }, [allowNextNavigation, router, runGuarded]);

  const goToStep = useCallback((stepId: string, options: { navigate?: boolean } = {}) => {
    const next = steps.find((candidate) => candidate.id === stepId);
    if (!next) return;
    const previous = cursorRef.current;
    // A world-armed step arms in the *same* write that moves the cursor onto
    // it. Two writes — the move, then the arming effect — race each other over
    // one compare-and-set row: if the arm lands first its predicate names a
    // step the row has not reached yet, the server conflicts, and the recovery
    // rewinds the player a step and leaves the objective unarmed. Folding them
    // makes the transition one statement, and lets the arming effect below
    // short-circuit on the cursor it can already see.
    const armsOnEntry = next.kind === "act" && next.objective?.via === "world";
    const snapshot = worldRef.current;
    const moved: TourCursor = {
      chapter: next.chapter,
      stepId: next.id,
      status: "active",
      ...(armsOnEntry ? { armedStepId: next.id, armedBaseline: snapshot } : {}),
    };
    setCursor(moved);
    setRuntime(FRESH_RUNTIME);
    setCelebrating(false);
    if (armsOnEntry) {
      setBaseline(snapshot);
      armedAtRef.current = Date.now();
    }
    writeTourMirror(bootstrap.scopeId, moved);
    void patchCursor(moved, previous.stepId);
    if (options.navigate !== false && next.route) navigate(tourHref(next.route, bootstrap.context));
  }, [bootstrap.context, bootstrap.scopeId, navigate, patchCursor, steps]);

  const setStatus = useCallback((status: TourStatus) => {
    const previous = cursorRef.current;
    const moved: TourCursor = { ...previous, status };
    setCursor(moved);
    writeTourMirror(bootstrap.scopeId, moved);
    onStatusChange?.(status, moved);
    void patchCursor(moved, previous.stepId);
  }, [bootstrap.scopeId, onStatusChange, patchCursor]);

  /**
   * Adopting a cursor the *route module* re-rendered with.
   *
   * The layer seeds itself from the bootstrap once and then owns the cursor,
   * which is right for its own advances and wrong for every deliberate move
   * made from outside it — the demo ribbon's "Restart tour", a reset, another
   * tab. Those write the row and then ask the page for a fresh render; without
   * this, the layer keeps the cursor it already had, so a restart out of a
   * finished tour leaves the screen exactly as dead as it was and the next
   * advance writes the old position back over the new one.
   *
   * The prop's identity only changes when a new server payload arrives, and a
   * payload rendered while one of this layer's own writes was in flight is
   * stale by construction — hence the guards rather than a value compare
   * alone.
   *
   * The version guard is the one that matters most in the product. "Rendered
   * while a write was in flight" is not the only way a render goes stale: the
   * read happens on the server, the payload arrives whenever the navigation or
   * `router.refresh()` that asked for it finishes, and any mutation on any
   * screen can fire one of those. Publishing a form version, in the middle of
   * Chapter 2, re-rendered the event layout with a cursor read a step and a
   * half ago — so the coach jumped backwards to a card the player had already
   * read, replayed it, and collided with the server (`409`) on the way forward
   * again. Adopting only payloads newer than everything already applied leaves
   * the deliberate moves — restart, reset, a second tab — working exactly as
   * before, because those all write the row first and are therefore newer by
   * construction.
   */
  const serverCursor = bootstrap.cursor;
  const serverCursorVersion = bootstrap.updatedAt ?? null;
  useEffect(() => {
    if (pendingWritesRef.current > 0) return;
    const applied = appliedVersionRef.current;
    if (serverCursorVersion !== null && applied !== null && serverCursorVersion <= applied) return;
    const known = serverCursorRef.current;
    if (serverCursor.chapter === known.chapter
      && serverCursor.stepId === known.stepId
      && serverCursor.status === known.status) return;
    serverCursorRef.current = { chapter: serverCursor.chapter, stepId: serverCursor.stepId, status: serverCursor.status };
    if (serverCursorVersion !== null) appliedVersionRef.current = serverCursorVersion;
    setCursor(serverCursor);
    setBaseline(serverCursor.armedBaseline ?? null);
    setRuntime(FRESH_RUNTIME);
    setCelebrating(false);
    setPillHidden(false);
    // The mirror is a record of where this browser got to, and it has just
    // been overtaken by a decision made somewhere else. Leaving it behind is
    // what would send the next load straight back to the abandoned step.
    writeTourMirror(bootstrap.scopeId, serverCursor);
    onStatusChange?.(serverCursor.status, serverCursor);
  }, [bootstrap.scopeId, onStatusChange, serverCursor, serverCursorVersion]);

  // Adopting the resolution above, once, and healing the server row *forwards*
  // with it. Without the write, the next advance would send the server the
  // step the player never saw as its `expectedStepId`, which the CAS accepts —
  // and the cursor would go backwards on a row that had been ahead.
  useEffect(() => {
    const resolved = resolvedStepId;
    const current = cursorRef.current;
    if (resolved === null || resolved === current.stepId) return;
    const next = steps.find((candidate) => candidate.id === resolved);
    if (!next) return;
    const moved: TourCursor = { chapter: next.chapter, stepId: next.id, status: current.status };
    setCursor(moved);
    writeTourMirror(bootstrap.scopeId, moved);
    void patchCursor(moved, current.stepId);
  }, [bootstrap.scopeId, patchCursor, resolvedStepId, steps]);

  /* --- advancing -------------------------------------------------------- */

  const finish = useCallback((via: TourCompletion["via"]) => {
    setStatus("complete");
    onComplete?.({ via });
    // The end of the script is its own curtain call and does not need a toast
    // on top of it. Leaving early does: it should feel acknowledged, not
    // silently obeyed.
    if (via === "skipped") toast("Tour closed. The demo is yours — nothing in it is read-only.");
  }, [onComplete, setStatus, toast]);

  const leaveStep = useCallback((outcome: TourStepOutcome) => {
    if (!step) return;
    void recordStep(step.id, outcome);
    if (outcome === "completed") {
      if (step.optional === true) setQuestsDone((current) => (current.includes(step.id) ? current : [...current, step.id]));
      else setCompleted((current) => (current.includes(step.id) ? current : [...current, step.id]));
    }
    // A side quest is a detour, not a queue entry: finishing one puts the
    // player back exactly where the arc was, not into the next quest and not
    // back at some earlier step they deliberately skipped.
    let target: string | null;
    if (step.optional === true) {
      target = arcReturnRef.current
        ?? arcSteps(steps).find((candidate) => !completed.includes(candidate.id))?.id
        ?? null;
      arcReturnRef.current = null;
    } else {
      target = nextArcStepId(steps, step.id);
    }
    if (target === null) {
      finish("finished");
      return;
    }
    goToStep(target);
  }, [completed, finish, goToStep, recordStep, step, steps]);

  /**
   * The objective is met. Say so, pay out the reward — and stop.
   *
   * Stopping is the whole point. This used to hand off to a 900 ms timer that
   * advanced on the player's behalf, and the result was a card that told you
   * you had done it and then replaced itself with the next instruction before
   * either could be read. Worse, it did it at the exact moment the player's
   * attention was on the control they had just used, several hundred pixels
   * away from the card. Nothing advances a step now except a press: `settle`
   * puts the card into its finished state and waits there.
   */
  const settleStep = useCallback(() => {
    if (!step || celebrating) return;
    if (step.reward) emojiRain([step.reward.emoji], step.reward.drops ?? 6);
    setCelebrating(true);
  }, [celebrating, step]);

  /**
   * The player pressed the one button that moves the tour on.
   *
   * From a finished objective that is a plain "Next" — the reward has already
   * been paid out and the card has been sitting there being read. From a beat
   * or an `observe`, the press *is* the completion, so the reward (if the step
   * has one) fires on the way out: the emoji rain is an overlay of its own and
   * goes on falling over the next card quite happily.
   */
  const advance = useCallback(() => {
    if (!step) return;
    if (!celebrating && step.reward) emojiRain([step.reward.emoji], step.reward.drops ?? 6);
    leaveStep("completed");
  }, [celebrating, leaveStep, step]);

  const skipChapter = useCallback(() => {
    if (!step) return;
    // A side quest borrows its chapter from wherever it thematically belongs,
    // so "skip this chapter" from inside one would burn a chapter of the
    // golden path the player has not seen — and, because a quest id is not on
    // the arc, would then read as "no chapter after this" and end the tour.
    // Skipping out of a detour just puts them back on the path.
    if (step.optional === true) {
      void recordStep(step.id, "skipped");
      const back = arcReturnRef.current
        ?? arcSteps(steps).find((candidate) => !completed.includes(candidate.id))?.id
        ?? null;
      arcReturnRef.current = null;
      if (back !== null) goToStep(back);
      return;
    }
    for (const id of chapterStepIds(steps, step.chapter)) {
      if (!completed.includes(id)) void recordStep(id, "skipped");
    }
    const target = nextChapterStepId(steps, step.id);
    if (target === null) {
      finish("finished");
      return;
    }
    goToStep(target);
  }, [completed, finish, goToStep, recordStep, step, steps]);

  const pause = useCallback(() => {
    setStatus("paused");
    setPillHidden(false);
    const where = progress.chapterIndex > 0 && progress.chapter
      ? `Paused at Chapter ${progress.chapterIndex} — ${progress.chapter.name}. Pick it up whenever.`
      : "Paused. Pick it up whenever.";
    toast(where);
  }, [progress, setStatus, toast]);

  const resume = useCallback(() => {
    setStatus("active");
    if (step?.route) navigate(tourHref(step.route, bootstrap.context));
  }, [bootstrap.context, navigate, setStatus, step]);


  /* --- objective verification ------------------------------------------ */

  // `via: "dom"` — one MutationObserver over the content region, which is
  // where every lazily-mounted target (drawers, tab panels, query boundaries)
  // eventually lands.
  const domTarget = step?.objective?.via === "dom" ? step.objective.present : null;
  useEffect(() => {
    if (!domTarget || typeof document === "undefined") {
      setDomPresent(false);
      return;
    }
    const root = document.querySelector("#admin-content") ?? document.body;
    const check = () => setDomPresent(tourIdPresent(domTarget, document));
    check();
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tour"] });
    return () => observer.disconnect();
  }, [domTarget]);

  // `observe` — the anchor has to have been on screen, not merely mounted.
  const observeElement = step?.kind === "observe" ? anchor.element : null;
  useEffect(() => {
    if (step?.kind !== "observe") return;
    if (!observeElement || typeof IntersectionObserver !== "function") {
      // No anchor to watch, or a runtime without the observer: dwelling on
      // nothing is satisfied by waiting the same beat.
      const timer = window.setTimeout(() => setRuntime((current) => ({ ...current, dwellDone: true })), OBSERVE_DWELL_MS);
      return () => window.clearTimeout(timer);
    }
    let timer = 0;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && timer === 0) {
        timer = window.setTimeout(() => setRuntime((current) => ({ ...current, dwellDone: true })), OBSERVE_DWELL_MS);
      } else if (!visible && timer !== 0) {
        window.clearTimeout(timer);
        timer = 0;
      }
    }, { threshold: 0.4 });
    observer.observe(observeElement);
    return () => {
      if (timer !== 0) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [observeElement, step?.kind, step?.id]);

  const satisfied = useMemo(() => objectiveSatisfied(step?.objective, {
    location,
    routeContext: bootstrap.context,
    world,
    baseline,
    domPresent,
    selfDone: runtime.selfDone,
  }), [baseline, bootstrap.context, domPresent, location, runtime.selfDone, step?.objective, world]);

  /* --- arming and polling ----------------------------------------------- */

  const worldFact = step?.kind === "act" && step.objective?.via === "world" ? step.objective.fact : null;
  const armed = running && worldFact !== null && !celebrating && !runtime.stalled;

  // Baselines are persisted rather than captured in memory. Without that, a
  // reload while a step is armed re-captures the baseline at the *current*
  // value: an action already taken becomes invisible and has to be redone.
  useEffect(() => {
    if (!armed || !step) return;
    // Only the cursor's own step arms. On the frame before a dropped-step
    // resolution has been adopted the engine is rendering a step the cursor
    // does not name yet, and arming that one would persist a baseline for a
    // step this session is about to leave.
    if (step.id !== cursorRef.current.stepId) return;
    if (cursorRef.current.armedStepId === step.id) {
      setBaseline(cursorRef.current.armedBaseline ?? null);
      return;
    }
    const snapshot = worldRef.current;
    setBaseline(snapshot);
    armedAtRef.current = Date.now();
    const next: TourCursor = { ...cursorRef.current, armedStepId: step.id, armedBaseline: snapshot };
    setCursor(next);
    void patchCursor(next, cursorRef.current.stepId);
  }, [armed, patchCursor, step]);

  const stateQuery = useQuery({
    queryKey: tourKeys.state(bootstrap.scopeId),
    queryFn: () => transport.read(),
    enabled: armed,
    refetchInterval: runtime.pollMs,
    // The default 15 s staleness would swallow the refetch on tab focus, which
    // is precisely the "back from the portal tab, objective already ticked"
    // moment this feature is built around.
    staleTime: 0,
    retry: false,
  });

  const stateData = stateQuery.data;
  useEffect(() => {
    if (!stateData) return;
    const changed = worldChanged(worldRef.current, stateData.world);
    worldRef.current = stateData.world;
    applyServerState(stateData);
    setRuntime((current) => {
      const next = nextPollIntervalMs(current.pollMs, { armedForMs: Date.now() - armedAtRef.current, changed });
      return next === current.pollMs ? current : { ...current, pollMs: next };
    });
  }, [applyServerState, stateData, stateQuery.dataUpdatedAt]);

  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  // The two latency shortcuts. They shave a poll interval off the two most
  // pressed objectives and are never the authority: delete every emit and the
  // tour still completes, one beat later.
  const refetchState = stateQuery.refetch;
  useEffect(() => {
    if (!armed) return;
    return onTourSignal(() => { void refetchState(); });
  }, [armed, refetchState]);

  // The ten-minute escape hatch, for *every* act step and not only the polled
  // ones. `armed` is false whenever the objective is `route`, `dom` or `self`,
  // which is half the act steps in a real script — gated on it, `stalled` never
  // arrives, `showAdvance` stays false, and an objective whose target never
  // mounts leaves "Waiting for you…" on screen with "Skip this" as the only
  // exit, recording a skip for work the player could not have done.
  useEffect(() => {
    if (!running || celebrating || step?.kind !== "act" || runtime.stalled) return;
    const timer = window.setTimeout(() => setRuntime((current) => ({ ...current, stalled: true })), POLL_HARD_STOP_MS);
    return () => window.clearTimeout(timer);
  }, [celebrating, running, runtime.stalled, step?.id, step?.kind]);

  useEffect(() => {
    if (!running || !step?.hint || runtime.hintVisible || satisfied) return;
    const timer = window.setTimeout(() => setRuntime((current) => ({ ...current, hintVisible: true })), HINT_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [running, runtime.hintVisible, satisfied, step?.hint, step?.id]);

  /**
   * A quarter of a second of patience for an anchor that arrives late.
   *
   * The card is positioned from the anchor's rectangle, so a card drawn before
   * the anchor resolves is a card drawn in the middle of the screen that then
   * jumps to the control — with the spotlight blinking on a frame behind it.
   * An anchor already on the page now resolves before the first paint and this
   * expires unused; one that needs a navigation, a drawer or a query boundary
   * gets `ANCHOR_SETTLE_MS` before the card gives up and appears centred
   * anyway. Keyed on the step, so every step gets its own grace.
   *
   * **A layout effect, deliberately.** `useTourAnchor` clears its element and
   * rectangle before paint, so on a step change there is a render where the
   * rect is already `null` and this flag is still `true` from the step
   * before — the card centred and visible, carrying the new step's copy,
   * which is the exact frame this exists to prevent. Whether that render is
   * ever *painted* comes down to React choosing to flush passive effects
   * before paint. It does today for a step change driven by a click, which is
   * how every advance now happens, and measured in Chrome the bad frame does
   * not appear either way. It is not a guarantee, it is not true for the step
   * changes that arrive from a timer or an adopted server cursor, and the
   * cost of not relying on it is one word: registered after `useTourAnchor`'s
   * hooks, this reset lands in the same pre-paint pass as the clear.
   */
  const [anchorSettled, setAnchorSettled] = useState(false);
  useMeasureEffect(() => {
    setAnchorSettled(false);
    const timer = window.setTimeout(() => setAnchorSettled(true), ANCHOR_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [step?.id]);

  /**
   * A modal step pays its reward on arrival, not on the way out.
   *
   * Every other rewarded step pays out while the surface it belongs to is
   * still on screen: an `act` step's burst fires the moment its objective is
   * met, over the card that is about to say so. A `beat` fires on the press
   * that leaves it, which is right when the confetti's job is to carry over
   * into the next card — and exactly wrong for the two beats that own the
   * screen. The curtain call *is* the payoff, and firing on "Keep playing in
   * the demo" meant its 28 drops only ever rained over the dashboard behind
   * it, celebrating the moment after the moment.
   *
   * The reward's *line* is already shown on arrival — the modal renders
   * `step.reward` the frame it opens — so this only brings the burst into step
   * with the sentence it illustrates. `celebrating` is what stops `advance`
   * paying it a second time, and it is reset by every move onto a step, so a
   * player who comes back to the finale gets their confetti again.
   */
  useEffect(() => {
    if (!running || celebrating || !step?.reward) return;
    if (step.presentation !== "modal" && step.presentation !== "modal-wide") return;
    emojiRain([step.reward.emoji], step.reward.drops ?? 6);
    setCelebrating(true);
  }, [celebrating, running, step]);

  /* --- advance on satisfaction ------------------------------------------ */

  // Held in a ref so the satisfaction effect fires once per satisfaction, not
  // once per re-render of the callback it happens to close over.
  const settleRef = useRef(settleStep);
  useEffect(() => {
    settleRef.current = settleStep;
  }, [settleStep]);
  useEffect(() => {
    if (!running || !satisfied || celebrating) return;
    if (step?.kind !== "act") return;
    settleRef.current();
  }, [celebrating, running, satisfied, step?.kind]);

  /* --- keyboard --------------------------------------------------------- */

  useEffect(() => {
    if (!running) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Something that runs *before* this listener has already answered the
      // key — which in practice means handlers in the React tree, since a peer
      // on `document` registers when it opens, i.e. after this one was added
      // at mount, and its `preventDefault` lands too late for this flag to
      // see. The palette is the case that matters here, and the check below is
      // not enough for it on its own: it closes itself on Escape —
      // `preventDefault`, `stopPropagation`, `onClose` — and React flushes
      // that discrete update synchronously, so by the time this
      // document-level listener runs the `<dialog>` it should have deferred to
      // is already shut. The tour then paused itself on a keystroke the player
      // spent dismissing something else, and said nothing about it.
      if (event.defaultPrevented) return;
      // A drawer, modal or palette owns Escape while it is open; the tour is
      // the outermost thing on screen and takes the key only when nothing else
      // has claimed it.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      pause();
    }
    // Bubble, deliberately: the two guards above are what defer to whoever
    // owns the key, and they can only read a `preventDefault` that has already
    // happened. Capturing would take Escape ahead of every popover that is not
    // a `<dialog>` and pause the tour out from under it.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pause, running]);

  // A tour that has been rendered has started. Recording it here rather than
  // waiting for the first advance is what makes "declined at the cold open"
  // resumable instead of indistinguishable from never having looked.
  useEffect(() => {
    if (cursorRef.current.status === "not_started") setStatus("active");
  }, [setStatus]);

  /* --- the optimistic mirror -------------------------------------------- */

  useEffect(() => {
    const mirror = readTourMirror(bootstrap.scopeId);
    if (!mirror || bootstrap.cursor.status !== "active") return;
    // Indexed against the *full* script, not the viewport's filtered view: an
    // id this viewport dropped is absent from the filtered list and compares
    // as -1, which would make every comparison against it meaningless.
    const order = bootstrap.steps.map((candidate) => candidate.id);
    // Adopt the mirror only when it is *ahead* of the server: that is the
    // advance whose PATCH was still in flight when the tab reloaded. Behind or
    // unknown, the database wins — cross-device resume is the whole point.
    if (order.indexOf(mirror.stepId) > order.indexOf(bootstrap.cursor.stepId)) {
      // The mirror's *status* is adopted with its step, never overwritten with
      // "active". A mirror recording a finished tour is the same lost write as
      // one recording an advance, and forcing it back to active restarts the
      // tutorial on its last step — which for the curtain call is a modal
      // `<dialog>`. That dialog owns the top layer, so everything behind it
      // (the demo ribbon's Reset and Delete included) stops taking clicks and
      // drops out of the accessibility tree, on every load, for good.
      setCursor({ chapter: mirror.chapter, stepId: mirror.stepId, status: mirror.status });
    }
    // Deliberately mount-only: this reconciles one reload, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hiding the pill means "not on this screen", never "not again": design §3.6
  // promises a way back in on every page of the demo, and a dismissal that
  // outlived the page would leave a paused tutorial with no affordance
  // anywhere until the organizer thought to reload.
  useEffect(() => {
    setPillHidden(false);
  }, [pathname]);

  /* --- rendering -------------------------------------------------------- */

  // A running tour always has a card to draw: a cursor naming a step this
  // build lost resolves forward to the next unfinished objective rather than
  // to nothing — see `resolveVisibleStepId`. `null` here means the host handed
  // the engine no steps at all, which is the one case with nothing to offer.
  if (!step || cursor.status === "complete") return null;

  if (cursor.status === "paused") {
    if (pillHidden) return null;
    return <TourPill progress={progress} onResume={resume} onDismiss={() => setPillHidden(true)} />;
  }

  const inDialog = anchor.element?.closest("dialog[open]") ?? null;
  const spotlit = !mobile
    && step.spotlight !== false
    && step.kind !== "beat"
    && inDialog === null
    && anchor.rect !== null;
  const position = !mobile && anchor.rect && typeof window !== "undefined"
    ? popoverPosition(step.placement ?? "bottom", anchor.rect, { width: window.innerWidth, height: window.innerHeight }, { width: COACH_WIDTH, clearance: COACH_CLEARANCE })
    : null;
  // An anchored card with no anchor yet is a card in the wrong place. Hold it
  // for `ANCHOR_SETTLE_MS` rather than drawing it centred and moving it — see
  // the `anchorSettled` effect. A modal owns the screen and never had an
  // anchor to wait for; a sheet on mobile is bottom-docked and never moves.
  const settling = !anchorSettled
    && !mobile
    && step.presentation !== "modal"
    && step.presentation !== "modal-wide"
    && step.anchor !== undefined
    && step.anchor.kind !== "none"
    && anchor.rect === null
    && anchor.status !== "missing";

  const mode: TourCoachMode = celebrating
    ? "celebrating"
    : step.kind === "act"
      ? (runtime.stalled ? "stalled" : "waiting")
      : step.kind === "observe" && !runtime.dwellDone
        ? "waiting"
        : "ready";

  const anchorless = step.anchor !== undefined && step.anchor.kind !== "none" && anchor.status === "missing";
  const takeMeThereHref = stepRoute ? tourHref(stepRoute, bootstrap.context) : null;
  // Offered only when it is actually a trip. The tour navigates to `step.route`
  // on entry, so by the time the anchor times out the player is almost always
  // already there — and `navigate` returns without pushing for the URL the
  // browser is on, which made the button render and do nothing at all.
  const elsewhere = takeMeThereHref !== null && !isCurrentLocation(takeMeThereHref, location);
  /**
   * What the card says when it has nothing to point at.
   *
   * Both lines are about the *spotlight*, not about the step, and both used to
   * read as though they were about the step. "Nothing to point at yet — it
   * appears once you have started. The step still counts" made an organizer
   * hunt for an "it" the sentence never named and then wonder what "still
   * counts" was conceding. What is actually true is narrower and much less
   * alarming: the control this step is about does not exist on screen *yet*,
   * because making it exist is the first half of the instruction directly
   * above — the workshop question appears once Format is Workshop, the accept
   * queue's action bar appears once a row is ticked. So say that, and say
   * nothing about counting, which was never in doubt.
   */
  const notice = notices[step.id] ?? (!anchorless
    ? null
    : elsewhere
      ? "The control for this step is on another screen. Take me there, or do it your own way — either finishes the step."
      : "No spotlight yet: the control appears once you start the step above.");

  /**
   * The finale's scoreboard.
   *
   * Keyed off the presentation rather than off any step id: `modal-wide` is
   * the shape a script reserves for its curtain call, and the engine stays
   * domain-free. Counted from the achievement log, so a skipped objective is
   * honestly missing from the total rather than quietly rounded up.
   */
  const recap = step.presentation === "modal-wide" ? {
    objectives: arcSteps(steps).filter((candidate) => completed.includes(candidate.id)).length,
    objectiveCount: arcSteps(steps).length,
    quests: questsDone.length,
    questCount: sideQuests.length,
  } : null;

  return <>
    {spotlit && <TourScrim rect={anchor.rect} />}
    <TourCoach
      step={step}
      progress={progress}
      position={position}
      container={portalTargetFor(anchor.element)}
      settling={settling}
      mode={mode}
      notice={notice}
      hintVisible={runtime.hintVisible}
      mobile={mobile}
      sideQuests={sideQuests}
      questsDone={questsDone}
      recap={recap}
      onContinue={advance}
      onDecline={step.declineLabel ? pause : null}
      onAction={step.action ? () => {
        const action = step.action;
        if (!action) return;
        setRuntime((current) => ({ ...current, selfDone: true }));
        // Through the same `:token` substitution every other navigation in
        // this file uses. An action href is authored against the script's
        // context (`/organizations/:organizationId/…`), so navigating it raw
        // would land the organizer on a literal colon and look exactly like a
        // broken product. Query strings survive: the token pattern only
        // matches `:name`.
        const href = resolveTourPath(action.href, bootstrap.context);
        if (action.newTab) window.open(href, "_blank", "noopener,noreferrer");
        else navigate(href);
      } : null}
      onShowHint={() => setRuntime((current) => ({ ...current, hintVisible: true }))}
      onSkipStep={() => leaveStep("skipped")}
      onSkipChapter={skipChapter}
      onFinish={() => finish("skipped")}
      onPause={pause}
      onSelectQuest={(stepId) => {
        if (step.optional !== true) arcReturnRef.current = step.id;
        goToStep(stepId);
      }}
      onTakeMeThere={anchorless && elsewhere && takeMeThereHref ? () => navigate(takeMeThereHref) : null}
    />
  </>;
}
