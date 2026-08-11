"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { CalendarClock, CheckCircle2, FileText, MoreHorizontal, Plus, Search, Upload, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { TzTime } from "@/shared/ui/app/tz-time";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useFlowKeyboardNav } from "@/shared/ui/app/use-flow-keyboard-nav";
import { Button, EmptyState, PageHeader, ProgressBar, Segmented } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AdminTaskDTO, FileRequestDTO, FormOption, TaskTabCounts } from "../server/queries";
import { FileRequestsView } from "./file-requests-view";
import { TaskEditor } from "./task-editor";
import { TaskMatrixDrawer } from "./task-matrix-drawer";
import { taskMutation } from "./task-mutation";

const MODE_LABEL: Record<AdminTaskDTO["completionMode"], string> = { manual: "Manual", form: "Form", file_request: "File Request" };
const MODE_ICON: Record<AdminTaskDTO["completionMode"], typeof CheckCircle2> = { manual: CheckCircle2, form: FileText, file_request: Upload };

type Tab = "all" | "contact" | "group" | "submission";

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
  const [section, setSection] = useState<"tasks" | "file_requests">("tasks");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState(initialTasks);
  const [tabCounts, setTabCounts] = useState(initialTabCounts);
  const [fileRequests, setFileRequests] = useState(initialFileRequests);
  const [editing, setEditing] = useState<AdminTaskDTO | null>(null);
  const [creating, setCreating] = useState(false);
  // M57 — the open task drawer is an id into `filtered`, not a captured
  // object, so next/prev always resolves against whatever is on screen right
  // now (a search or tab change while the drawer is open never leaves it
  // pointing at a row that has scrolled out of the visible list).
  const [matrixTaskId, setMatrixTaskId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminTaskDTO | null>(null);

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
  useFlowKeyboardNav({ ids: taskIds, activeId: matrixTaskId, onNavigate: setMatrixTaskId, onClose: () => setMatrixTaskId(null) });
  const matrixIndex = matrixTaskId ? taskIds.indexOf(matrixTaskId) : -1;
  const matrixTask = matrixIndex !== -1 ? filtered[matrixIndex] : undefined;

  async function refresh() {
    try {
      const response = await fetch(`/api/internal/tasks?eventId=${eventId}`);
      const payload = await response.json().catch(() => null) as { data?: AdminTaskDTO[] } | null;
      if (!response.ok || !payload?.data) throw new Error("task refresh failed");
      const all = payload.data;
      setTasks(all);
      const contact = all.filter((task) => task.targetType === "contact").length;
      const submission = all.filter((task) => task.targetType === "submission").length;
      setTabCounts({ all: contact + submission, contact, group: 0, submission });
      router.refresh();
    } catch {
      toast("Could not refresh tasks — showing the last saved list");
    }
  }

  async function remove(task: AdminTaskDTO) {
    const result = await taskMutation(`/api/internal/tasks/${task.id}?eventId=${eventId}`, { method: "DELETE" }, "That task could not be deleted");
    if (!result.ok) { toast(result.message); return; }
    toast(`${task.name} deleted`);
    setPendingDelete(null);
    await refresh();
  }

  // Owned here, not inside `FileRequestsView` — a request created while that
  // section is open has to be immediately selectable in the task editor's
  // "File request" dropdown, which only holds if both read the same list.
  async function refreshFileRequests() {
    try {
      const response = await fetch(`/api/internal/file-requests?eventId=${eventId}`);
      const payload = await response.json().catch(() => null) as { data?: FileRequestDTO[] } | null;
      if (!response.ok || !payload?.data) throw new Error("file request refresh failed");
      setFileRequests(payload.data);
    } catch {
      toast("Could not refresh file requests — showing the last saved list");
    }
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Tasks"
        description="Create tasks that can be assigned to your portals"
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add Task</Button>}
      />

      <Segmented
        value={section}
        onChange={setSection}
        items={[{ value: "tasks", label: "Tasks" }, { value: "file_requests", label: "File Requests" }]}
      />

      {section === "tasks" && (
        <>
          <nav className="abstract-status-tabs">
            <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>All Tasks <span>{tabCounts.all}</span></button>
            <button type="button" className={tab === "contact" ? "active" : ""} onClick={() => setTab("contact")}>Contact Tasks <span>{tabCounts.contact}</span></button>
            <button type="button" className={tab === "group" ? "active" : ""} onClick={() => setTab("group")}>Group Tasks <span>{tabCounts.group}</span></button>
            <button type="button" className={tab === "submission" ? "active" : ""} onClick={() => setTab("submission")}>Submission Tasks <span>{tabCounts.submission}</span></button>
          </nav>

          <section className="panel data-panel">
            <div className="data-toolbar">
              <label className="table-search">
                <Search size={16} />
                <input placeholder="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} />
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
                action={tab !== "group" ? <Button onClick={() => setCreating(true)}>Add Task</Button> : undefined}
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
                    <div><b>{task.counts.completed}/{total}</b><span>{progress}%</span></div>
                    <ProgressBar value={progress} tone={progress > 75 ? "green" : "accent"} />
                  </div>
                  <TaskRowMenu task={task} onView={() => setMatrixTaskId(task.id)} onEdit={() => setEditing(task)} onDelete={() => setPendingDelete(task)} />
                </article>
              );
            })}
          </section>
        </>
      )}

      {section === "file_requests" && <FileRequestsView eventId={eventId} requests={fileRequests} onChanged={refreshFileRequests} />}

      <TaskEditor
        eventId={eventId}
        timezone={timezone}
        open={creating || editing !== null}
        task={editing}
        locked={editing !== null && editing.counts.completed > 0}
        forms={forms}
        fileRequests={fileRequests}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={async () => { setCreating(false); setEditing(null); await refresh(); }}
      />

      {matrixTask && (
        <TaskMatrixDrawer
          eventId={eventId}
          task={matrixTask}
          timezone={timezone}
          onClose={() => setMatrixTaskId(null)}
          nav={{
            index: matrixIndex,
            total: taskIds.length,
            ...(taskIds[matrixIndex - 1] ? { onPrev: () => setMatrixTaskId(taskIds[matrixIndex - 1] as string) } : {}),
            ...(taskIds[matrixIndex + 1] ? { onNext: () => setMatrixTaskId(taskIds[matrixIndex + 1] as string) } : {}),
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : ""}
        body="Speakers who already completed this task lose their record of it."
        confirmLabel="Delete task"
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}

function TaskRowMenu({ task, onView, onEdit, onDelete }: { task: AdminTaskDTO; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="task-row-menu">
      <button type="button" className="icon-button" aria-label={`Actions for ${task.name}`} onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "var(--shadow-sm)", minWidth: 140, padding: 4 }}>
          <button type="button" className="menu-item" style={menuItemStyle} onClick={() => { setOpen(false); onView(); }}>View responses</button>
          <button type="button" className="menu-item" style={menuItemStyle} onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
          <button type="button" className="menu-item" style={{ ...menuItemStyle, color: "var(--red)" }} onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: 0, background: "transparent", fontSize: 11.5, borderRadius: 6, cursor: "pointer" };
