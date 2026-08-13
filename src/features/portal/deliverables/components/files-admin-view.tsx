"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Bell, Download, FolderOpen, MessageSquare, Paperclip, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeliverableRowDTO, FileCommentDTO, FileExportJobDTO, FileVersionDTO } from "@/shared/contracts";
import type { DeliverableStateCounts } from "@/features/portal/deliverables";
import { DELIVERABLE_BULK_LIMIT } from "@/features/portal/deliverables/bulk-limit";
import { DataTable } from "@/shared/ui/app/data-table";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { Dash } from "@/shared/ui/app/dash";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { Button, Drawer, EmptyState, PageHeader, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { deliverableBulkTargets, filesSelectionBarState } from "./files-selection";

type State = "all" | "open" | "overdue" | "completed";
type HasUpload = "" | "yes" | "no";

const FILES_ALL_ROWS_SELECTION = {
  maxRows: DELIVERABLE_BULK_LIMIT,
  singularNoun: "deliverable",
  pluralNoun: "deliverables",
} as const;

function sizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusOf(row: DeliverableRowDTO): "Completed" | "Overdue" | "Open" {
  if (row.completed) return "Completed";
  if (row.overdue) return "Overdue";
  return "Open";
}

type DeliverableDetail = {
  key: string;
  status: "loading" | "ready" | "error";
  versions: FileVersionDTO[];
  comments: FileCommentDTO[];
  error: string;
};

type CommentDraft = {
  key: string | null;
  id: string;
  body: string;
  attemptedId: string | null;
  attemptedBody: string | null;
};
type CommentDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type CommentDraftStorageProvider = () => CommentDraftStorage;

const browserCommentDraftStorage: CommentDraftStorageProvider = () => localStorage;

export function fileCommentDraftStorageKey(eventId: string, detailKey: string): string {
  return `openboard:files-comment:${eventId}:${detailKey}`;
}

export function parseStoredCommentDraft(value: string | null, expectedKey: string): CommentDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CommentDraft>;
    if (parsed.key !== expectedKey || typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id) || typeof parsed.body !== "string") return null;
    const body = parsed.body.slice(0, 5_000);
    return {
      key: expectedKey,
      id: parsed.id,
      body,
      // Markers written before attemptedBody was introduced represented an
      // in-flight request, so treating their canonical body as attempted is
      // the safe backwards-compatible interpretation.
      attemptedId: typeof parsed.attemptedId === "string" && /^[0-9a-f-]{36}$/i.test(parsed.attemptedId)
        ? parsed.attemptedId
        : parsed.id,
      attemptedBody: typeof parsed.attemptedBody === "string" ? parsed.attemptedBody.slice(0, 5_000) : body.trim(),
    };
  } catch {
    return null;
  }
}

export function commentDraftAfterEdit(
  current: CommentDraft,
  key: string,
  body: string,
  createId: () => string = () => crypto.randomUUID(),
): CommentDraft {
  const sameDraft = current.key === key && current.id;
  if (!sameDraft) return { key, id: createId(), body, attemptedId: null, attemptedBody: null };
  const matchesAttempt = current.attemptedId !== null
    && current.attemptedBody !== null
    && body.trim() === current.attemptedBody;
  const firstEditAfterAttempt = current.attemptedId !== null
    && current.attemptedBody !== null
    && current.id === current.attemptedId
    && !matchesAttempt;
  return {
    key,
    id: matchesAttempt ? (current.attemptedId ?? current.id) : firstEditAfterAttempt ? createId() : current.id,
    body,
    attemptedId: current.attemptedId,
    attemptedBody: current.attemptedBody,
  };
}

export function loadStoredCommentDraft(
  storageKey: string,
  expectedKey: string,
  getStorage: CommentDraftStorageProvider = browserCommentDraftStorage,
): CommentDraft | null {
  try {
    return parseStoredCommentDraft(getStorage().getItem(storageKey), expectedKey);
  } catch {
    return null;
  }
}

export function persistStoredCommentDraft(
  storageKey: string,
  draft: CommentDraft,
  getStorage: CommentDraftStorageProvider = browserCommentDraftStorage,
): boolean {
  try {
    getStorage().setItem(storageKey, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredCommentDraft(
  storageKey: string,
  getStorage: CommentDraftStorageProvider = browserCommentDraftStorage,
): boolean {
  try {
    getStorage().removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function visibleDeliverableDetail(detail: DeliverableDetail, key: string): DeliverableDetail {
  return detail.key === key
    ? detail
    : { key, status: "loading", versions: [], comments: [], error: "" };
}

export function deliverableDetailPaths(eventId: string, target: {
  fileRequestId: string;
  contactId: string;
  submissionId: string | null;
}) {
  const query = `eventId=${encodeURIComponent(eventId)}&fileRequestId=${encodeURIComponent(target.fileRequestId)}&contactId=${encodeURIComponent(target.contactId)}${target.submissionId ? `&submissionId=${encodeURIComponent(target.submissionId)}` : ""}`;
  return {
    versions: `/api/internal/deliverables/versions?${query}`,
    comments: `/api/internal/deliverables/comments?${query}`,
  };
}

async function detailPayload<T>(response: Response, fallback: string): Promise<T[]> {
  const payload = await response.json().catch(() => null) as { data?: T[]; error?: { message?: string } } | null;
  if (!response.ok || !Array.isArray(payload?.data)) {
    throw new Error(payload?.error?.message ?? fallback);
  }
  return payload.data;
}

export async function fetchDeliverableDetail(
  paths: ReturnType<typeof deliverableDetailPaths>,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<{ versions: FileVersionDTO[]; comments: FileCommentDTO[] }> {
  const fetcher = options.fetcher ?? fetch;
  const init = options.signal ? { signal: options.signal } : undefined;
  const [versionsResponse, commentsResponse] = await Promise.all([
    fetcher(paths.versions, init),
    fetcher(paths.comments, init),
  ]);
  const [versions, comments] = await Promise.all([
    detailPayload<FileVersionDTO>(versionsResponse, "Could not load file versions"),
    detailPayload<FileCommentDTO>(commentsResponse, "Could not load comments"),
  ]);
  return { versions, comments };
}

/**
 * The central Files view (M52): every file-request deliverable across the
 * event, filterable by task, file request, speaker, completion state and
 * version, with a bulk "remind" bar over the selected rows and a slide-over
 * for a slot's version history and comment thread.
 *
 * Filters live in the URL, not in component state — the same discipline
 * `AbstractsView` keeps for Abstracts. `rows` is already the server's answer
 * to the current query string; a colleague sent the link sees the same
 * table, and the back button behaves like it looks like it should.
 */
export function FilesAdminView({
  eventId,
  rows,
  counts,
  state,
  taskId,
  fileRequestId,
  hasUpload,
  search,
  fileRequests,
  tasks,
}: {
  eventId: string;
  rows: DeliverableRowDTO[];
  counts: DeliverableStateCounts;
  state: State;
  taskId: string;
  fileRequestId: string;
  hasUpload: HasUpload;
  search: string;
  fileRequests: Array<{ id: string; title: string }>;
  tasks: Array<{ id: string; name: string }>;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [draftSearch, setDraftSearch] = useState(search);
  useEffect(() => setDraftSearch(search), [search]);
  const [selected, setSelected] = useState<DeliverableRowDTO[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [reminding, setReminding] = useState(false);
  const [active, setActive] = useState<DeliverableRowDTO | null>(null);
  const [exportJob, setExportJob] = useState<FileExportJobDTO | null>(null);
  const [exporting, setExporting] = useState(false);

  const onFilter = useCallback((next: Partial<{ state: State; taskId: string; fileRequestId: string; hasUpload: HasUpload; search: string }>) => {
    const query = new URLSearchParams(params.toString());
    if (next.state !== undefined) { if (next.state === "all") query.delete("state"); else query.set("state", next.state); }
    if (next.taskId !== undefined) { if (next.taskId) query.set("taskId", next.taskId); else query.delete("taskId"); }
    if (next.fileRequestId !== undefined) { if (next.fileRequestId) query.set("fileRequestId", next.fileRequestId); else query.delete("fileRequestId"); }
    if (next.hasUpload !== undefined) {
      if (next.hasUpload === "yes") query.set("hasUpload", "true");
      else if (next.hasUpload === "no") query.set("hasUpload", "false");
      else query.delete("hasUpload");
    }
    if (next.search !== undefined) { if (next.search) query.set("search", next.search); else query.delete("search"); }
    router.push(`?${query.toString()}`);
  }, [params, router]);

  // The search box updates as an organizer types, but every keystroke does
  // not need its own server round trip: debounced the same 300ms a live
  // filter-as-you-type box elsewhere in the app would use, and a change
  // elsewhere in the URL (a tab click) still lands immediately.
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(next: string) {
    setDraftSearch(next);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => onFilter({ search: next }), 300);
  }
  useEffect(() => () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); }, []);
  function clearSearch() {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    setDraftSearch("");
    onFilter({ search: "" });
  }

  // Local mirror of the server-filtered `rows` prop: the table renders this,
  // not the prop directly, so an in-place comment-count bump (below) does not
  // have to wait on a full navigation to be visible.
  const [displayRows, setDisplayRows] = useState(rows);
  useEffect(() => setDisplayRows(rows), [rows]);

  async function bulkRemind(selection = selected) {
    const targets = selection.filter((row) => !row.completed);
    if (targets.length === 0) {
      toast("Nothing to remind — every selected row is already complete");
      return;
    }
    setReminding(true);
    try {
      const response = await fetch(`/api/internal/deliverables/remind?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targets: deliverableBulkTargets(targets),
        }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: { enqueued: number; total: number } } | null;
      if (!response?.ok || !payload?.data) {
        toast("Could not send reminders — try again", { kind: "error" });
        return;
      }
      toast(`Reminded ${payload.data.enqueued} of ${payload.data.total} — the rest were already announced this cycle`);
      setSelected([]);
      setSelectionEpoch((epoch) => epoch + 1);
    } finally {
      setReminding(false);
    }
  }

  /**
   * Only rows with an uploaded file can go into the ZIP — a selected row with
   * nothing uploaded yet is dropped here client-side, and dropped again
   * server-side (`createFileExportJobIn` re-derives the same set), so the two
   * can never disagree about what actually gets included.
   */
  async function startExport(groupBy: "none" | "session" | "speaker", selection = selected) {
    const targets = selection.filter((row) => row.latestVersion !== null);
    if (targets.length === 0) {
      toast("Select at least one deliverable that has a file uploaded");
      return;
    }
    setExporting(true);
    setExportJob(null);
    try {
      const response = await fetch(`/api/internal/deliverables/export?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupBy,
          targets: deliverableBulkTargets(targets),
        }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: FileExportJobDTO; error?: { message?: string } } | null;
      if (!response?.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Could not start the export — try again", { kind: "error" });
        return;
      }
      setExportJob(payload.data);
    } finally {
      setExporting(false);
    }
  }

  // Polls the job every 1.5s while it is still pending/processing — the GET
  // route itself processes an unclaimed job inline as a fallback, so this
  // converges in one or two polls whether or not the Worker's `waitUntil`
  // already finished it.
  useEffect(() => {
    if (!exportJob || exportJob.status === "completed" || exportJob.status === "failed") return;
    const timer = setTimeout(() => {
      fetch(`/api/internal/deliverables/export/${exportJob.id}?eventId=${encodeURIComponent(eventId)}`)
        .then((response) => response.json())
        .then((payload: { data?: FileExportJobDTO }) => { if (payload.data) setExportJob(payload.data); })
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [exportJob, eventId]);

  const columns = useMemo<Array<ColumnDef<DeliverableRowDTO, unknown>>>(() => [
    {
      id: "contact",
      header: "Speaker",
      accessorKey: "contactName",
      cell: ({ row }) => (
        <div>
          <b>{row.original.contactName}</b>
          {row.original.submissionTitle && <span style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>{row.original.submissionTitle}</span>}
        </div>
      ),
    },
    { id: "request", header: "Request", accessorKey: "fileRequestTitle" },
    { id: "task", header: "Task", accessorKey: "taskName" },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => statusOf(row),
      cell: ({ row }) => <StatusBadge value={statusOf(row.original)} />,
    },
    {
      id: "latest",
      header: "Latest file",
      enableSorting: false,
      cell: ({ row }) => {
        const version = row.original.latestVersion;
        if (!version) return <Dash />;
        return (
          <span>
            <Paperclip size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {version.filename} <small style={{ color: "var(--muted)" }}>v{version.version} · {sizeLabel(version.sizeBytes)}</small>
          </span>
        );
      },
    },
    {
      id: "versions",
      header: "Versions",
      accessorKey: "versionCount",
      cell: ({ row }) => row.original.versionCount,
    },
    {
      id: "comments",
      header: "Comments",
      accessorKey: "commentCount",
      cell: ({ row }) => row.original.commentCount > 0
        ? <span><MessageSquare size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />{row.original.commentCount}</span>
        : <Dash />,
    },
  ], []);

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Files"
        description="Every deliverable requested from a speaker, in one place — versions, comments, and follow-up."
      />

      <div className="abstract-status-tabs" role="tablist">
        {(["all", "open", "overdue", "completed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={state === option}
            className={state === option ? "active" : ""}
            onClick={() => onFilter({ state: option })}
          >
            {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
            <span>{counts[option]}</span>
          </button>
        ))}
      </div>

      <section className="panel data-panel">
        <div className="data-toolbar">
          <label className="table-search">
            <Search size={16} />
            <input aria-label="Search deliverables" value={draftSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search speaker, request, or session" />
            {draftSearch && <button type="button" aria-label="Clear search" onClick={clearSearch}><X size={14} /></button>}
          </label>
          <Select value={fileRequestId} onChange={(event) => onFilter({ fileRequestId: event.target.value })} aria-label="Filter by file request">
            <option value="">All requests</option>
            {fileRequests.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
          </Select>
          <Select value={taskId} onChange={(event) => onFilter({ taskId: event.target.value })} aria-label="Filter by task">
            <option value="">All tasks</option>
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </Select>
          <Select value={hasUpload} onChange={(event) => onFilter({ hasUpload: event.target.value as HasUpload })} aria-label="Filter by version">
            <option value="">Any version state</option>
            <option value="yes">Has a file</option>
            <option value="no">Missing a file</option>
          </Select>
          <span className="row-count">{displayRows.length} shown</span>
        </div>
        {exportJob && (
          <div className="notify-bar">
            <div>
              <span className="metric-icon accent"><Download size={18} /></span>
              <p>
                <b>
                  {exportJob.status === "completed" ? "Export ready" : exportJob.status === "failed" ? "Export failed" : "Preparing export…"}
                </b>
                <small>
                  {exportJob.status === "completed" && `${exportJob.entryCount} file${exportJob.entryCount === 1 ? "" : "s"} zipped`}
                  {exportJob.status === "failed" && (exportJob.error ?? "Something went wrong")}
                  {(exportJob.status === "pending" || exportJob.status === "processing") && "This updates automatically."}
                </small>
              </p>
            </div>
            {exportJob.status === "completed" && exportJob.resultFileId && (
              <PrivateFileLink fileId={exportJob.resultFileId}>Download ZIP</PrivateFileLink>
            )}
          </div>
        )}
        <DataTable
          columns={columns}
          data={displayRows}
          empty={<EmptyState icon={<FolderOpen size={28} />} title="No deliverables match" description="Adjust the filters above, or wait for speakers to complete their tasks." />}
          enableSelection
          allRowsSelection={FILES_ALL_ROWS_SELECTION}
          getRowLabel={(row) => `${row.contactName}, ${row.fileRequestTitle}`}
          onSelectionChange={setSelected}
          renderSelectionBar={({
            selectedRows,
            countLabel,
            clearSelection,
            scope,
            pageSelectedCount,
            pageRowCount,
            totalRowCount,
            selectAllRows,
          }) => {
            const selection = filesSelectionBarState({
              scope,
              selectedCount: selectedRows.length,
              pageSelectedCount,
              pageRowCount,
              matchingCount: totalRowCount,
              canSelectAllRows: selectAllRows !== undefined,
            });
            return <BulkActionBar
              count={selectedRows.length}
              countLabel={countLabel}
              onClear={clearSelection}
              actions={<>
                {selection.canSelectAllMatching && selectAllRows && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={reminding || exporting}
                    onClick={selectAllRows}
                  >
                    Select all {totalRowCount} matching deliverables
                  </Button>
                )}
                <Button size="sm" variant="secondary" disabled={reminding} onClick={() => { void bulkRemind(selectedRows); }}>
                  <Bell size={14} /> {reminding ? "Reminding…" : "Send reminder"}
                </Button>
                <Select
                  aria-label="Group export by"
                  disabled={exporting}
                  defaultValue="none"
                  onChange={(event) => { void startExport(event.target.value as "none" | "session" | "speaker", selectedRows); event.target.value = "none"; }}
                >
                  <option value="none" disabled>{exporting ? "Preparing export…" : "Export latest files as ZIP…"}</option>
                  <option value="none">No grouping</option>
                  <option value="speaker">Grouped by speaker</option>
                  <option value="session">Grouped by session</option>
                </Select>
              </>}
            />;
          }}
          selectionEpoch={selectionEpoch}
          getRowId={(row) => `${row.taskId}:${row.contactId}:${row.submissionId ?? "-"}`}
          onRowClick={(row) => setActive(row)}
          columnVisibilityKey={`files:${eventId}`}
        />
      </section>

      <DeliverableDrawer
        eventId={eventId}
        row={active}
        onClose={() => setActive(null)}
        onCommentAdded={(fileRequestId2, contactId, submissionId, commentCount) => {
          setDisplayRows((current) => current.map((row) => (
            row.fileRequestId === fileRequestId2 && row.contactId === contactId && row.submissionId === submissionId
              ? { ...row, commentCount }
              : row
          )));
        }}
      />
    </div>
  );
}

/** A deliverable slot's version history and comment thread, organizer side. */
function DeliverableDrawer({
  eventId,
  row,
  onClose,
  onCommentAdded,
}: {
  eventId: string;
  row: DeliverableRowDTO | null;
  onClose: () => void;
  onCommentAdded: (fileRequestId: string, contactId: string, submissionId: string | null, commentCount: number) => void;
}) {
  const { toast } = useToast();
  const { runGuarded } = useGuardedAction();
  const [detail, setDetail] = useState<DeliverableDetail>({ key: "", status: "loading", versions: [], comments: [], error: "" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<CommentDraft>({ key: null, id: "", body: "", attemptedId: null, attemptedBody: null });
  const [sending, setSending] = useState(false);

  const key = row ? `${row.fileRequestId}:${row.contactId}:${row.submissionId ?? "-"}` : null;
  const paths = row ? deliverableDetailPaths(eventId, row) : null;
  const versionsPath = paths?.versions ?? "";
  const commentsPath = paths?.comments ?? "";
  const currentDetail = key ? visibleDeliverableDetail(detail, key) : detail;
  const draftBody = key && draft.key === key ? draft.body : "";
  const draftDirty = draftBody.trim().length > 0;
  useUnsavedWorkGuard(Boolean(row) && (draftDirty || sending), { blocking: sending });

  useEffect(() => {
    if (!key) return;
    const stored = loadStoredCommentDraft(fileCommentDraftStorageKey(eventId, key), key);
    setDraft(stored ?? { key, id: crypto.randomUUID(), body: "", attemptedId: null, attemptedBody: null });
  }, [eventId, key]);

  useEffect(() => {
    if (!key || currentDetail.status !== "ready" || draft.key !== key || draft.attemptedId === null || draft.attemptedBody === null) return;
    if (!currentDetail.comments.some((comment) => comment.id === draft.attemptedId && comment.body === draft.attemptedBody)) return;
    removeStoredCommentDraft(fileCommentDraftStorageKey(eventId, key));
    if (draft.id === draft.attemptedId && draft.body.trim() === draft.attemptedBody) {
      setDraft({ key, id: crypto.randomUUID(), body: "", attemptedId: null, attemptedBody: null });
      toast("Comment sent");
    } else {
      setDraft((current) => current.key === key
        ? { ...current, attemptedId: null, attemptedBody: null }
        : current);
      toast("The original comment was sent — your edited reply is still unsent");
    }
  }, [currentDetail, draft, eventId, key, toast]);

  useEffect(() => {
    if (!key || !versionsPath || !commentsPath) return;
    const controller = new AbortController();
    const activeKey = key;
    setDetail({ key: activeKey, status: "loading", versions: [], comments: [], error: "" });
    void fetchDeliverableDetail({ versions: versionsPath, comments: commentsPath }, { signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setDetail({ key: activeKey, status: "ready", ...loaded, error: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetail({
          key: activeKey,
          status: "error",
          versions: [],
          comments: [],
          error: error instanceof Error ? error.message : "Could not load versions and comments",
        });
      });
    return () => controller.abort();
  }, [commentsPath, key, loadAttempt, versionsPath]);

  function requestClose() {
    if (sending) return;
    runGuarded(() => {
      if (key) removeStoredCommentDraft(fileCommentDraftStorageKey(eventId, key));
      setDraft({ key: null, id: "", body: "", attemptedId: null, attemptedBody: null });
      onClose();
    });
  }

  async function send() {
    if (!row || !key || currentDetail.status !== "ready" || !draft.id || !draftBody.trim()) return;
    const pendingDraft = { key, id: draft.id, body: draftBody, attemptedId: draft.id, attemptedBody: draftBody.trim() };
    if (!persistStoredCommentDraft(fileCommentDraftStorageKey(eventId, key), pendingDraft)) {
      toast("Can't send safely because recovery storage is unavailable — enable site storage or free up space, then try again", { kind: "error" });
      return;
    }
    setDraft(pendingDraft);
    setSending(true);
    try {
      const response = await fetch(`/api/internal/deliverables/comments?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, fileRequestId: row.fileRequestId, contactId: row.contactId, submissionId: row.submissionId, body: draftBody.trim() }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: FileCommentDTO } | null;
      const created = payload?.data;
      if (!response?.ok || !created) {
        if (!response || response.status >= 500 || response.ok) {
          setLoadAttempt((attempt) => attempt + 1);
          toast("We couldn't confirm whether that comment was sent — retry it unchanged to recover the result", { kind: "error" });
        } else {
          toast("That comment could not be sent — review it and try again", { kind: "error" });
        }
        return;
      }
      const commentCount = currentDetail.comments.length + 1;
      setDetail((current) => {
        if (current.key !== key || current.status !== "ready") return current;
        const comments = [...current.comments, created];
        return { ...current, comments };
      });
      onCommentAdded(row.fileRequestId, row.contactId, row.submissionId, commentCount);
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer open={row !== null} onClose={requestClose} title={row ? `${row.contactName} — ${row.fileRequestTitle}` : "Deliverable"}>
      {row && (
        <div className="drawer-content">
          {currentDetail.status === "loading" && <p className="portal-note" role="status">Loading versions and comments…</p>}
          {currentDetail.status === "error" && <div className="portal-note" role="alert">
            <p>{currentDetail.error}</p>
            <Button size="sm" variant="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</Button>
          </div>}
          {currentDetail.status === "ready" && <><section>
            <h3>Versions</h3>
            {currentDetail.versions.length === 0 && <p className="portal-note">No file has been uploaded for this deliverable yet.</p>}
            <ul className="portal-uploads">
              {currentDetail.versions.map((version) => (
                <li key={version.fileUploadId}>
                  <Paperclip size={15} />
                  <PrivateFileLink fileId={version.fileAssetId}>{version.filename}</PrivateFileLink>
                  <small style={{ color: "var(--muted)" }}>v{version.version} · {sizeLabel(version.sizeBytes)}</small>
                  {version.isLatest && <em>Latest</em>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Comments</h3>
            {currentDetail.comments.length === 0
              ? <p className="portal-note">No comments yet.</p>
              : currentDetail.comments.map((comment) => (
                <div className="review-comment" key={comment.id}>
                  <header>
                    <span>{comment.authorName.slice(0, 2).toUpperCase()}</span>
                    <b>{comment.authorName}</b>
                    <em>{comment.authorRole === "organizer" ? "Organizer" : "Speaker"}</em>
                  </header>
                  <p>{comment.body}</p>
                </div>
              ))}
            <div className="form-stack" style={{ marginTop: 12 }}>
              <textarea
                aria-label="Reply to the speaker"
                rows={2}
                value={draftBody}
                disabled={sending}
                onChange={(event) => {
                  if (!key) return;
                  setDraft(commentDraftAfterEdit(draft, key, event.target.value));
                }}
                placeholder="Reply to the speaker…"
                maxLength={5000}
              />
              <Button size="sm" disabled={sending || !draftDirty} onClick={() => void send()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </section>
          </>}
        </div>
      )}
    </Drawer>
  );
}
