import Link from "next/link";
import { CalendarClock, CheckCircle2, PartyPopper, Share2 } from "lucide-react";
import { taskHref } from "@/features/portal/lib/task-href";
import type { PortalHero } from "@/features/portal/lib/portal-hero";
import { formatInZone } from "@/shared/lib/time";

/**
 * M59 — the portal home's lead element. "Portal home leads with one next
 * step" (experience-design.md, Surfacing §4): four variants, one rendered,
 * matching `computePortalHero`'s priority order exactly — this component
 * only renders what that pure function decided, no re-deciding here.
 */
export function SpeakerHomeHero({
  hero,
  eventSlug,
  timezone,
  shareUrl,
}: {
  hero: PortalHero;
  eventSlug: string;
  timezone: string;
  shareUrl: string | null;
}) {
  if (hero.kind === "celebration") {
    return (
      <section className="portal-hero portal-hero-celebration">
        <span className="portal-hero-eyebrow"><PartyPopper size={14} /> Congratulations</span>
        <h2>You’re speaking!</h2>
        <p>Your submission was accepted. Watch My sessions below for your time slot, and share the news whenever you’re ready.</p>
        {shareUrl && (
          <Link className="button button-primary" href={shareUrl} target="_blank" rel="noreferrer">
            <Share2 size={15} /> Get my share card
          </Link>
        )}
      </section>
    );
  }

  if (hero.kind === "task") {
    const { task } = hero;
    return (
      <section className={`portal-hero${task.overdue ? " portal-hero-urgent" : ""}`}>
        <span className="portal-hero-eyebrow"><CalendarClock size={14} /> {task.overdue ? "Overdue" : "Next up"}</span>
        <h2>{task.taskName}</h2>
        <p>{task.dueAt ? `Due ${formatInZone(task.dueAt, timezone, "long")}` : "No deadline set — worth clearing anyway."}</p>
        <Link className="button button-primary" href={taskHref(eventSlug, task)}>Take care of it</Link>
      </section>
    );
  }

  if (hero.kind === "draft") {
    const { submission, daysLeft } = hero;
    return (
      <section className="portal-hero">
        <span className="portal-hero-eyebrow"><CalendarClock size={14} /> Draft in progress</span>
        <h2>You were still working on “{submission.title || "your submission"}”</h2>
        <p>
          {daysLeft === null
            ? "Pick up right where you left off."
            : daysLeft > 0
              ? `The call closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — pick up right where you left off.`
              : "The call closes today — pick up right where you left off."}
        </p>
        <Link className="button button-primary" href={`/portal/${encodeURIComponent(eventSlug)}/submissions/${submission.submissionId}/edit`}>Resume your submission</Link>
      </section>
    );
  }

  return (
    <section className="portal-hero portal-hero-quiet">
      <span className="portal-hero-eyebrow"><CheckCircle2 size={14} /> All caught up</span>
      <h2>Nothing needs you right now.</h2>
      <p>We’ll let you know the moment there is something new.</p>
      {hero.hasAcceptedSubmission && shareUrl && (
        <Link className="button button-secondary" href={shareUrl} target="_blank" rel="noreferrer">
          <Share2 size={15} /> My share card
        </Link>
      )}
    </section>
  );
}
