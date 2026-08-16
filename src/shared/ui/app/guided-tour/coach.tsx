"use client";

import { ExternalLink, X } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { Button, Modal, ProgressBar } from "@/shared/ui/ui-kit";
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
 */

export type TourCoachMode = "waiting" | "ready" | "celebrating" | "stalled";

export type TourCoachProps = {
  step: TourStep;
  progress: TourProgress;
  /** Fixed-position style from the shared popover geometry; null centres the card. */
  position: CSSProperties | null;
  /** `document.body`, or the open `<dialog>` the anchor lives inside. */
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
  if (mode === "stalled") return "Take your time — press Continue when you're ready.";
  if (mode === "waiting") return step.kind === "observe" ? "Take a look…" : "Waiting for you…";
  return null;
}

function TourCoachBody({ step, progress, mode, notice, hintVisible, sideQuests, questsDone, titleId, bodyId, ...handlers }: TourCoachProps & { titleId: string; bodyId: string }) {
  const status = statusLine(step, mode);
  // The only state with nothing to press is an `act` step still waiting on its
  // objective — the one case where pressing on would be a lie. Everything
  // else, the just-finished objective included, is the player's to leave when
  // they have read it. `observe` keeps its button through the dwell for the
  // same reason: an anchor that never quite crosses the intersection threshold
  // used to leave "Take a look…" on screen with no way past it but Skip.
  const showAdvance = step.kind !== "act" || mode !== "waiting";
  const questsComplete = sideQuests.length > 0 && sideQuests.every((quest) => questsDone.includes(quest.id));
  return <>
    <header className="tour-coach-head">
      <span className="tour-coach-chapter">
        {progress.chapterCount > 0 && progress.chapterIndex > 0
          ? `Chapter ${progress.chapterIndex} of ${progress.chapterCount}${progress.chapter ? ` — ${progress.chapter.name}` : ""}`
          : progress.chapter?.name ?? "Side quest"}
      </span>
      <button type="button" className="tour-coach-close" aria-label="Pause the tour" onClick={handlers.onPause}>
        <X size={15} aria-hidden />
      </button>
    </header>
    <ProgressBar value={progress.percent} label="Tour progress" />
    <b id={titleId} className="tour-coach-title">{step.title}</b>
    <p id={bodyId} className="tour-coach-body">{step.body}</p>
    {notice && <p className="tour-coach-notice">{notice}</p>}
    {hintVisible && step.hint && <p className="tour-coach-hint">{step.hint}</p>}
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

  if (!container) return null;
  const card: ReactNode = (
    <div
      className={cn("tour-coach", mobile && "tour-coach-sheet", !position && !mobile && "tour-coach-centred", settling && "tour-coach-settling", mode === "celebrating" && "tour-coach-won")}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      aria-live="polite"
      style={mobile ? undefined : position ?? undefined}
    >
      <TourCoachBody {...props} titleId={titleId} bodyId={bodyId} />
    </div>
  );
  return createPortal(card, container);
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
