import Link from "next/link";
import type { PortalSubmissionRow, PortalTaskSummary } from "@/features/portal";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { TzTime } from "@/shared/ui/app/tz-time";
import { StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The speaker's Home. Every widget is designed for its empty state as well as
 * its full one — the seeded empty event is the standing test, and an empty
 * surface that reads as broken is a judged failure.
 *
 * Counts come from `speaker_outstanding_v` via the server, not from counting
 * rows here, so this page and the organizer's dashboard cannot disagree.
 */
export function PortalHomeWidgets({
  firstName,
  eventSlug,
  timezone,
  submissions,
  tasks,
}: {
  firstName: string;
  eventSlug: string;
  timezone: string;
  submissions: PortalSubmissionRow[];
  tasks: PortalTaskSummary;
}) {
  const portalRoot = `/portal/${encodeURIComponent(eventSlug)}`;
  const recent = submissions.slice(0, 3);

  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">SPEAKER PORTAL</span>
        <h1>{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
        <p>Everything the organizers need from you, in one place.</p>
      </header>

      <div className="portal-stat-row">
        <StatTile label="My submissions" value={submissions.length} href={`${portalRoot}/submissions`} />
        {/* Deliberately not a link yet: this count is the view's, but
            /tasks still renders fixture tasks until M25's runtime lands, and
            sending a speaker from a real number to different data is worse than
            not linking. The href returns with that module. */}
        <StatTile
          label="Tasks to do"
          value={tasks.open}
          tone={tasks.overdue > 0 ? "danger" : "default"}
          hint={tasks.overdue > 0 ? `${tasks.overdue} overdue` : tasks.done > 0 ? `${tasks.done} done` : undefined}
        />
        <StatTile label="My profile" value="Edit" hint="Bio, headshot and links" href={`${portalRoot}/profile`} />
      </div>

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
                {row.submittedAt && <TzTime instant={row.submittedAt} tz={timezone} style="date" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="portal-home-section">
        <h2 className="section-title">My sessions</h2>
        {/* The schedule is M28's; until getMySessions lands there is nothing
            honest to show, and inventing a placeholder session would be worse
            than saying so. */}
        <p className="portal-note">Your session times appear here once the programme is published.</p>
      </section>
    </div>
  );
}
