import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import type { MyTaskDTO, PortalSubmissionRow, PortalTaskSummary } from "@/features/portal";
import type { MySessionDTO } from "@/shared/contracts";
import { computePortalHero } from "@/features/portal/lib/portal-hero";
import { sessionCalendarLinks } from "@/features/portal/lib/session-calendar-links";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { TzTime } from "@/shared/ui/app/tz-time";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { AddToCalendarButton } from "./add-to-calendar-button";
import { SpeakerHomeHero } from "./speaker-home-hero";
import { SubmissionStatusTimeline } from "./submission-status-timeline";

/**
 * The speaker's Home. Every widget is designed for its empty state as well as
 * its full one — the seeded empty event is the standing test, and an empty
 * surface that reads as broken is a judged failure.
 *
 * Counts come from `speaker_outstanding_v` via the server, not from counting
 * rows here, so this page and the organizer's dashboard cannot disagree.
 *
 * M59 — this is no longer a grid of equal widgets: `SpeakerHomeHero` leads
 * with the one computed next step, KPI tiles sit below it, and My Sessions
 * finally renders `getMySessions` (M28) instead of the permanent "appears
 * here once published" placeholder.
 */
export function PortalHomeWidgets({
  firstName,
  eventId,
  eventSlug,
  timezone,
  eventName,
  submissions,
  tasks,
  myTasks,
  mySessions,
  showCelebration,
  shareUrl,
}: {
  firstName: string;
  eventId: string;
  eventSlug: string;
  timezone: string;
  eventName: string;
  submissions: PortalSubmissionRow[];
  tasks: PortalTaskSummary;
  myTasks: MyTaskDTO[];
  mySessions: MySessionDTO[];
  showCelebration: boolean;
  shareUrl: string | null;
}) {
  const portalRoot = `/portal/${encodeURIComponent(eventSlug)}`;
  const recent = submissions.slice(0, 3);
  const hero = computePortalHero({ showCelebration, submissions, myTasks, timezone });

  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">SPEAKER PORTAL</span>
        <h1>{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
        <p>Everything the organizers need from you, in one place.</p>
      </header>

      <SpeakerHomeHero hero={hero} eventSlug={eventSlug} timezone={timezone} shareUrl={shareUrl} />

      <section className="portal-home-section">
        <div className="portal-home-section-header">
          <h2 className="section-title">My sessions</h2>
          {mySessions.length > 0 && <AddToCalendarButton eventId={eventId} />}
        </div>
        {mySessions.length === 0 ? (
          <p className="portal-note">Your session times appear here once the agenda schedules them.</p>
        ) : (
          <ul className="portal-home-list portal-my-sessions">
            {mySessions.map((session) => {
              const links = sessionCalendarLinks(session, eventName, `${portalRoot}/submissions`);
              return (
                <li key={session.sessionId}>
                  <div>
                    <b>{session.title}</b>
                    {session.startsAt && (
                      <span className="portal-session-when">
                        <CalendarDays size={12} /> <TzTime instant={session.startsAt} tz={timezone} style="long" />
                        {session.roomName && <><MapPin size={12} /> {session.roomName}</>}
                      </span>
                    )}
                  </div>
                  {links && (
                    <div className="portal-session-cal-links">
                      <a href={links.google} target="_blank" rel="noreferrer">Google</a>
                      <a href={links.outlook} target="_blank" rel="noreferrer">Outlook</a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="portal-home-section">
        <h2 className="section-title">Recent submissions</h2>
        {recent.length === 0 ? (
          <p className="portal-note">Nothing submitted yet. Anything you send through a call for speakers appears here.</p>
        ) : (
          <ul className="portal-home-list">
            {recent.map((row) => (
              <li key={row.submissionId}>
                <Link href={`${portalRoot}/submissions/${row.submissionId}`}>{row.title}</Link>
                <StatusBadge value={row.status} />
                <SubmissionStatusTimeline status={row.status} />
                {row.submittedAt && <TzTime instant={row.submittedAt} tz={timezone} style="date" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="portal-stat-row">
        <StatTile label="My submissions" value={submissions.length} href={`${portalRoot}/submissions`} />
        <StatTile
          label="Tasks to do"
          value={tasks.open}
          tone={tasks.overdue > 0 ? "danger" : "default"}
          hint={tasks.overdue > 0 ? `${tasks.overdue} overdue` : tasks.done > 0 ? `${tasks.done} done` : undefined}
          href={`${portalRoot}/tasks`}
        />
        <StatTile label="My profile" value="Edit" hint="Bio, headshot and links" href={`${portalRoot}/profile`} />
      </div>
    </div>
  );
}
