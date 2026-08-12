"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduledSessionDTO } from "@/shared/contracts";
import { PageHeader } from "@/shared/ui/ui-kit";
import { useSessions } from "../hooks/use-sessions";
import type { AgendaViewProps } from "../index.client";
import type { AnnounceBundle } from "../server/announce";
import type { AgendaView } from "../store";
import { AgendaToolbar } from "./agenda-toolbar";
import { AnnounceBundleTrigger } from "./announce-bundle-panel";
import ConflictsView from "./conflicts-view";
import DayView from "./day-view";
import { ListView } from "./list-view";
import RoomView from "./room-view";
import { SessionFormDialog } from "./session-form-dialog";
import TrackView from "./track-view";
import { UnscheduledTray } from "./unscheduled-tray";
import WeekView from "./week-view";

/**
 * The agenda's shell, and the only file in the repo that imports every view.
 *
 * The static imports above are the point: M30 and M31 own the *contents* of
 * `day-view.tsx` and the four grouped views, and never need to edit this file to
 * ship them. Every view receives the same `AgendaViewProps` — the full session
 * set including unscheduled rows, the server's conflict list, and the
 * vocabulary — so a view that wants a subset filters it in one line rather than
 * asking this module for a new prop.
 */
export type AgendaPageProps = Omit<AgendaViewProps, "onEdit"> & {
  eventSlug: string;
  view: AgendaView;
  /** M60 — null when nothing is published yet; the trigger renders nothing until then. */
  announceBundle?: AnnounceBundle | null;
};

export function AgendaPage(props: AgendaPageProps) {
  // Its own client, matching the dashboard's pattern: the app has no global
  // provider, and the agenda's cache has no reason to outlive this route.
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><AgendaPageInner {...props} /></QueryClientProvider>;
}

function AgendaPageInner({ eventSlug, view, announceBundle = null, ...props }: AgendaPageProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  // Server-rendered rows seed the cache, so the first paint costs no request and
  // a save still has one key to invalidate.
  const sessionsQuery = useSessions(props.eventId, props.sessions);
  const sessions: ScheduledSessionDTO[] = sessionsQuery.data ?? props.sessions;

  const navigate = useCallback((next: { view?: AgendaView; day?: string | null }) => {
    const query = new URLSearchParams(params.toString());
    if (next.view !== undefined) query.set("view", next.view);
    if (next.day !== undefined) {
      if (next.day) query.set("day", next.day);
      else query.delete("day");
    }
    router.push(`?${query.toString()}`);
  }, [params, router]);

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
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? sessions.filter((session) => session.title.toLowerCase().includes(needle)) : sessions;
  }, [search, sessions]);

  const viewProps: AgendaViewProps = { ...props, sessions: visible, onEdit: setEditingId };

  return (
    <main className="page">
      <PageHeader
        eyebrow="PROGRAM"
        title="Agenda"
        description="Build the schedule, resolve conflicts, and publish with confidence."
        actions={(
          <>
            <AnnounceBundleTrigger bundle={announceBundle} />
            <a className="button button-secondary" href={`/e/${eventSlug}/schedule`} target="_blank" rel="noreferrer">
              <Eye size={16} aria-hidden /> Public preview
            </a>
          </>
        )}
      />

      <AgendaToolbar
        view={view}
        day={props.day ?? null}
        conflictCount={props.conflicts.length}
        event={props.event}
        search={search}
        onSearch={setSearch}
        onView={(next) => navigate({ view: next })}
        onDay={(next) => navigate({ day: next })}
        onCreate={() => setCreating(true)}
        eventId={String(props.eventId)}
      />

      {view === "list"
        ? <ListView {...viewProps} />
        : (
          <div className="agenda-workspace">
            <UnscheduledTray {...viewProps} />
            <section className="day-grid">
              {view === "day" && <DayView {...viewProps} />}
              {view === "week" && <WeekView {...viewProps} />}
              {view === "track" && <TrackView {...viewProps} />}
              {view === "room" && <RoomView {...viewProps} />}
              {view === "conflicts" && <ConflictsView {...viewProps} />}
            </section>
          </div>
        )}

      <SessionFormDialog
        open={creating || editing !== null}
        onClose={() => { setCreating(false); setEditingId(null); }}
        session={creating ? null : editing}
        eventId={props.eventId}
        event={props.event}
        rooms={props.rooms}
        tracks={props.tracks}
        formats={props.formats}
        speakers={props.speakers}
      />
    </main>
  );
}
