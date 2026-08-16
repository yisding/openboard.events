"use client";

import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ConflictDTO } from "@/shared/contracts";
import { eventDayKey, formatInZone } from "@/shared/lib/time";
import { EmptyState } from "@/shared/ui/ui-kit";
import type { AgendaViewProps } from "../index.client";
import { agendaHref, nameLookup, type NameLookup } from "../store";

const KIND_LABEL: Record<ConflictDTO["kind"], string> = {
  room: "Room conflict",
  speaker: "Speaker conflict",
  track: "Track conflict",
};

const SEVERITY_ORDER: Record<ConflictDTO["severity"], number> = { error: 0, warning: 1 };

function sessionTitle(sessions: AgendaViewProps["sessions"], id: string): string {
  return sessions.find((session) => String(session.id) === String(id))?.title ?? "Removed session";
}

/**
 * A non-mutating, stable sort of a copy: errors before warnings, then overlap
 * start ascending within a severity. The engine (`../conflicts.ts`) already
 * returns this order, so this is defensive per the work order, not the source
 * of truth — exported so `conflicts-view.test.ts` can pin the rule directly.
 */
export function sortConflicts(conflicts: readonly ConflictDTO[]): ConflictDTO[] {
  return [...conflicts].sort((left, right) =>
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.overlapStartMs - right.overlapStartMs);
}

/**
 * The thing that collided, by name.
 *
 * The engine has always known it — `subjectId` is the room, speaker or track a
 * pair of sessions shares, and it is what makes two conflicts of the same kind
 * distinct rows. Only the renderer stopped short, so an organizer reading
 * "Speaker conflict" over two titles still had to open both sessions to learn
 * *which* speaker was double-booked.
 *
 * `null` when the subject no longer resolves: rooms, tracks and contacts can be
 * deleted while a stale conflict list is still on screen, and a row that says
 * nothing is better than a row that says "undefined".
 */
export function conflictSubjectName(conflict: ConflictDTO, lookup: NameLookup): string | null {
  if (conflict.kind === "room") return lookup.room(conflict.subjectId);
  if (conflict.kind === "track") return lookup.track(conflict.subjectId)?.name ?? null;
  return lookup.speakers([conflict.subjectId])[0] ?? null;
}

/**
 * ./M31-agenda-views.md's Conflicts tab: a pure renderer of the
 * session-cache-derived `conflicts` array (`../index.client.ts`'s doc comment —
 * the same array feeds the toolbar badge and the grid's red borders). This
 * module never calls `detectConflicts` itself and never queries the database.
 */
export default function ConflictsView({
  eventId,
  event,
  sessions,
  conflicts,
  rooms,
  tracks,
  speakers,
  searchActive = false,
}: AgendaViewProps & { searchActive?: boolean }) {
  // The same id-to-name resolver the Day grid and the List view already use,
  // so a room renamed in settings reads the same on every agenda surface.
  const lookup = nameLookup({ rooms, tracks, speakers });
  if (conflicts.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={26} />}
        title={searchActive ? "No conflicts match your search" : "No conflicts — nice work"}
        description={searchActive
          ? "Try another session title or clear the search."
          : "Every scheduled session is clear of room, speaker, and track overlaps."}
      />
    );
  }

  const ordered = sortConflicts(conflicts);

  return (
    <div className="agenda-conflicts">
      {ordered.map((conflict) => {
        const dayKey = eventDayKey(conflict.overlapStartMs, event.timezone);
        const isError = conflict.severity === "error";
        const subject = conflictSubjectName(conflict, lookup);
        return (
          <article
            key={`${conflict.kind}:${conflict.subjectId}:${conflict.a}:${conflict.b}`}
            className={`agenda-conflict-row ${isError ? "is-error" : "is-warning"}`}
          >
            <span className="agenda-conflict-icon" aria-hidden>
              {isError ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
            </span>
            <div className="agenda-conflict-body">
              <span className="agenda-conflict-kind">{KIND_LABEL[conflict.kind]}</span>
              <b>{sessionTitle(sessions, conflict.a)} <span aria-hidden>×</span> {sessionTitle(sessions, conflict.b)}</b>
              <small>
                {/* Which speaker, which room, which track — the fact the row
                    was computed from, and the one an organizer needs before
                    they can decide what to move. */}
                {subject && <>{subject}{" · "}</>}
                {formatInZone(conflict.overlapStartMs, event.timezone, "time")}
                {" – "}
                {formatInZone(conflict.overlapEndMs, event.timezone, "time")}
              </small>
            </div>
            <Link href={agendaHref(eventId, "day", dayKey)} className="agenda-conflict-jump">
              Jump to Day <ArrowRight size={13} aria-hidden />
            </Link>
          </article>
        );
      })}
    </div>
  );
}
