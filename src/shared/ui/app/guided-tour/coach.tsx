"use client";

import { ExternalLink, GripVertical, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { Button, Modal, ProgressBar } from "@/shared/ui/ui-kit";
import { useMeasureEffect } from "./anchor";
import type { TourProgress } from "./objectives";
import type { TourStep } from "./types";

/**
 * The coach card — the tour's one piece of chrome.
 *
 * It is deliberately not a modal: it never traps focus, never blocks the page
 * underneath, and never asks a confirmation question. Pausing costs one
 * keystroke and no dialog, because pausing has no consequences and a
 * confirmation for a consequence-free action is pure friction.
 *
 * Three kinds of step, three shapes:
 *   - `beat` narrates and offers Continue.
 *   - `observe` says "Got it", with "Take a look…" alongside it until the
 *     anchor has been on screen long enough to count as looked at.
 *   - `act` offers no way forward until its objective is met — a pulsing dot
 *     and an objective. It is the default, and the ratio of `act` to
 *     everything else is what makes this a tutorial rather than a slideshow.
 *
 * **The player advances; the tour never does it for them.** Every step ends on
 * a press. An `act` step whose objective has just been satisfied says so, shows
 * what it earned, and then waits — because the alternative, which is what this
 * shipped as, is a card that congratulates you and replaces itself with the
 * next one before you have finished reading either.
 *
 * **And the card is the player's to move.** A tutorial that asks you to drag a
 * session onto the grid and then parks itself over the grid is asking for
 * something it is preventing, and no amount of placement arithmetic can rule
 * that out for a card of unknown height on a page of unknown layout. So the
 * header is a grab handle: drag it, or nudge it with the arrow keys, and the
 * card gets out of the way. The displacement lasts as long as the step, since
 * the next card is drawn against a different control and would otherwise
 * inherit an offset that was never about it.
 */

export type TourCoachMode = "waiting" | "ready" | "celebrating" | "stalled";

export type TourCoachProps = {
  step: TourStep;
  progress: TourProgress;
  /** Fixed-position style from the shared popover geometry; null centres the card. */
  position: CSSProperties | null;
  /**
   * `document.body`, or the open `<dialog>` the anchor lives inside — where
   * the card goes when nothing is holding the page hostage. A modal dialog
   * opening on top of it overrides this; see `useCardHost`.
   */
  container: HTMLElement | null;
  /**
   * The anchor has not resolved yet and the engine is still waiting for it.
   * The card renders — it keeps its place in the tree, its focus and its
   * entrance — but stays invisible rather than being drawn centred and then
   * moved to the control a frame later.
   */
  settling?: boolean;
  mode: TourCoachMode;
  /** An honest line about something the engine had to do: a dropped chapter, a missing anchor. */
  notice: string | null;
  hintVisible: boolean;
  mobile: boolean;
  sideQuests: readonly TourStep[];
  questsDone: readonly string[];
  /**
   * What the player actually did, counted. Supplied for the finale — the one
   * step wide enough to own the screen — because a curtain call that says
   * "you just ran a conference" and then shows no evidence is a compliment,
   * and the evidence is the argument.
   */
  recap: { objectives: number; objectiveCount: number; quests: number; questCount: number } | null;
  onContinue: () => void;
  onDecline: (() => void) | null;
  onAction: (() => void) | null;
  onShowHint: () => void;
  onSkipStep: () => void;
  onSkipChapter: () => void;
  onFinish: () => void;
  onPause: () => void;
  onSelectQuest: (stepId: string) => void;
  /** Offered when the anchor never mounted: put the player where the step lives. */
  onTakeMeThere: (() => void) | null;
};

/** How far one arrow key moves the card, in CSS pixels. */
const NUDGE_PX = 24;
/** How close to the viewport edge a moved card is allowed to get. */
const DRAG_MARGIN = 12;

type Offset = { x: number; y: number };
const NO_OFFSET: Offset = { x: 0, y: 0 };

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Keeps a moved card on screen. `rect` is where the card is right now and
 * `base` the offset that put it there, so the same arithmetic serves a pointer
 * drag and an arrow key — and a card can never be shoved somewhere it cannot
 * be read or dragged back from.
 */
function clampOffset(next: Offset, base: Offset, rect: { top: number; left: number; width: number; height: number }): Offset {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  return {
    x: clamp(next.x, base.x + DRAG_MARGIN - rect.left, base.x + viewportWidth - DRAG_MARGIN - rect.width - rect.left),
    y: clamp(next.y, base.y + DRAG_MARGIN - rect.top, base.y + viewportHeight - DRAG_MARGIN - rect.height - rect.top),
  };
}

type CardDrag = {
  offset: Offset;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

function useCardDrag(stepId: string, cardRef: { current: HTMLDivElement | null }): CardDrag {
  // Reset during render rather than in an effect: a card that wore the
  // previous step's displacement for a frame would visibly slide into place,
  // which is the flicker this component spent a release removing.
  const [moved, setMoved] = useState<{ stepId: string; offset: Offset }>({ stepId, offset: NO_OFFSET });
  const [dragging, setDragging] = useState(false);
  const offset = moved.stepId === stepId ? moved.offset : NO_OFFSET;
  /** Detaches the window listeners of a drag in flight — on drop, and on unmount. */
  const stopRef = useRef<() => void>(() => undefined);
  useEffect(() => () => stopRef.current(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Pause is a button in the drag handle, and pressing it must stay a press:
    // a primary button only, and never one that started on the X.
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest("button.tour-coach-close")) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const base = offset;
    const startX = event.clientX;
    const startY = event.clientY;
    // Window listeners rather than pointer capture: the pointer leaves a
    // 320px card almost immediately on any real drag, and capture is the one
    // part of the pointer API that is patchy across the browsers this ships to.
    const onMove = (move: PointerEvent) => {
      setMoved({ stepId, offset: clampOffset({ x: base.x + move.clientX - startX, y: base.y + move.clientY - startY }, base, rect) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stopRef.current = () => undefined;
      setDragging(false);
    };
    stopRef.current();
    stopRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    setDragging(true);
    // Otherwise the drag selects the card's own copy as it goes.
    event.preventDefault();
  }, [cardRef, offset, stepId]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const delta = event.key === "ArrowLeft" ? { x: -NUDGE_PX, y: 0 }
      : event.key === "ArrowRight" ? { x: NUDGE_PX, y: 0 }
        : event.key === "ArrowUp" ? { x: 0, y: -NUDGE_PX }
          : event.key === "ArrowDown" ? { x: 0, y: NUDGE_PX }
            : null;
    if (!delta) return;
    const card = cardRef.current;
    if (!card) return;
    // Dragging with a keyboard is the whole reason the grip is a button: the
    // player who most needs the card out of the way may have no pointer at all.
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    setMoved((current) => {
      const base = current.stepId === stepId ? current.offset : NO_OFFSET;
      return { stepId, offset: clampOffset({ x: base.x + delta.x, y: base.y + delta.y }, base, rect) };
    });
  }, [cardRef, stepId]);

  return { offset, dragging, onPointerDown, onKeyDown };
}

/**
 * Put `node` inside `host`, keeping the node the browser already has.
 *
 * `moveBefore` is the same move without the teardown — the state-preserving
 * atomic move, which keeps CSS animations running and focus where it is. It is
 * recent (Chrome 133), it throws rather than degrading, and it cannot help a
 * node that is already out of the document, which is where this one is every
 * time a dialog unmounts around it. So `appendChild` stands behind it, and
 * everything held in the node's own subtree — an expanded quest tray, a scroll
 * position, React's own state — survives either way, which is the point.
 */
function moveInto(host: HTMLElement, node: HTMLElement): void {
  if (node.parentNode === host) return;
  const move = (host as HTMLElement & { moveBefore?: (moved: Node, child: Node | null) => void }).moveBefore;
  if (typeof move === "function" && node.isConnected && node.ownerDocument === host.ownerDocument) {
    try {
      move.call(host, node, null);
      return;
    } catch {
      // Not movable in place — fall through and re-insert it.
    }
  }
  // A removal takes the focus with it, and `appendChild` is a removal and an
  // insertion. If the player was on the grab handle — arrow-keying the card off
  // the control they are being asked to use — this move has to hand it back.
  const focused = node.contains(node.ownerDocument.activeElement) ? node.ownerDocument.activeElement : null;
  host.appendChild(node);
  // Only if nothing else has claimed it in the meantime. The usual reason the
  // card moves at all is a modal opening, and `showModal()` has already put the
  // focus where that dialog wants it.
  if (focused instanceof HTMLElement && node.ownerDocument.activeElement === node.ownerDocument.body) {
    focused.focus({ preventScroll: true });
  }
  // Re-inserting an element replays its CSS animations from zero. Every
  // animation running on the card a moment after this line is therefore one
  // this move just restarted — and nothing about the card is new: same node,
  // same step, same place on screen, so its entrance has no business playing
  // again. Send them to their end instead. The hint pulse loops forever and has
  // no end to be sent to; a restart there is a ripple out of phase, which is
  // nothing anyone sees. (`getAnimations` belongs to a browser with a timeline;
  // the DOM the tests run in has neither, and nothing to replay either.)
  if (typeof node.getAnimations !== "function") return;
  for (const animation of node.getAnimations({ subtree: true })) {
    if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? Infinity))) animation.finish();
  }
}

/**
 * Where the card has to live to stay usable: **inside** whatever modal
 * `<dialog>` is on top of the page, and `document.body` when none is.
 *
 * A modal dialog lives in the top layer, which paints above every z-index
 * there is, dims everything behind its `::backdrop` and — the part that
 * actually hurts — makes everything it does not contain inert: no pointer
 * events, no focus, out of the accessibility tree. The step that says "press
 * ⌘K" therefore lost its own card the moment the player did as they were told,
 * blurred and unclickable behind the command palette.
 *
 * This shipped as a `popover="manual"` raised into the top layer *after* the
 * dialog, on the theory that a later top-layer entry escapes the earlier one's
 * inertness. It does not — measured in Chrome, a popover raised over an open
 * modal dialog paints on top and is still inert: no `pointerdown`, no click,
 * `focus()` a no-op. So the card looked fixed while every button on it,
 * including the grab handle the player needs to drag it off the control they
 * are being asked to use, was dead. Inertness has exactly one exemption and it
 * is the dialog's own subtree, so that is where the card goes.
 *
 * Which dialog, when several are open, is not a question the DOM will answer:
 * only the newest modal is interactive and document order says nothing about
 * which that is. So the open ones are remembered in the order they opened —
 * that being top-layer order — and the card rides the last of them.
 *
 * Every `<dialog>` in this app opens with `showModal()`, so `dialog[open]` is
 * the whole test. The `:modal` pseudo-class would be the precise one, and it
 * is not worth it: engines disagree about it, and a card that took a wrong
 * answer would either sit inside a harmless non-modal dialog or be stranded
 * behind a modal one — and only the second failure is one the player feels.
 *
 * **The card is moved, never re-created.** A React portal whose container
 * changes is not moved: the old subtree is deleted and an identical one built
 * in the new container. The card is this tour's one `aria-live` region, so a
 * new node is new content — a screen reader re-reads the title, the body, the
 * progress and every button, on every modal open *and* every modal close —
 * and an expanded quest tray snaps shut with it. So React portals into one
 * wrapper element, created here and never replaced, and it is the wrapper that
 * travels.
 *
 * **And it travels imperatively**, from the observer callback rather than
 * through a piece of state. Dialogs in this app unmount when they close, so
 * the card leaves the document with its host; a re-render to put it back is
 * scheduled a task later, which is a frame with no coach card on it. The
 * microtask a `MutationObserver` already runs in is done before the paint.
 */
function useCardHost(fallback: HTMLElement | null): HTMLElement | null {
  // Lazily, so there is nothing to create on the server — where this hook, like
  // the old one, hands back null and the card does not render at all.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  if (!wrapperRef.current && typeof document !== "undefined") {
    wrapperRef.current = document.createElement("div");
    // No box of its own: every shell the card lands in is a flex column with a
    // gap, where even an empty child is another gap.
    wrapperRef.current.style.display = "contents";
  }
  const wrapper = wrapperRef.current;
  /** The open dialogs, oldest first — which is the order they entered the top layer. */
  const openedRef = useRef<HTMLElement[]>([]);

  // Before paint: the first placement is what puts the card in the page at all,
  // and after paint it would cost the step its first frame.
  useMeasureEffect(() => {
    if (!wrapper) return;
    const place = (records: MutationRecord[] = []) => {
      // The records in order, not just the state they left behind. Mutations
      // coalesce into one callback, so a dialog that closed and reopened in
      // between is simply open by the time this looks — and it belongs at the
      // end, because it re-entered the top layer at the end. The record whose
      // `oldValue` is null is that reopen.
      for (const record of records) {
        const target = record.target;
        if (record.type !== "attributes" || record.oldValue !== null) continue;
        if (!(target instanceof HTMLElement) || target.tagName !== "DIALOG") continue;
        openedRef.current = [...openedRef.current.filter((candidate) => candidate !== target), target];
      }
      const open = [...document.querySelectorAll<HTMLElement>("dialog[open]")];
      // Ones already known keep their place; the rest have just opened, or were
      // already open when the tour started, and go on the end.
      const known = openedRef.current.filter((candidate) => open.includes(candidate));
      openedRef.current = [...known, ...open.filter((candidate) => !known.includes(candidate))];
      // `fallback` last, so a step whose anchor moves to a new container with
      // no dialog open still lands there.
      moveInto(openedRef.current.at(-1) ?? fallback ?? document.body, wrapper);
    };
    place();
    if (typeof MutationObserver !== "function") return;
    // Attributes as well as nodes: `showModal()` sets `open` on a dialog that
    // is already in the tree, which is how every dialog in this app opens.
    const observer = new MutationObserver(place);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributeFilter: ["open"], attributeOldValue: true });
    return () => observer.disconnect();
  }, [wrapper, fallback]);

  // The wrapper is the tour's, not React's: nothing else takes it back out of
  // the page when the tour ends.
  useEffect(() => () => wrapper?.remove(), [wrapper]);

  return wrapper;
}

function continueLabel(step: TourStep, mode: TourCoachMode): string {
  // A finished objective is the one place the label is not the author's to
  // choose: "Next" is a promise about what the button does, and a `beat`'s
  // "Let's go" on a card that has just said "done" is a different promise.
  if (mode === "celebrating") return "Next";
  if (mode === "stalled") return "Continue";
  if (step.continueLabel) return step.continueLabel;
  return step.kind === "observe" ? "Got it" : "Continue";
}

function statusLine(step: TourStep, mode: TourCoachMode): string | null {
  if (mode === "celebrating") return step.reward?.line ?? "Done.";
  if (mode === "stalled") return "Take your time — press Continue when you’re ready.";
  if (mode === "waiting") return step.kind === "observe" ? "Take a look…" : "Waiting for you…";
  return null;
}

function TourCoachBody({ step, progress, mode, notice, hintVisible, sideQuests, questsDone, titleId, bodyId, drag, ...handlers }: TourCoachProps & { titleId: string; bodyId: string; drag: CardDrag | null }) {
  const status = statusLine(step, mode);
  // The only state with nothing to press is an `act` step still waiting on its
  // objective — the one case where pressing on would be a lie. Everything
  // else, the just-finished objective included, is the player's to leave when
  // they have read it. `observe` keeps its button through the dwell for the
  // same reason: an anchor that never quite crosses the intersection threshold
  // used to leave "Take a look…" on screen with no way past it but Skip.
  const showAdvance = step.kind !== "act" || mode !== "waiting";
  const questsComplete = sideQuests.length > 0 && sideQuests.every((quest) => questsDone.includes(quest.id));
  // A side quest borrows its chapter from wherever it thematically belongs, so
  // the arc's "Chapter N of M" and the arc's own percent both describe a
  // position the player has stepped out of — the eyebrow and the bar below it
  // switch to the one honest measure of a detour: quests done vs. quests total.
  const isSideQuest = step.optional === true;
  const questPercent = sideQuests.length === 0 ? 0 : Math.round((questsDone.length / sideQuests.length) * 100);
  return <>
    <header className={cn("tour-coach-head", drag && "tour-coach-grab")} onPointerDown={drag?.onPointerDown}>
      {drag && (
        <button
          type="button"
          className="tour-coach-grip"
          aria-label="Move the tour card"
          title="Drag to move the card, or nudge it with the arrow keys"
          onKeyDown={drag.onKeyDown}
        >
          <GripVertical size={14} aria-hidden />
        </button>
      )}
      {isSideQuest ? (
        <span className="tour-coach-quest">
          Side quest{progress.chapter ? ` · ${progress.chapter.name}` : ""}
        </span>
      ) : (
        <span className="tour-coach-chapter">
          {progress.chapterCount > 0 && progress.chapterIndex > 0
            ? `Chapter ${progress.chapterIndex} of ${progress.chapterCount}${progress.chapter ? ` — ${progress.chapter.name}` : ""}`
            : progress.chapter?.name ?? "Side quest"}
        </span>
      )}
      <button type="button" className="tour-coach-close" aria-label="Pause the tour" onClick={handlers.onPause}>
        <X size={15} aria-hidden />
      </button>
    </header>
    <ProgressBar
      value={isSideQuest ? questPercent : progress.percent}
      label={isSideQuest ? "Side quests done" : "Tour progress"}
    />
    <b id={titleId} className={cn("tour-coach-title", mode === "celebrating" && "tour-coach-title-done")}>{step.title}</b>
    <p id={bodyId} className="tour-coach-body">{step.body}</p>
    {notice && <p className="tour-coach-notice">{notice}</p>}
    {mode !== "celebrating" && hintVisible && step.hint && <p className="tour-coach-hint">{step.hint}</p>}
    {status && (
      <p className={cn("tour-coach-status", mode === "celebrating" && "tour-coach-status-done")}>
        {mode === "waiting" && <i className="tour-coach-pulse" aria-hidden />}
        {mode === "celebrating" && step.reward && <span aria-hidden>{step.reward.emoji}</span>}
        {status}
      </p>
    )}
    <div className="tour-coach-actions">
      {handlers.onAction && step.action && (
        <Button size="sm" onClick={handlers.onAction}>
          {step.action.label}
          {step.action.newTab && <ExternalLink size={14} aria-hidden />}
        </Button>
      )}
      {showAdvance && <Button size="sm" onClick={handlers.onContinue}>{continueLabel(step, mode)}</Button>}
      {handlers.onDecline && step.declineLabel && (
        <Button size="sm" variant="secondary" onClick={handlers.onDecline}>{step.declineLabel}</Button>
      )}
      {handlers.onTakeMeThere && (
        <Button size="sm" variant="secondary" onClick={handlers.onTakeMeThere}>Take me there</Button>
      )}
      {mode !== "celebrating" && step.hint && !hintVisible && (
        <button type="button" className="tour-coach-quiet" onClick={handlers.onShowHint}>Show me how</button>
      )}
      {mode !== "celebrating" && (
        <button type="button" className="tour-coach-quiet" onClick={handlers.onSkipStep}>Skip this</button>
      )}
    </div>
    {sideQuests.length > 0 && (
      <details className="tour-coach-tray">
        <summary>Side quests · {questsDone.length} of {sideQuests.length}{questsComplete ? " 🏆" : ""}</summary>
        <ul>
          {sideQuests.map((quest) => (
            <li key={quest.id}>
              <button type="button" onClick={() => handlers.onSelectQuest(quest.id)}>
                {questsDone.includes(quest.id) ? "✓ " : ""}{quest.title}
              </button>
            </li>
          ))}
        </ul>
      </details>
    )}
    <details className="tour-coach-more">
      <summary>Tour options</summary>
      <ul>
        <li><button type="button" onClick={handlers.onSkipChapter}>Skip this chapter</button></li>
        <li><button type="button" onClick={handlers.onFinish}>Finish the tour for good</button></li>
      </ul>
    </details>
  </>;
}

export function TourCoach(props: TourCoachProps) {
  const generatedId = useId();
  const titleId = `tour-title-${generatedId}`;
  const bodyId = `tour-body-${generatedId}`;
  const { step, position, container, mobile, mode, settling } = props;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useCardDrag(step.id, cardRef);
  const host = useCardHost(container);

  if (step.presentation === "modal" || step.presentation === "modal-wide") {
    // The cold open and the curtain call are the two beats that deserve to own
    // the screen. Everything else is a card that lets the product keep working.
    return (
      <Modal
        open
        onClose={props.onPause}
        title={step.title}
        description={step.body}
        wide={step.presentation === "modal-wide"}
        footer={<>
          {/* A modal beat's own action is its primary — the curtain call's
              "Create my real event" is the whole point of the moment, and
              "Keep playing in the demo" is what you press to decline it. */}
          {props.onAction && step.action && (
            <Button onClick={props.onAction}>
              {step.action.label}
              {step.action.newTab && <ExternalLink size={14} aria-hidden />}
            </Button>
          )}
          <Button variant={props.onAction && step.action ? "secondary" : "primary"} onClick={props.onContinue}>
            {continueLabel(step, "ready")}
          </Button>
          {props.onDecline && step.declineLabel && (
            <Button variant="secondary" onClick={props.onDecline}>{step.declineLabel}</Button>
          )}
        </>}
      >
        {props.notice && <p className="tour-coach-notice">{props.notice}</p>}
        {props.recap && (
          <p className="tour-coach-recap">
            {props.recap.objectives} of {props.recap.objectiveCount} objectives
            {props.recap.questCount > 0 && ` · ${props.recap.quests} of ${props.recap.questCount} side quests`}
          </p>
        )}
        {step.reward && <p className="tour-coach-status tour-coach-status-done"><span aria-hidden>{step.reward.emoji}</span>{step.reward.line}</p>}
      </Modal>
    );
  }

  if (!host) return null;
  /*
   * With no anchor to sit beside, the middle of the screen is the *worst*
   * place a card can be: on every screen this tour visits, the middle is where
   * the work is — the grid the player is being asked to drop a session onto,
   * the table they are being asked to tick. Only a `beat`, which asks for
   * nothing but a read, keeps the centre. Anything with an instruction in it
   * docks to the corner the paused pill uses, where help lives and nothing
   * else does.
   */
  const centred = !position && !mobile && step.kind === "beat";
  const docked = !position && !mobile && !centred;
  const moved = drag.offset.x !== 0 || drag.offset.y !== 0;
  const card: ReactNode = (
    <div
      ref={cardRef}
      className={cn("tour-coach", mobile && "tour-coach-sheet", centred && "tour-coach-centred", docked && "tour-coach-docked", settling && "tour-coach-settling", drag.dragging && "tour-coach-dragging", mode === "celebrating" && "tour-coach-won")}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      aria-live="polite"
      style={mobile ? undefined : {
        ...position,
        // Composed with the centring translate rather than replacing it, so a
        // centred card moves from where it actually is.
        ...(moved ? { transform: centred
          ? `translate(calc(-50% + ${drag.offset.x}px), calc(-50% + ${drag.offset.y}px))`
          : `translate(${drag.offset.x}px, ${drag.offset.y}px)` } : null),
      }}
    >
      {/* A docked sheet on mobile is already out of the way and has nowhere to
          go; dragging it would only fight the page's own scrolling. */}
      <TourCoachBody {...props} titleId={titleId} bodyId={bodyId} drag={mobile ? null : drag} />
    </div>
  );
  // Always the same element: `useCardHost` moves that into whichever modal owns
  // the page, rather than handing this a new container to rebuild the card in.
  return createPortal(card, host);
}

/**
 * What a paused tour leaves behind: a small, permanently available way back
 * in. It is never a nag — it does not move, does not animate, and says where
 * the player stopped rather than that they stopped.
 */
export function TourPill({ progress, onResume, onDismiss }: { progress: TourProgress; onResume: () => void; onDismiss: () => void }) {
  return (
    <div className="tour-pill">
      <button type="button" className="tour-pill-resume" aria-label="Resume the tour" onClick={onResume}>
        <span aria-hidden>▸</span>
        <span>
          {progress.chapterIndex > 0
            ? `Chapter ${progress.chapterIndex} of ${progress.chapterCount} — ${progress.chapter?.name ?? ""}`
            : "Guided tour"}
        </span>
      </button>
      <div className="tour-pill-bar"><ProgressBar value={progress.percent} label="Tour progress" /></div>
      <button type="button" className="tour-pill-dismiss" aria-label="Hide the tour pill" onClick={onDismiss}>
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
