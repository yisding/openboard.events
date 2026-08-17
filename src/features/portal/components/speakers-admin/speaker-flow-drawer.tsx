"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContactListRow, SpeakerDetailDTO } from "@/features/portal";
import { participantRoleLabel } from "../../lib/participant-role";
import { SendReminderDialog } from "@/features/comms/index.client";
import { eventIdSchema } from "@/shared/contracts";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { SpeakerHeadshot } from "./speaker-headshot";

function initialsFor(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

/**
 * M57 — the speaker flow-through panel: a fast preview over the row already
 * on screen (so name/confirmation/company render before any fetch resolves),
 * with keyboard/click next-prev across the current table page. This is
 * deliberately *not* the full editable profile — `SpeakerDetailView` at
 * `/speakers/[contactId]` keeps every editable field, upload and roster
 * panel; this drawer's job is scanning a list quickly and jumping to that
 * page (or a nudge) when one row needs more than a look.
 */
export function SpeakerFlowDrawer({
  eventId,
  timezone,
  row,
  nav,
  onClose,
}: {
  eventId: string;
  timezone: string;
  row: ContactListRow;
  nav?: { index: number; total: number; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined };
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SpeakerDetailDTO | null>(null);
  const [error, setError] = useState("");
  const [reminding, setReminding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");
    fetch(`/api/internal/speakers/${eventId}/${row.contactId}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SpeakerDetailDTO; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          setError(payload?.error?.message ?? "Could not load this speaker");
          return;
        }
        setDetail(payload.data);
      })
      .catch(() => { if (!cancelled) setError("Could not load this speaker"); });
    // Flowing down a list opens several speakers in a row; a late response for
    // one already passed must not replace what is on screen now.
    return () => { cancelled = true; };
  }, [eventId, row.contactId]);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={row.name}
        {...(nav ? { headerExtra: <FlowNavControls index={nav.index} total={nav.total} itemLabel={row.name} itemNoun="speaker" onPrev={nav.onPrev} onNext={nav.onNext} /> } : {})}
      >
        <div className="submission-drawer">
          <header className="drawer-hero">
            <StatusBadge value={row.confirmationStatus} />
            <h2>{row.name}</h2>
            <p>{row.jobTitle || row.company ? `${row.jobTitle ?? ""}${row.jobTitle && row.company ? " at " : ""}${row.company ?? ""}` : row.email}</p>
          </header>
          <div className="drawer-content">
            <section>
              <h3>Profile</h3>
              <div className="speaker-card">
                <SpeakerHeadshot name={row.name} initials={initialsFor(row.name, row.email)} headshotFileId={row.headshotFileId} />
                <div className="speaker-card-copy"><b>{row.email}</b><span>{row.jobTitle || row.company ? `${row.jobTitle ?? ""}${row.jobTitle && row.company ? " · " : ""}${row.company ?? ""}` : "—"}</span></div>
              </div>
              {(row.missingBio || row.missingHeadshot) && (
                <p className="portal-note" role="status">
                  Missing {[row.missingBio && "bio", row.missingHeadshot && "headshot"].filter(Boolean).join(" and ")}.
                </p>
              )}
            </section>

            <section>
              <h3>Tasks</h3>
              <p className="long-copy">{row.openTasks} open{row.overdueTasks > 0 ? ` · ${row.overdueTasks} overdue` : ""} of {row.openTasks + (detail?.tasks.filter((task) => task.completed).length ?? 0)}.</p>
              {error && <p className="portal-note" role="alert">{error}</p>}
              {!detail && !error && <p className="portal-note">Loading…</p>}
              {detail && detail.tasks.length === 0 && <p className="long-copy">No onboarding tasks assigned yet.</p>}
              {detail?.tasks.map((task) => (
                <div className="mini-session" key={task.taskId}>
                  {/* The same rendering as the full profile's Tasks list: a
                      raw `<Dash>` printed the stored ISO instant
                      ("2026-08-14T00:00:00.000Z") in the viewer's face and in
                      no timezone anyone reads. */}
                  <span className="mini-session-meta">{task.dueAt ? <TzTime instant={task.dueAt} tz={timezone} style="date" /> : "No due date"}</span>
                  <b>{task.name}</b>
                  <StatusBadge value={task.completed ? "complete" : task.overdue ? "overdue" : "open"} />
                </div>
              ))}
              {row.openTasks > 0 && (
                <div className="drawer-actions">
                  <Button variant="secondary" onClick={() => setReminding(true)}>Send reminder</Button>
                </div>
              )}
            </section>

            <section>
              <h3>Submissions</h3>
              {/* Opens on row data so the section is never a bare heading while
                  the detail fetch is in flight. `error` is announced once, by
                  the Tasks section above, so it renders here as plain copy. */}
              <p className="long-copy">{row.submissionCount} on this event.</p>
              {error && <p className="portal-note">{error}</p>}
              {!detail && !error && <p className="portal-note">Loading…</p>}
              {detail && detail.submissions.length === 0 && <p className="long-copy">No submissions from this contact.</p>}
              {detail?.submissions.map((submission) => (
                <Link key={submission.submissionId} className="mini-session" href={`/events/${eventId}/abstracts?submission=${submission.submissionId}`}>
                  <span className="mini-session-meta">SESS-{submission.code}</span>
                  <b>{submission.title}{submission.isPrimary ? "" : ` (${participantRoleLabel(submission.role)})`}</b>
                  <StatusBadge value={submission.portalStatus} />
                </Link>
              ))}
            </section>

            <div className="drawer-actions">
              <Link className="button button-primary" href={`/events/${eventId}/speakers/${row.contactId}`}>
                Open full profile <ExternalLink size={14} />
              </Link>
            </div>
          </div>
        </div>
      </Drawer>
      {reminding && (
        <SendReminderDialog
          eventId={eventIdSchema.parse(eventId)}
          contactId={row.contactId}
          contactName={row.name}
          timezone={timezone}
          onClose={() => setReminding(false)}
        />
      )}
    </>
  );
}
