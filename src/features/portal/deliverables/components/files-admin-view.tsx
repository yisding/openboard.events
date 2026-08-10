"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Bell, Download, FolderOpen, MessageSquare, Paperclip, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DeliverableRowDTO, FileCommentDTO, FileExportJobDTO, FileVersionDTO } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { Button, Drawer, EmptyState, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

type State = "all" | "open" | "overdue" | "completed";

function sizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusOf(row: DeliverableRowDTO): "Completed" | "Overdue" | "Open" {
  if (row.completed) return "Completed";
  if (row.overdue) return "Overdue";
  return "Open";
}

/**
 * The central Files view (M52): every file-request deliverable across the
 * event, filterable by task, file request, speaker, due/completion state and
 * version, with a bulk "remind" bar over the filtered/selected rows and a
 * slide-over for a slot's version history and comment thread.
 *
 * Filtering happens over the already-fetched full row set (`initialRows`) —
 * an event's deliverables are a bounded list, not a paginated one, so a
 * second server round trip per filter change buys nothing a `useMemo` does
 * not already give for free.
 */
export function FilesAdminView({
  eventId,
  initialRows,
  fileRequests,
  tasks,
}: {
  eventId: string;
  initialRows: DeliverableRowDTO[];
  fileRequests: Array<{ id: string; title: string }>;
  tasks: Array<{ id: string; name: string }>;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState(initialRows);
  const [state, setState] = useState<State>("all");
  const [taskId, setTaskId] = useState("");
  const [fileRequestId, setFileRequestId] = useState("");
  const [hasUpload, setHasUpload] = useState<"" | "yes" | "no">("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DeliverableRowDTO[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [reminding, setReminding] = useState(false);
  const [active, setActive] = useState<DeliverableRowDTO | null>(null);
  const [exportJob, setExportJob] = useState<FileExportJobDTO | null>(null);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (state !== "all" && statusOf(row).toLowerCase() !== state) return false;
      if (taskId && row.taskId !== taskId) return false;
      if (fileRequestId && row.fileRequestId !== fileRequestId) return false;
      if (hasUpload === "yes" && !row.latestVersion) return false;
      if (hasUpload === "no" && row.latestVersion) return false;
      if (term) {
        const haystack = `${row.contactName} ${row.submissionTitle ?? ""} ${row.fileRequestTitle} ${row.taskName}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, state, taskId, fileRequestId, hasUpload, search]);

  const counts = useMemo(() => ({
    all: rows.length,
    open: rows.filter((row) => !row.completed).length,
    overdue: rows.filter((row) => row.overdue).length,
    completed: rows.filter((row) => row.completed).length,
  }), [rows]);

  async function bulkRemind() {
    const targets = selected.filter((row) => !row.completed);
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
          targets: targets.map((row) => ({ taskId: row.taskId, contactId: row.contactId, submissionId: row.submissionId })),
        }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: { enqueued: number; total: number } } | null;
      if (!response?.ok || !payload?.data) {
        toast("Could not send reminders — try again");
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
  async function startExport(groupBy: "none" | "session" | "speaker") {
    const targets = selected.filter((row) => row.latestVersion !== null);
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
          targets: targets.map((row) => ({ taskId: row.taskId, contactId: row.contactId, submissionId: row.submissionId })),
        }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: FileExportJobDTO; error?: { message?: string } } | null;
      if (!response?.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Could not start the export — try again");
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
          {row.original.submissionTitle && <span style={{ display: "block", color: "var(--muted)", fontSize: 8 }}>{row.original.submissionTitle}</span>}
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
        ? <span><MessageSquare size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{row.original.commentCount}</span>
        : <Dash />,
    },
  ], []);

  return (
    <main className="page">
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
            onClick={() => setState(option)}
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search speaker, request, or session" />
            {search && <button type="button" onClick={() => setSearch("")}><X size={14} /></button>}
          </label>
          <select value={fileRequestId} onChange={(event) => setFileRequestId(event.target.value)} aria-label="Filter by file request">
            <option value="">All requests</option>
            {fileRequests.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
          </select>
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)} aria-label="Filter by task">
            <option value="">All tasks</option>
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
          <select value={hasUpload} onChange={(event) => setHasUpload(event.target.value as typeof hasUpload)} aria-label="Filter by version">
            <option value="">Any version state</option>
            <option value="yes">Has a file</option>
            <option value="no">Missing a file</option>
          </select>
          <span className="row-count">{filtered.length} shown</span>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span><b>{selected.length}</b> selected</span>
            <Button size="sm" variant="secondary" disabled={reminding} onClick={() => void bulkRemind()}>
              <Bell size={14} /> {reminding ? "Reminding…" : "Send reminder"}
            </Button>
            <select
              aria-label="Group export by"
              disabled={exporting}
              defaultValue="none"
              onChange={(event) => { void startExport(event.target.value as "none" | "session" | "speaker"); event.target.value = "none"; }}
            >
              <option value="none" disabled>{exporting ? "Preparing export…" : "Export latest files as ZIP…"}</option>
              <option value="none">No grouping</option>
              <option value="speaker">Grouped by speaker</option>
              <option value="session">Grouped by session</option>
            </select>
            <button type="button" onClick={() => { setSelected([]); setSelectionEpoch((epoch) => epoch + 1); }}>Clear</button>
          </div>
        )}
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
          data={filtered}
          empty={<EmptyState icon={<FolderOpen size={28} />} title="No deliverables match" description="Adjust the filters above, or wait for speakers to complete their tasks." />}
          enableSelection
          onSelectionChange={setSelected}
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
          setRows((current) => current.map((row) => (
            row.fileRequestId === fileRequestId2 && row.contactId === contactId && row.submissionId === submissionId
              ? { ...row, commentCount }
              : row
          )));
        }}
      />
    </main>
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
  const [versions, setVersions] = useState<FileVersionDTO[]>([]);
  const [comments, setComments] = useState<FileCommentDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const key = row ? `${row.fileRequestId}:${row.contactId}:${row.submissionId ?? "-"}` : null;

  useEffect(() => {
    if (!row || !key) return;
    let cancelled = false;
    setLoading(true);
    const query = `eventId=${encodeURIComponent(eventId)}&fileRequestId=${encodeURIComponent(row.fileRequestId)}&contactId=${encodeURIComponent(row.contactId)}${row.submissionId ? `&submissionId=${encodeURIComponent(row.submissionId)}` : ""}`;
    Promise.all([
      fetch(`/api/internal/deliverables/versions?${query}`).then((response) => response.json()).catch(() => null),
      fetch(`/api/internal/deliverables/comments?${query}`).then((response) => response.json()).catch(() => null),
    ]).then(([versionsPayload, commentsPayload]) => {
      if (cancelled) return;
      setVersions((versionsPayload as { data?: FileVersionDTO[] } | null)?.data ?? []);
      setComments((commentsPayload as { data?: FileCommentDTO[] } | null)?.data ?? []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function send() {
    if (!row || !draft.trim()) return;
    setSending(true);
    try {
      const response = await fetch(`/api/internal/deliverables/comments?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileRequestId: row.fileRequestId, contactId: row.contactId, submissionId: row.submissionId, body: draft.trim() }),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as { data?: FileCommentDTO } | null;
      const created = payload?.data;
      if (!response?.ok || !created) {
        toast("That comment did not go through — try again");
        return;
      }
      setComments((current) => {
        const next = [...current, created];
        onCommentAdded(row.fileRequestId, row.contactId, row.submissionId, next.length);
        return next;
      });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer open={row !== null} onClose={onClose} title={row ? `${row.contactName} — ${row.fileRequestTitle}` : "Deliverable"}>
      {row && (
        <div className="drawer-content">
          <section>
            <h3>Versions</h3>
            {versions.length === 0 && !loading && <p className="portal-note">No file has been uploaded for this deliverable yet.</p>}
            <ul className="portal-uploads">
              {versions.map((version) => (
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
            {comments.length === 0 && !loading
              ? <p className="portal-note">No comments yet.</p>
              : comments.map((comment) => (
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
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Reply to the speaker…"
                maxLength={5000}
              />
              <Button size="sm" disabled={sending || draft.trim().length === 0} onClick={() => void send()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
