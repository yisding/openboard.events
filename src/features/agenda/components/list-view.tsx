"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CalendarDays, Plus } from "lucide-react";
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
import { AbstractDivergenceChip } from "./abstract-divergence-chip";
import { bulkPublishFailureMessage, bulkPublishPreflight, type BulkPublishPreflight } from "./bulk-publish-preflight";

/**
 * Every session for the event, scheduled or not.
 *
 * The unscheduled rows are the reason this view exists alongside the grid, so
 * each nullable cell renders through `<Dash>` rather than being filtered away —
 * a session with no room, no track and no time is a normal row here, not an
 * edge case that crashes the table.
 */
export function ListView({
  eventId,
  event,
  sessions,
  conflicts,
  rooms,
  tracks,
  formats,
  speakers,
  onEdit,
  onCreate,
  searchActive = false,
}: AgendaViewProps & { onCreate?: () => void; searchActive?: boolean }) {
  const { toast } = useToast();
  const { setPublished } = useSessionMutations(eventId);
  const [selected, setSelected] = useState<ScheduledSessionDTO[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [pendingPublish, setPendingPublish] = useState<BulkPublishPreflight | null>(null);
  const [publishBlockerCount, setPublishBlockerCount] = useState(0);

  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);

  const columns = useMemo<Array<ColumnDef<ScheduledSessionDTO, unknown>>>(() => [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      // `.data-table` is `table-layout:auto` and Date/Start–End/Room/Track/
      // Speakers/Status are all `white-space:nowrap`, so auto layout satisfies
      // them first and hands the whole width deficit to this, the only column
      // that wraps — collapsing it to roughly its longest word (#666: six
      // lines, one to three words each, at 1440px). The class is the seam
      // `globals.css` needs to give it a floor, same shape as the abstracts
      // table's `abstracts-title-column`.
      meta: { className: "agenda-title-column" },
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
      // "Published" alone is a claim about the public schedule, and a promoted
      // session drops out of it the moment its abstract stops being accepted.
      // The chip is what keeps the badge from being the last word.
      cell: ({ row }) => (
        <div className="agenda-status-cell">
          <StatusBadge value={row.original.status} />
          <AbstractDivergenceChip session={row.original} />
        </div>
      ),
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

  // Stable identity on purpose, as belt and braces. `DataTable` holds this
  // callback in a ref and notifies only when the selection itself changed (see
  // `data-table.tsx`), so an inline literal is safe there today — but this
  // handler clears the confirm dialog, and an unstable one re-fired on every
  // render used to wipe that state on the very render that opened it. Keeping
  // the identity stable stops that outcome depending on DataTable's internals.
  const onSelectionChanged = useCallback((rows: ScheduledSessionDTO[]) => {
    setSelected(rows);
    setPublishBlockerCount(0);
    setPendingPublish(null);
  }, []);

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
        onSelectionChange={onSelectionChanged}
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
            title={searchActive ? "No sessions match your search" : "No sessions yet"}
            description={searchActive
              ? "Try another session title or clear the search."
              : "Add a session to start building the schedule."}
            {...(!searchActive && onCreate ? { action: <Button onClick={onCreate}><Plus size={14} aria-hidden /> Add session</Button> } : {})}
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
          {/* Publishing is still allowed — the organizer may be re-accepting the
              abstract next — but the promise above is not true for these rows. */}
          {pendingPublish.notPublic.length > 0 && <> {pendingPublish.notPublic.length === 1
            ? "One of them was promoted from an abstract that is no longer accepted, so publishing will not put it on the public schedule."
            : `${pendingPublish.notPublic.length} of them were promoted from abstracts that are no longer accepted, so publishing will not put those on the public schedule.`}</>}
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
