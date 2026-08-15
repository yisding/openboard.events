"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { z } from "zod";
import { api } from "@/shared/lib/api-client";
import { Button, ProgressBar } from "@/shared/ui/ui-kit";
import type { EventId } from "@/shared/contracts";

/**
 * First Fair (design §3.6) — the middle of the three resume surfaces.
 *
 * Ascending prominence: the engine's own pill is always there and never
 * insists; the command palette answers a search for "tour"; and this card
 * takes the demo dashboard's guidance slot, which is empty anyway because
 * `ActivationGuide` and `MilestoneBanner` deliberately stand down on a demo
 * event. One onboarding voice at a time.
 *
 * It renders when the tutorial is paused — and in the one other case where a
 * running tour has nothing on screen: a cursor sitting on a step this build
 * cannot show, after a release renamed or retired it. The engine's coach has
 * no card to draw there, so without this the demo dashboard of a tour the
 * database still calls *active* offers no way back into it at all.
 *
 * A finished tour leaves a quest log, not a nag, and a running one with a step
 * to show already owns the screen.
 */

/**
 * The two fields of the cursor this card touches. Deliberately a local shape
 * rather than an import from the onboarding feature: the dashboard has no
 * business knowing what a demo event is, and pulling that feature's barrel
 * into a `"use client"` module would drag its server readers along with it.
 */
const tourCursorWireSchema = z.object({ chapter: z.string(), stepId: z.string(), status: z.string() }).loose();

export function TourResumeCard({ eventId, chapter, stepId, chapterLabel, percent, resumeHref, stranded = false }: {
  eventId: EventId;
  /** Where the tour should carry on — the values the resume writes straight back. */
  chapter: string;
  stepId: string;
  /** "Chapter 6 of 10 — The grid". Chapters have names because places do. */
  chapterLabel: string;
  percent: number;
  /** The route that step lives on. */
  resumeHref: string;
  /**
   * The tour is *running*, but its cursor names a step this build no longer
   * has, so the coach card has nothing to draw and the dashboard is the only
   * surface left. The card then reads as a rescue rather than a bookmark, and
   * `chapter`/`stepId` above are the next unfinished objective rather than the
   * stranded cursor.
   */
  stranded?: boolean;
}) {
  const [resuming, setResuming] = useState(false);

  async function resume() {
    if (resuming) return;
    setResuming(true);
    try {
      // Read first: the compare-and-set needs the step the server is on, which
      // is not necessarily the one this page was rendered with.
      const current = await api(`events/${eventId}/tour`, tourCursorWireSchema);
      await api(`events/${eventId}/tour`, tourCursorWireSchema, {
        method: "PATCH",
        body: { expectedStepId: current.stepId, chapter, stepId, status: "active" },
      });
    } catch {
      // A refused write leaves the cursor exactly where it was; the navigation
      // below still puts the organizer on the step, where the pill is waiting.
    }
    // A full load, not a push: the cursor is server state the event layout
    // reads once, so the engine has to be handed a fresh bootstrap.
    window.location.assign(resumeHref);
  }

  return (
    <section className="dashboard-activation" aria-labelledby="dashboard-tour-resume-title">
      <span className="dashboard-activation-icon" aria-hidden><PlayCircle size={18} /></span>
      <div className="dashboard-activation-content">
        <span className="dashboard-activation-eyebrow">{stranded ? "Guided tour · waiting for you" : "Guided tour · paused"}</span>
        <h2 id="dashboard-tour-resume-title">{chapterLabel}</h2>
        <p>{stranded
          ? "The step you were on is not in this version of the tour any more. Everything you finished still counts — this picks you up at the next objective."
          : "You stopped part-way through. Everything you did is still here, and so is everything you have not done yet."}</p>
        <ProgressBar value={percent} label="Tour progress" />
        <div className="dashboard-activation-actions">
          <Button onClick={() => void resume()} disabled={resuming}>
            {resuming ? "Picking it up…" : "Pick the tour back up"}
          </Button>
        </div>
      </div>
    </section>
  );
}
