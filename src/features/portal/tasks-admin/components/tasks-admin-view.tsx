"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { CalendarClock, CheckCircle2, FileText, MoreHorizontal, Plus, Search, Upload, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { BulkReminderRecoveryDialog, useBulkReminderRecovery } from "@/features/comms/index.client";
import { TzTime } from "@/shared/ui/app/tz-time";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useFlowKeyboardNav } from "@/shared/ui/app/use-flow-keyboard-nav";
import { Button, EmptyState, PageHeader, ProgressBar, Segmented } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { EventId, TaskDTO } from "@/shared/contracts";
import type { AdminTaskDTO, FileRequestDTO, FormOption, TaskTabCounts } from "../server/queries";
import { FileRequestsView } from "./file-requests-view";
import { TaskEditor } from "./task-editor";
import { TaskMatrixDrawer } from "./task-matrix-drawer";
import { taskMutation } from "./task-mutation";

const MODE_LABEL: Record<AdminTaskDTO["completionMode"], string> = { manual: "Manual", form: "Form", file_request: "File request" };
const MODE_ICON: Record<AdminTaskDTO["completionMode"], typeof CheckCircle2> = { manual: CheckCircle2, form: FileText, file_request: Upload };

type Tab = "all" | "contact" | "group" | "submission";

export function mergeSavedTask(tasks: AdminTaskDTO[], saved: TaskDTO): AdminTaskDTO[] {
  const previous = tasks.find((task) => task.id === saved.id);
  const next = { ...saved, counts: previous?.counts ?? { completed: 0, open: 0, overdue: 0, recorded: 0 } };
  return previous
    ? tasks.map((task) => task.id === saved.id ? next : task)
    : [...tasks, next];
}

export function applyFileRequestChangeToList(
  requests: FileRequestDTO[],
  change: { kind: "saved"; request: FileRequestDTO } | { kind: "deleted"; id: string },
): FileRequestDTO[] {
  if (change.kind === "deleted") return requests.filter((request) => request.id !== change.id);
  return requests.some((request) => request.id === change.request.id)
    ? requests.map((request) => request.id === change.request.id ? change.request : request)
    : [...requests, change.request];
}

export function menuDestinationForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  return null;
}

export async function applyAuthoritativeChange(
  applyLocal: () => void,
  refresh: () => Promise<void>,
  onRefreshError: () => void,
): Promise<boolean> {
  applyLocal();
  try {
    await refresh();
    return true;
  } catch {
    onRefreshError();
    return false;
  }
}

export function TasksAdminView({
  eventId,
  timezone,
  initialTasks,
  initialTabCounts,
  initialFileRequests,
  forms,
}: {
  eventId: string;
  timezone: string;
  initialTasks: AdminTaskDTO[];
  initialTabCounts: TaskTabCounts;
  initialFileRequests: FileRequestDTO[];
  forms: FormOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  // `?section=file_requests` deep-links the segment, so a "Create a file
  // request" call to action elsewhere lands on the screen that creates one
  // rather than on the Tasks list. Only the initial value is read: the segment
  // is a local view toggle from there on.
  const searchParams = useSearchParams();
  const [section, setSection] = useState<"tasks" | "file_requests">(
    searchParams.get("section") === "file_requests" ? "file_requests" : "tasks",
  );
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState(initialTasks);
  const [tabCounts, setTabCounts] = useState(initialTabCounts);
  const [fileRequests, setFileRequests] = useState(initialFileRequests);
  const [editing, setEditing] = useState<AdminTaskDTO | null>(null);
  const [duplicatingTask, setDuplicatingTask] = useState<AdminTaskDTO | null>(null);
  const [creating, setCreating] = useState(false);
  // M57 — the open task drawer is an id into `filtered`, not a captured
  // object, so next/prev always resolves against whatever is on screen right
  // now (a search or tab change while the drawer is open never leaves it
  // pointing at a row that has scrolled out of the visible list).
  const [matrixTaskId, setMatrixTaskId] = useState<string | null>(null);
  const [reminderAcknowledgement, setReminderAcknowledgement] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<AdminTaskDTO | null>(null);
  const reminderRecovery = useBulkReminderRecovery({
    eventId: eventId as EventId,
    surface: "task-matrix",
    onAcknowledged: () => setReminderAcknowledgement((current) => current + 1),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (tab !== "all" && tab !== "group" && task.targetType !== tab) return false;
      if (tab === "group") return false;
      if (term && !task.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [tasks, tab, search]);

  const taskIds = useMemo<string[]>(() => filtered.map((task) => task.id), [filtered]);
  useFlowKeyboardNav({
    ids: taskIds,
    activeId: matrixTaskId,
    onNavigate: (id) => { if (!reminderRecovery.blocked) setMatrixTaskId(id); },
    onClose: () => { if (!reminderRecovery.blocked) setMatrixTaskId(null); },
  });
  const matrixIndex = matrixTaskId ? taskIds.indexOf(matrixTaskId) : -1;
  const matrixTask = matrixIndex !== -1 ? filtered[matrixIndex] : undefined;

  async function refresh() {
    const response = await fetch(`/api/internal/tasks?eventId=${eventId}`);
    const payload = await response.json().catch(() => null) as { data?: AdminTaskDTO[] } | null;
    if (!response.ok || !payload?.data) throw new Error("task refresh failed");
    const all = payload.data;
    setTasks(all);
    const contact = all.filter((task) => task.targetType === "contact").length;
    const submission = all.filter((task) => task.targetType === "submission").length;
    setTabCounts({ all: contact + submission, contact, group: 0, submission });
    router.refresh();
  }

  async function remove(task: AdminTaskDTO) {
    const result = await taskMutation(`/api/internal/tasks/${task.id}?eventId=${eventId}`, { method: "DELETE" }, "That task could not be deleted");
    if (!result.ok) { toast(result.message, { kind: "error" }); return; }
    toast(`${task.name} deleted`);
    setPendingDelete(null);
    await applyAuthoritativeChange(() => {
      setTasks((current) => current.filter((candidate) => candidate.id !== task.id));
      setTabCounts((current) => ({
        ...current,
        all: Math.max(0, current.all - 1),
        [task.targetType]: Math.max(0, current[task.targetType] - 1),
      }));
    }, refresh, () => toast("Task deleted, but the list could not be refreshed", { kind: "error" }));
  }

  // Owned here, not inside `FileRequestsView` — a request created while that
  // section is open has to be immediately selectable in the task editor's
  // "File request" dropdown, which only holds if both read the same list.
  async function refreshFileRequests() {
    const response = await fetch(`/api/internal/file-requests?eventId=${eventId}`);
    const payload = await response.json().catch(() => null) as { data?: FileRequestDTO[] } | null;
    if (!response.ok || !payload?.data) throw new Error("file request refresh failed");
    setFileRequests(payload.data);
  }

  async function applyFileRequestChange(change: { kind: "saved"; request: FileRequestDTO } | { kind: "deleted"; id: string }) {
    await applyAuthoritativeChange(
      () => setFileRequests((current) => applyFileRequestChangeToList(current, change)),
      refreshFileRequests,
      () => toast(change.kind === "saved"
        ? "File request saved, but the list could not be refreshed"
        : "File request deleted, but the list could not be refreshed", { kind: "error" }),
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Tasks"
        description="Create tasks that can be assigned to your portals"
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add task</Button>}
      />

      <Segmented
        label="Task content type"
        value={section}
        onChange={setSection}
        items={[{ value: "tasks", label: "Tasks" }, { value: "file_requests", label: "File requests" }]}
      />

      {section === "tasks" && (
        <>
          <nav className="abstract-status-tabs" aria-label="Task filters">
            <button type="button" aria-pressed={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>All tasks <span>{tabCounts.all}</span></button>
            <button type="button" aria-pressed={tab === "contact"} className={tab === "contact" ? "active" : ""} onClick={() => setTab("contact")}>Contact tasks <span>{tabCounts.contact}</span></button>
            <button type="button" aria-pressed={tab === "group"} className={tab === "group" ? "active" : ""} onClick={() => setTab("group")}>Group tasks <span>{tabCounts.group}</span></button>
            <button type="button" aria-pressed={tab === "submission"} className={tab === "submission" ? "active" : ""} onClick={() => setTab("submission")}>Submission tasks <span>{tabCounts.submission}</span></button>
          </nav>

          <section className="panel data-panel">
            <div className="data-toolbar">
              <label className="table-search">
                <Search size={16} />
                <input aria-label="Search tasks" placeholder="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <span className="row-count">{filtered.length} of {tasks.length}</span>
            </div>

            {filtered.length === 0 && (
              <EmptyState
                icon={<CheckCircle2 size={20} />}
                title={tab === "group" ? "Group tasks are not available" : tasks.length === 0 ? "No tasks yet" : "No tasks match this search"}
                description={tab === "group"
                  ? "The speaker portal only assigns tasks to speakers and submissions."
                  : "Create a task to collect information, files, or confirmations from your speakers."}
                action={tab !== "group" ? <Button onClick={() => setCreating(true)}>Add task</Button> : undefined}
              />
            )}

            {filtered.map((task) => {
              const Icon = MODE_ICON[task.completionMode];
              const total = task.counts.completed + task.counts.open;
              const progress = total ? Math.round((task.counts.completed / total) * 100) : 0;
              return (
                <article className="admin-task-row admin-task-row-with-menu" key={task.id}>
                  <span className={`task-mode-icon ${task.completionMode}`}><Icon size={18} /></span>
                  <div className="admin-task-main">
                    <div><h3>{task.name}</h3><span className="track-chip">{MODE_LABEL[task.completionMode]}</span>{!task.isActive && <span className="track-chip">Inactive</span>}</div>
                    <p>{total === 0 ? "Nobody assigned yet" : `${task.counts.completed}/${total} complete${task.counts.overdue ? ` · ${task.counts.overdue} overdue` : ""}`}</p>
                    <div>
                      <span><CalendarClock size={13} /> {task.dueAt ? <TzTime instant={task.dueAt} tz={timezone} style="date" /> : "No due date"}</span>
                      <span><Users size={13} /> {task.targetType === "contact" ? "Accepted speakers" : "Accepted submissions"}</span>
                    </div>
                  </div>
                  <div className="admin-task-progress">
                    <div className="admin-task-progress-copy"><b>{task.counts.completed}/{total}</b><span>{progress}%</span></div>
                    <ProgressBar label={`Completion for ${task.name}`} value={progress} tone={progress > 75 ? "green" : "accent"} />
                  </div>
                  <TaskRowMenu task={task} onView={() => setMatrixTaskId(task.id)} onEdit={() => setEditing(task)} onDuplicate={() => setDuplicatingTask(task)} onDelete={() => setPendingDelete(task)} />
                </article>
              );
            })}
          </section>
        </>
      )}

      {section === "file_requests" && <FileRequestsView eventId={eventId} requests={fileRequests} onChanged={applyFileRequestChange} />}

      <TaskEditor
        eventId={eventId}
        timezone={timezone}
        open={creating || editing !== null || duplicatingTask !== null}
        task={editing}
        duplicateOf={duplicatingTask}
        // `recorded`, not `completed`: the server's lock counts `task_completions`
        // directly, while `completed` comes from `task_assignments_v`, which
        // drops inactive tasks. Deactivating a task with completions used to
        // unlock these controls and then reject the save.
        locked={editing !== null && editing.counts.recorded > 0}
        forms={forms}
        fileRequests={fileRequests}
        onClose={() => { setCreating(false); setEditing(null); setDuplicatingTask(null); }}
        onSaved={async (saved) => {
          const previous = tasks.find((task) => task.id === saved.id);
          setCreating(false);
          setEditing(null);
          setDuplicatingTask(null);
          await applyAuthoritativeChange(() => {
            setTasks((current) => mergeSavedTask(current, saved));
            if (!previous) {
              setTabCounts((current) => ({ ...current, all: current.all + 1, [saved.targetType]: current[saved.targetType] + 1 }));
            } else if (previous.targetType !== saved.targetType) {
              setTabCounts((current) => ({
                ...current,
                [previous.targetType]: Math.max(0, current[previous.targetType] - 1),
                [saved.targetType]: current[saved.targetType] + 1,
              }));
            }
          }, refresh, () => toast("Task saved, but the list could not be refreshed", { kind: "error" }));
        }}
      />

      {matrixTask && (
        <TaskMatrixDrawer
          eventId={eventId}
          task={matrixTask}
          timezone={timezone}
          onClose={() => { if (!reminderRecovery.blocked) setMatrixTaskId(null); }}
          onCompletionReopened={refresh}
          reminderRecovery={reminderRecovery}
          reminderAcknowledgement={reminderAcknowledgement}
          nav={{
            index: matrixIndex,
            total: taskIds.length,
            ...(taskIds[matrixIndex - 1] && !reminderRecovery.blocked ? { onPrev: () => setMatrixTaskId(taskIds[matrixIndex - 1] as string) } : {}),
            ...(taskIds[matrixIndex + 1] && !reminderRecovery.blocked ? { onNext: () => setMatrixTaskId(taskIds[matrixIndex + 1] as string) } : {}),
          }}
        />
      )}

      <BulkReminderRecoveryDialog controller={reminderRecovery} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : ""}
        body="Speakers who already completed this task lose their record of it."
        confirmLabel="Delete task"
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export function TaskRowMenu({ task, onView, onEdit, onDuplicate, onDelete }: { task: AdminTaskDTO; onView: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => itemRefs.current[0]?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Let the browser move focus first; removing the focused menuitem during
      // keydown can strand focus on <body> instead of the next row control.
      window.setTimeout(() => setOpen(false), 0);
      return;
    }
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const destination = menuDestinationForKey(event.key, current, items.length);
    if (destination === null) return;
    event.preventDefault();
    items[destination]?.focus();
  }

  return (
    <div ref={containerRef} className="task-row-menu">
      <button ref={triggerRef} type="button" className="icon-button" aria-label={`Actions for ${task.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (!open && event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={`Actions for ${task.name}`} onKeyDown={onMenuKeyDown} style={{ position: "absolute", right: 0, top: "100%", zIndex: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "var(--shadow-sm)", minWidth: 140, padding: 4 }}>
          <button ref={(node) => { itemRefs.current[0] = node; }} tabIndex={-1} type="button" role="menuitem" className="menu-item" style={menuItemStyle} onClick={() => { setOpen(false); onView(); }}>View responses</button>
          <button ref={(node) => { itemRefs.current[1] = node; }} tabIndex={-1} type="button" role="menuitem" className="menu-item" style={menuItemStyle} onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
          <button ref={(node) => { itemRefs.current[2] = node; }} tabIndex={-1} type="button" role="menuitem" className="menu-item" style={menuItemStyle} onClick={() => { setOpen(false); onDuplicate(); }}>Duplicate</button>
          <button ref={(node) => { itemRefs.current[3] = node; }} tabIndex={-1} type="button" role="menuitem" className="menu-item" style={{ ...menuItemStyle, color: "var(--red)" }} onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: 0, background: "transparent", fontSize: "var(--text-xs)", borderRadius: 6, cursor: "pointer" };
