"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ScheduledSessionDTO, SessionId } from "@/shared/contracts";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { DataTable, nullsLast } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useToast } from "@/shared/ui/toast";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";
import { useSessionMutations } from "../hooks/use-session-mutations";
import type { AgendaViewProps } from "../index.client";
import { conflictsForSession, nameLookup } from "../store";
import { bulkPublishFailureMessage, bulkPublishPreflight, type BulkPublishPreflight } from "./bulk-publish-preflight";

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
  const [pendingPublish, setPendingPublish] = useState<BulkPublishPreflight | null>(null);
  const [publishBlockerCount, setPublishBlockerCount] = useState(0);

  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);

  // Stable identity is load-bearing, not cosmetic: `DataTable` re-invokes this
  // callback from a `useEffect` keyed on its own identity, so an inline arrow
  // here (a fresh function every ListView render) re-fires that effect on
  // *every* re-render of this component — including the one triggered by
  // `setPendingPublish(preflight)` itself, which immediately clobbers that
  // same state back to null before the confirm dialog can ever paint.
  const handleSelectionChange = useCallback((rows: ScheduledSessionDTO[]) => {
    setSelected(rows);
    setPublishBlockerCount(0);
    setPendingPublish(null);
  }, []);

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

  const bulk = async (published: boolean, rows: readonly ScheduledSessionDTO[] = selected): Promise<boolean> => {
    const ids = rows.map((session) => session.id as SessionId);
    if (ids.length === 0) return false;
    try {
      const result = await setPublished.mutateAsync({ ids, published });
      setSelected([]);
      setPublishBlockerCount(0);
      setSelectionEpoch((epoch) => epoch + 1);
      toast(result.changed === 0
        ? "Nothing to change — those sessions were already in that state"
        : `${result.changed} session${result.changed === 1 ? "" : "s"} ${published ? "published" : "unpublished"}${result.emailsQueued > 0 ? `, ${result.emailsQueued} speaker email${result.emailsQueued === 1 ? "" : "s"} queued` : ""}`);
      return true;
    } catch (caught) {
      toast(bulkPublishFailureMessage(published, caught), { kind: "error" });
      return false;
    }
  };

  function reviewPublish(rows: readonly ScheduledSessionDTO[] = selected) {
    const preflight = bulkPublishPreflight(rows, conflicts);
    setPublishBlockerCount(0);
    if (preflight.candidates.length === 0) {
      toast("Nothing to change — those sessions are already published");
      return;
    }
    if (preflight.unscheduled.length > 0) {
      setPublishBlockerCount(preflight.unscheduled.length);
      toast(`Schedule ${preflight.unscheduled.length} selected session${preflight.unscheduled.length === 1 ? "" : "s"} before publishing`, { kind: "error" });
      return;
    }
    setPendingPublish(preflight);
  }

  return (
    <section className="panel data-panel">
      {publishBlockerCount > 0 && (
        <div className="agenda-publish-alert" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>
            Schedule {publishBlockerCount} selected session{publishBlockerCount === 1 ? "" : "s"} before publishing.
            Unscheduled sessions are not visible on the public schedule.
          </span>
        </div>
      )}
      <DataTable
        columns={columns}
        data={sessions}
        enableSelection
        getRowLabel={(row) => `${row.title}${row.startsAt ? "" : ", unscheduled"}`}
        selectionEpoch={selectionEpoch}
        columnVisibilityKey={`agenda-list:${eventId}`}
        getRowId={(row) => String(row.id)}
        onSelectionChange={handleSelectionChange}
        renderSelectionBar={({ selectedRows, countLabel, clearSelection }) => (
          <BulkActionBar
            count={selectedRows.length}
            countLabel={countLabel}
            onClear={clearSelection}
            actions={<>
              {/* `data-tour`: the canonical bulk-selection bar only exists while
                  rows are selected, so the guided tour has nothing to wait on
                  until the organizer has already acted. */}
              <Button data-tour="agenda.publish" size="sm" variant="secondary" disabled={setPublished.isPending} onClick={() => reviewPublish(selectedRows)}>Publish selected</Button>
              <Button size="sm" variant="secondary" disabled={setPublished.isPending} onClick={() => { void bulk(false, selectedRows); }}>Unpublish selected</Button>
            </>}
          />
        )}
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
      <ConfirmDialog
        open={pendingPublish !== null}
        variant="destructive"
        title={`Publish ${pendingPublish?.candidates.length ?? 0} session${pendingPublish?.candidates.length === 1 ? "" : "s"}?`}
        body={pendingPublish ? <>
          They will become visible on the public schedule. This will queue up to {pendingPublish.emailFanout} speaker schedule email{pendingPublish.emailFanout === 1 ? "" : "s"}.
          {pendingPublish.conflictCount > 0 && <> {pendingPublish.conflictCount} existing conflict{pendingPublish.conflictCount === 1 ? "" : "s"} will remain; publishing does not resolve them.</>}
        </> : ""}
        confirmLabel={pendingPublish && pendingPublish.emailFanout > 0
          ? `Publish and queue up to ${pendingPublish.emailFanout} email${pendingPublish.emailFanout === 1 ? "" : "s"}`
          : "Publish sessions"}
        onConfirm={async () => {
          if (pendingPublish && await bulk(true, pendingPublish.candidates)) setPendingPublish(null);
        }}
        onCancel={() => setPendingPublish(null)}
      />
    </section>
  );
}
