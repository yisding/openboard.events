"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import type { ScheduledSessionDTO, SessionId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { DataTable, nullsLast } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useToast } from "@/shared/ui/toast";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";
import { useSessionMutations } from "../hooks/use-session-mutations";
import type { AgendaViewProps } from "../index.client";
import { conflictsForSession, nameLookup } from "../store";

/**
 * Every session for the event, scheduled or not.
 *
 * The unscheduled rows are the reason this view exists alongside the grid, so
 * each nullable cell renders through `<Dash>` rather than being filtered away —
 * a session with no room, no track and no time is a normal row here, not an
 * edge case that crashes the table.
 */
export function ListView({ eventId, event, sessions, conflicts, rooms, tracks, formats, speakers, onEdit }: AgendaViewProps) {
  const { toast } = useToast();
  const { setPublished } = useSessionMutations(eventId);
  const [selected, setSelected] = useState<ScheduledSessionDTO[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);

  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);

  const columns = useMemo<Array<ColumnDef<ScheduledSessionDTO, unknown>>>(() => [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      cell: ({ row }) => {
        const overlaps = conflictsForSession(conflicts, row.original.id);
        return (
          <div className="submission-title-cell">
            <b>{row.original.title}</b>
            {overlaps.length > 0 && (
              <span className="agenda-conflict-chip">
                <AlertTriangle size={11} aria-hidden /> {overlaps.length} conflict{overlaps.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "date",
      header: "Date",
      accessorFn: (row) => row.startsAt,
      sortingFn: nullsLast,
      cell: ({ row }) => <TzTime instant={row.original.startsAt} tz={event.timezone} style="date" />,
    },
    {
      id: "time",
      header: "Start – End",
      accessorFn: (row) => row.startsAt,
      enableSorting: false,
      cell: ({ row }) => row.original.startsAt === null || row.original.endsAt === null
        ? <Dash />
        : (
          <span>
            <TzTime instant={row.original.startsAt} tz={event.timezone} style={{ hour: "numeric", minute: "2-digit" }} />
            {" – "}
            <TzTime instant={row.original.endsAt} tz={event.timezone} style={{ hour: "numeric", minute: "2-digit" }} />
          </span>
        ),
    },
    {
      id: "room",
      header: "Room",
      accessorFn: (row) => lookup.room(row.roomId),
      sortingFn: nullsLast,
      cell: ({ row }) => <Dash value={lookup.room(row.original.roomId)} />,
    },
    {
      id: "track",
      header: "Track",
      accessorFn: (row) => lookup.track(row.trackId)?.name ?? null,
      sortingFn: nullsLast,
      cell: ({ row }) => {
        const track = lookup.track(row.original.trackId);
        return track ? <ColorChip label={track.name} color={track.color} /> : <Dash />;
      },
    },
    {
      id: "speakers",
      header: "Speakers",
      accessorFn: (row) => lookup.speakers(row.speakerIds)[0] ?? null,
      enableSorting: false,
      cell: ({ row }) => {
        const names = lookup.speakers(row.original.speakerIds);
        return <Dash value={names[0]}><span>{names.join(", ")}</span></Dash>;
      },
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      enableSorting: false,
      cell: ({ row }) => <StatusBadge value={row.original.status} />,
    },
  ], [conflicts, event.timezone, lookup]);

  const bulk = async (published: boolean) => {
    const ids = selected.map((session) => session.id as SessionId);
    if (ids.length === 0) return;
    try {
      const result = await setPublished.mutateAsync({ ids, published });
      setSelected([]);
      setSelectionEpoch((epoch) => epoch + 1);
      toast(result.changed === 0
        ? "Nothing to change — those sessions were already in that state"
        : `${result.changed} session${result.changed === 1 ? "" : "s"} ${published ? "published" : "unpublished"}${result.emailsQueued > 0 ? `, ${result.emailsQueued} speaker email${result.emailsQueued === 1 ? "" : "s"} queued` : ""}`);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "Could not update those sessions");
    }
  };

  return (
    <section className="panel data-panel">
      {selected.length > 0 && (
        <div className="bulk-bar">
          <span>{selected.length} selected</span>
          <Button size="sm" variant="secondary" disabled={setPublished.isPending} onClick={() => { void bulk(true); }}>Publish selected</Button>
          <Button size="sm" variant="secondary" disabled={setPublished.isPending} onClick={() => { void bulk(false); }}>Unpublish selected</Button>
          <button type="button" onClick={() => { setSelected([]); setSelectionEpoch((epoch) => epoch + 1); }}>Clear</button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={sessions}
        enableSelection
        selectionEpoch={selectionEpoch}
        columnVisibilityKey={`agenda-list:${eventId}`}
        getRowId={(row) => String(row.id)}
        onSelectionChange={setSelected}
        {...(onEdit ? { onRowClick: (row: ScheduledSessionDTO) => onEdit(String(row.id)) } : {})}
        toolbar={<span className="row-count">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>}
        empty={(
          <EmptyState
            icon={<CalendarDays size={26} />}
            title="Nothing here yet"
            description="Sessions will appear here in list view"
          />
        )}
      />
    </section>
  );
}
