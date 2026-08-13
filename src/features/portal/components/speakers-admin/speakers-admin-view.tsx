"use client";

import { Bell, Mail, Plus, Search, Upload, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { ContactFilters, ContactListRow } from "@/features/portal";
import type { ConfirmationStatus } from "@/shared/contracts";
import { CONFIRMATION_STATUSES } from "@/shared/contracts";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { useFlowKeyboardNav } from "@/shared/ui/app/use-flow-keyboard-nav";
import { Button, EmptyState, PageHeader, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { SpeakerBulkEmailDialog } from "./speaker-bulk-email-dialog";
import { SpeakerCreateDialog } from "./speaker-create-dialog";
import { SpeakerFlowDrawer } from "./speaker-flow-drawer";
import { SpeakerHeadshot } from "./speaker-headshot";
import { SpeakerImportDialog } from "./speaker-import-dialog";

type Sort = NonNullable<ContactFilters["sort"]>;
type Dir = NonNullable<ContactFilters["dir"]>;
type Missing = NonNullable<ContactFilters["missing"]>;

const SORT_TO_STATE: Record<Sort, string> = { name: "speaker", openTasks: "tasks", confirmation: "confirmation" };
const STATE_TO_SORT: Record<string, Sort> = { speaker: "name", tasks: "openTasks", confirmation: "confirmation" };

/** Two-initial fallback for a speaker with no usable headshot — never a broken image. */
function initialsFor(row: ContactListRow): string {
  const parts = row.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return row.email.slice(0, 2).toUpperCase();
}

/**
 * The Speakers admin table over real `contacts`/view rows (this module's
 * headline "moved off fixtures" change). Filters, sort and pagination all live
 * in the URL — `SPEAKERS_DEEPLINK_PARAMS` (M02 §9b) — so the dashboard's
 * missing-asset links and the browser back button both do what they look like
 * they do.
 */
export function SpeakersAdminView({
  eventId,
  rows,
  total,
  page,
  pageSize,
  q,
  accepted,
  missing,
  confirmation,
  sort,
  dir,
}: {
  eventId: string;
  rows: ContactListRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  accepted: boolean;
  missing: Missing | null;
  confirmation: ConfirmationStatus | null;
  sort: Sort;
  dir: Dir;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [draftSearch, setDraftSearch] = useState(q);
  useEffect(() => setDraftSearch(q), [q]);
  const [selected, setSelected] = useState<ContactListRow[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  // M58 — bumped to select every row on screen: a command-palette verb
  // ("Email speakers missing bio or headshot…") lands on `?missing=either&arm=1`
  // and the bulk bar is already showing the count and its actions.
  const [selectAllEpoch, setSelectAllEpoch] = useState(0);
  useEffect(() => {
    if (params.get("arm") !== "1") return;
    setSelectAllEpoch((epoch) => epoch + 1);
    const query = new URLSearchParams(params.toString());
    query.delete("arm");
    router.replace(`?${query.toString()}`, { scroll: false });
  }, [params, router]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [confirmReminders, setConfirmReminders] = useState(false);
  const [reminding, setReminding] = useState(false);
  // M57 — the row a click opens: a flow-through slide-over over this page's
  // rows, not a navigation. The full editable profile is one click further,
  // from inside the drawer.
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const rowIds = useMemo(() => rows.map((row) => row.contactId as string), [rows]);
  const reminderTargetCount = selected.filter((row) => row.openTasks > 0).length;
  useFlowKeyboardNav({ ids: rowIds, activeId: openContactId, onNavigate: setOpenContactId, onClose: () => setOpenContactId(null) });
  const openIndex = openContactId ? rowIds.indexOf(openContactId) : -1;
  const openRow = openIndex !== -1 ? rows[openIndex] : undefined;

  async function bulkRemind(): Promise<boolean> {
    // Reuses M52's generic bulk-reminder mutation (`sendRemindersNow` behind
    // `/api/internal/deliverables/remind`) — it operates on any
    // (taskId, contactId, submissionId) triple from `task_assignments_v`,
    // not only file-request tasks, so nudging every open assignment for a
    // batch of speakers is the same call the Files view already makes.
    const targets = selected.filter((row) => row.openTasks > 0);
    if (targets.length === 0) {
      toast("Nothing to remind — every selected speaker is caught up");
      return false;
    }
    setReminding(true);
    try {
      const perSpeaker = await Promise.all(targets.map(async (row) => {
        const response = await fetch(`/api/internal/comms/${eventId}/open-assignments?contactId=${row.contactId}`);
        const payload = await response.json().catch(() => null) as { data?: Array<{ taskId: string; submissionId: string | null }> } | null;
        if (!response.ok || !payload?.data) throw new Error("assignment lookup failed");
        return payload.data.map((assignment) => ({ taskId: assignment.taskId, contactId: row.contactId, submissionId: assignment.submissionId }));
      }));
      const flatTargets = perSpeaker.flat();
      if (flatTargets.length === 0) {
        toast("Nothing to remind — every selected speaker is caught up");
        return false;
      }
      const response = await fetch(`/api/internal/deliverables/remind?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: flatTargets }),
      });
      const payload = await response.json().catch(() => null) as { data?: { enqueued: number; total: number } } | null;
      if (!response.ok || !payload?.data) {
        toast("Could not send reminders — try again", { kind: "error" });
        return false;
      }
      toast(`Reminded ${payload.data.enqueued} of ${payload.data.total} assignment${payload.data.total === 1 ? "" : "s"}`);
      setSelected([]);
      setSelectionEpoch((epoch) => epoch + 1);
      return true;
    } catch {
      toast("Could not load or send reminders — try again", { kind: "error" });
      return false;
    } finally {
      setReminding(false);
    }
  }

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    if (resetPage) query.delete("page");
    router.push(`?${query.toString()}`);
  };

  const columns = useMemo<Array<ColumnDef<ContactListRow, unknown>>>(() => [
    {
      id: "speaker",
      header: "Speaker",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="speaker-table-person">
          <SpeakerHeadshot name={row.original.name} initials={initialsFor(row.original)} headshotFileId={row.original.headshotFileId} />
          <div className="speaker-table-person-copy">
            <b>{row.original.name}</b>
            <span>{row.original.jobTitle ?? ""}{row.original.jobTitle && row.original.company ? " · " : ""}{row.original.company ?? ""}</span>
            <small>{row.original.email}</small>
          </div>
        </div>
      ),
    },
    {
      id: "confirmation",
      header: "Confirmation",
      accessorKey: "confirmationStatus",
      cell: ({ row }) => <StatusBadge value={row.original.confirmationStatus} />,
    },
    {
      id: "submissions",
      header: "Submissions",
      accessorKey: "submissionCount",
      enableSorting: false,
      cell: ({ row }) => <span className="session-count">{row.original.submissionCount}</span>,
    },
    {
      id: "tasks",
      header: "Tasks",
      accessorKey: "openTasks",
      cell: ({ row }) => {
        const { openTasks: open, overdueTasks: overdue } = row.original;
        if (open === 0 && overdue === 0) return <StatusBadge value="Ready" />;
        return <span>{open} open{overdue > 0 ? <> · <span style={{ color: "var(--red)" }}>{overdue} overdue</span></> : null}</span>;
      },
    },
    {
      id: "missing",
      header: "Missing",
      enableSorting: false,
      cell: ({ row }) => {
        const { missingBio, missingHeadshot } = row.original;
        if (!missingBio && !missingHeadshot) return <Dash />;
        return <div className="chip-picker">{missingBio && <span className="chip">Bio</span>}{missingHeadshot && <span className="chip">Headshot</span>}</div>;
      },
    },
  ], []);

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Speakers"
        description="Every contact for this event, with confirmation, profile and onboarding status."
        actions={<>
          <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import CSV</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> Add speaker</Button>
        </>}
      />

      <div className="abstract-status-tabs" role="group" aria-label="Filter speakers">
        <button type="button" aria-pressed={!accepted && !missing} className={!accepted && !missing ? "active" : ""} onClick={() => setParams({ accepted: null, missing: null })}>All</button>
        <button type="button" aria-pressed={accepted} className={accepted ? "active" : ""} onClick={() => setParams({ accepted: accepted ? null : "1" })}>Accepted speakers</button>
        <button type="button" aria-pressed={missing === "bio"} className={missing === "bio" ? "active" : ""} onClick={() => setParams({ missing: missing === "bio" ? null : "bio" })}>Missing bio</button>
        <button type="button" aria-pressed={missing === "headshot"} className={missing === "headshot" ? "active" : ""} onClick={() => setParams({ missing: missing === "headshot" ? null : "headshot" })}>Missing headshot</button>
        <button type="button" aria-pressed={missing === "either"} className={missing === "either" ? "active" : ""} onClick={() => setParams({ missing: missing === "either" ? null : "either" })}>Missing bio or headshot</button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        columnVisibilityKey={`speakers:${eventId}`}
        getRowId={(row) => row.contactId}
        onRowClick={(row) => setOpenContactId(row.contactId)}
        enableSelection
        getRowLabel={(row) => row.name || row.email}
        onSelectionChange={setSelected}
        renderSelectionBar={({ selectedRows, countLabel, clearSelection }) => {
          const reminderCount = selectedRows.filter((row) => row.openTasks > 0).length;
          return <BulkActionBar
            count={selectedRows.length}
            countLabel={countLabel}
            onClear={clearSelection}
            actions={<>
              <Button size="sm" onClick={() => { setSelected(selectedRows); setBulkEmailOpen(true); }}><Mail size={14} /> Email selected</Button>
              <Button size="sm" variant="secondary" disabled={reminding || reminderCount === 0} onClick={() => { setSelected(selectedRows); setConfirmReminders(true); }}>
                <Bell size={14} /> {reminding ? "Reminding…" : "Send reminder"}
              </Button>
            </>}
          />;
        }}
        selectionEpoch={selectionEpoch}
        selectAllEpoch={selectAllEpoch}
        serverPagination={{ page, pageSize, total, onPageChange: (next) => setParams({ page: next > 1 ? String(next) : null }, false) }}
        serverSorting={{
          state: [{ id: SORT_TO_STATE[sort], desc: dir === "desc" }],
          onChange: (state: SortingState) => {
            const [entry] = state;
            setParams({ sort: entry ? STATE_TO_SORT[entry.id] ?? "name" : null, dir: entry?.desc ? "desc" : null }, false);
          },
        }}
        toolbar={
          <>
            <form
              className="table-search"
              onSubmit={(event) => { event.preventDefault(); setParams({ q: draftSearch || null }); }}
            >
              <Search size={16} />
              <input
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder="Search name or email"
                aria-label="Search speakers"
              />
              {draftSearch && <button type="button" aria-label="Clear search" onClick={() => { setDraftSearch(""); setParams({ q: null }); }}><X size={14} /></button>}
            </form>
            <Select
              className="compact-select"
              aria-label="Filter by confirmation"
              value={confirmation ?? "all"}
              onChange={(event) => setParams({ confirmation: event.target.value === "all" ? null : event.target.value })}
            >
              <option value="all">All confirmations</option>
              {CONFIRMATION_STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase()}{status.slice(1)}</option>)}
            </Select>
            <span className="row-count">{total} shown</span>
          </>
        }
        empty={
          <EmptyState
            icon={<Users size={20} />}
            title={q || accepted || missing || confirmation ? "Nothing matches these filters" : "No speakers yet"}
            description={q || accepted || missing || confirmation ? "Try clearing a filter or search term." : "Contacts appear here once a proposal names them as a speaker."}
          />
        }
      />

      <SpeakerCreateDialog eventId={eventId} open={createOpen} onClose={() => { setCreateOpen(false); router.refresh(); }} />
      <SpeakerImportDialog eventId={eventId} open={importOpen} onClose={() => setImportOpen(false)} />
      {bulkEmailOpen && (
        <SpeakerBulkEmailDialog
          eventId={eventId}
          open={bulkEmailOpen}
          selected={selected}
          onClose={() => { setBulkEmailOpen(false); setSelected([]); setSelectionEpoch((epoch) => epoch + 1); }}
        />
      )}
      {openRow && (
        <SpeakerFlowDrawer
          eventId={eventId}
          row={openRow}
          onClose={() => setOpenContactId(null)}
          nav={{
            index: openIndex,
            total: rowIds.length,
            ...(rowIds[openIndex - 1] ? { onPrev: () => setOpenContactId(rowIds[openIndex - 1] as string) } : {}),
            ...(rowIds[openIndex + 1] ? { onNext: () => setOpenContactId(rowIds[openIndex + 1] as string) } : {}),
          }}
        />
      )}
      <ConfirmDialog
        open={confirmReminders}
        title={`Send reminders to ${reminderTargetCount} speaker${reminderTargetCount === 1 ? "" : "s"}?`}
        body="This immediately queues a reminder for every open assignment belonging to the selected speakers. Suppression and current task state are rechecked before delivery."
        confirmLabel="Queue reminders"
        onConfirm={async () => { if (await bulkRemind()) setConfirmReminders(false); }}
        onCancel={() => setConfirmReminders(false)}
      />
    </div>
  );
}
