"use client";

import { Eye } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AcceptedForSchedulingRow, ScheduledSessionDTO } from "@/shared/contracts";
import type { QuerySeed } from "@/shared/lib/query-client";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { PageHeader } from "@/shared/ui/ui-kit";
import { detectConflicts, toScheduledSession } from "../conflicts";
import { useAcceptedForAgenda, useAnnounceBundle } from "../hooks/use-agenda-supporting-data";
import { useSessions } from "../hooks/use-sessions";
import type { AgendaViewProps } from "../index.client";
import { conflictsForAgendaView, conflictsTouchingSessions, createSessionDefaultDay, eventDayKeys, type AgendaView } from "../store";
import { AgendaToolbar } from "./agenda-toolbar";
import { AnnounceBundleTrigger } from "./announce-bundle-panel";
import ConflictsView from "./conflicts-view";
import DayView from "./day-view";
import { ListView } from "./list-view";
import RoomView from "./room-view";
import { SessionFormDialog } from "./session-form-dialog";
import TrackView from "./track-view";
import { ReadyToPromoteTray, UnscheduledTray } from "./unscheduled-tray";
import WeekView from "./week-view";

/**
 * The agenda's shell, and the only file in the repo that imports every view.
 *
 * The static imports above are the point: M30 and M31 own the *contents* of
 * `day-view.tsx` and the four grouped views, and never need to edit this file to
 * ship them. Every view receives the same `AgendaViewProps` — the live session
 * set including unscheduled rows, conflicts derived from that set, and the
 * vocabulary — so a view that wants a subset filters it in one line rather than
 * asking this module for a new prop.
 */
export type AgendaPageProps = Omit<AgendaViewProps, "onEdit" | "sessions" | "conflicts" | "accepted"> & {
  eventSlug: string;
  view: AgendaView;
  querySeeds: readonly QuerySeed[];
};

const EMPTY_SESSIONS: ScheduledSessionDTO[] = [];
const EMPTY_ACCEPTED: AcceptedForSchedulingRow[] = [];

export function AgendaPage({ querySeeds, ...props }: AgendaPageProps) {
  return <QueryBoundary seeds={querySeeds}><AgendaPageInner {...props} /></QueryBoundary>;
}

function AgendaPageInner({ eventSlug, view, ...props }: Omit<AgendaPageProps, "querySeeds">) {
  const router = useRouter();
  const params = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const eventDays = useMemo(
    () => eventDayKeys(props.event.startsAt, props.event.endsAt, props.event.timezone),
    [props.event.startsAt, props.event.endsAt, props.event.timezone],
  );
  const [activeGridDay, setActiveGridDay] = useState<string | null>(() => props.day ?? eventDays[0] ?? null);

  // Browser navigation and the single toolbar day rail still drive
  // `props.day`; retain a concrete first day when `?day=` is absent.
  useEffect(() => {
    const next = props.day && eventDays.includes(props.day) ? props.day : eventDays[0] ?? null;
    setActiveGridDay(next);
  }, [props.day, eventDays]);

  const sessionsQuery = useSessions(props.eventId);
  const acceptedQuery = useAcceptedForAgenda(props.eventId);
  const announceQuery = useAnnounceBundle(props.eventId);
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const accepted = acceptedQuery.data ?? EMPTY_ACCEPTED;
  const liveConflicts = useMemo(() => detectConflicts(sessions
    .map(toScheduledSession)
    .filter((session): session is NonNullable<typeof session> => session !== null)), [sessions]);

  const navigate = useCallback((next: { view?: AgendaView; day?: string | null }) => {
    const query = new URLSearchParams(params.toString());
    if (next.view !== undefined) query.set("view", next.view);
    if (next.day !== undefined) {
      if (next.day) query.set("day", next.day);
      else query.delete("day");
    }
    router.push(`?${query.toString()}`);
  }, [params, router]);

  const selectDay = useCallback((next: string | null) => {
    setActiveGridDay(next ?? eventDays[0] ?? null);
    navigate({ day: next });
  }, [eventDays, navigate]);

  const editing = useMemo(
    () => sessions.find((session) => String(session.id) === editingId) ?? null,
    [sessions, editingId],
  );

  // M58 — the command palette's session jump lands here as `?session=<id>`,
  // one-shot like the Abstracts view's `submission`/`arm` params: consumed on
  // arrival, then stripped so a later navigation or the back button doesn't
  // reopen it.
  useEffect(() => {
    const target = params.get("session");
    if (!target) return;
    setEditingId(target);
    const query = new URLSearchParams(params.toString());
    query.delete("session");
    router.replace(`?${query.toString()}`, { scroll: false });
  }, [params, router]);

  // One search box, at the top, filtering what every view receives — rather than
  // a second one inside the List view that disagrees with it.
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () => needle ? sessions.filter((session) => session.title.toLowerCase().includes(needle)) : sessions,
    [needle, sessions],
  );
  const displayedConflicts = useMemo(
    () => conflictsForAgendaView(liveConflicts, sessions, view, activeGridDay, props.event.timezone),
    [activeGridDay, liveConflicts, props.event.timezone, sessions, view],
  );
  const visibleConflicts = useMemo(
    () => needle ? conflictsTouchingSessions(displayedConflicts, visible) : displayedConflicts,
    [displayedConflicts, needle, visible],
  );

  const viewProps: AgendaViewProps = {
    ...props,
    sessions: visible,
    conflicts: liveConflicts,
    accepted,
    day: view === "day" ? activeGridDay : props.day ?? null,
    onEdit: setEditingId,
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="PROGRAM"
        title="Agenda"
        description="Build the schedule, resolve conflicts, and publish with confidence."
        actions={(
          <>
            <AnnounceBundleTrigger bundle={announceQuery.data ?? null} />
            <a className="button button-secondary" href={`/e/${eventSlug}/schedule`} target="_blank" rel="noreferrer">
              <Eye size={16} aria-hidden /> Public preview
            </a>
          </>
        )}
      />

      <AgendaToolbar
        view={view}
        day={view === "day" ? activeGridDay : props.day ?? null}
        conflictCount={liveConflicts.length}
        event={props.event}
        search={search}
        onSearch={setSearch}
        onView={(next) => navigate({ view: next })}
        onDay={selectDay}
        onCreate={() => setCreating(true)}
        eventId={String(props.eventId)}
      />

      {view === "list"
        ? <ListView {...viewProps} />
        : (
          <div className="agenda-workspace">
            {view === "day"
              ? <ReadyToPromoteTray eventId={props.eventId} accepted={accepted} />
              : <UnscheduledTray {...viewProps} />}
            <section className="day-grid">
              {view === "day" && <DayView {...viewProps} />}
              {view === "week" && <WeekView {...viewProps} />}
              {view === "track" && <TrackView {...viewProps} />}
              {view === "room" && <RoomView {...viewProps} />}
              {view === "conflicts" && (
                <ConflictsView
                  {...viewProps}
                  sessions={sessions}
                  conflicts={visibleConflicts}
                  searchActive={needle.length > 0}
                />
              )}
            </section>
          </div>
        )}

      <SessionFormDialog
        open={creating || editing !== null}
        onClose={() => { setCreating(false); setEditingId(null); }}
        session={creating ? null : editing}
        defaultDay={createSessionDefaultDay(view, activeGridDay, props.day ?? null)}
        eventId={props.eventId}
        event={props.event}
        rooms={props.rooms}
        tracks={props.tracks}
        formats={props.formats}
        speakers={props.speakers}
      />
    </div>
  );
}
