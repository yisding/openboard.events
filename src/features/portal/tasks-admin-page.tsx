"use client";

import { CalendarClock, CheckCircle2, FileText, Plus, Search, Upload, Users } from "lucide-react";
import { useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import type { TaskRecord } from "@/shared/demo/types";
import { Button, Field, Modal, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

export function TasksAdminPage({ eventId }: { eventId: string }) {
  const { state, dispatch } = useDemo();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<TaskRecord["mode"]>("manual");
  const [target, setTarget] = useState<TaskRecord["target"]>("contact");
  const [dueDate, setDueDate] = useState("2026-09-05");
  const [search, setSearch] = useState("");
  const tasks = state.tasks.filter((task) => task.eventId === eventId
    && `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase()));

  function create() {
    if (!title.trim() || !dueDate) return;
    dispatch({
      type: "ADD_TASK",
      task: {
        id: `task_${Date.now()}`,
        eventId,
        title,
        description: "Complete this item in your speaker portal.",
        mode,
        target,
        dueAt: new Date(`${dueDate}T23:59:00-07:00`).toISOString(),
        assigned: target === "contact" ? 10 : 8,
        completed: 0,
        required: true,
      },
    });
    setCreating(false);
    setTitle("");
    toast(`Task published to accepted ${target === "contact" ? "speakers" : "submissions"}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="PEOPLE"
        title="Onboarding tasks"
        description="Collect speaker information, files, and confirmations without spreadsheets."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Create task</Button>}
      />
      <div className="task-admin-grid">
        <section className="task-list-panel panel">
          <div className="data-toolbar">
            <label className="table-search">
              <Search size={16} />
              <input aria-label="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" />
            </label>
            <span className="row-count">{tasks.length} matching</span>
          </div>
          {tasks.map((task) => {
            const progress = task.assigned ? Math.round(task.completed / task.assigned * 100) : 0;
            return (
              <article className="admin-task-row" key={task.id}>
                {/* T6: the mode tint borrowed green/blue for a category with no
                    status meaning; the icon shape already distinguishes the three
                    modes, so the chip renders neutral. */}
                <span className="task-mode-icon">
                  {task.mode === "file_request" ? <Upload size={18} /> : task.mode === "form" ? <FileText size={18} /> : <CheckCircle2 size={18} />}
                </span>
                <div className="admin-task-main">
                  <div><h3>{task.title}</h3><StatusBadge value={task.mode.replace("_", " ")} /></div>
                  <p>{task.description}</p>
                  <div>
                    <span><CalendarClock size={13} /> Due {new Date(task.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}</span>
                    <span><Users size={13} /> {task.assigned} assigned · {task.target === "contact" ? "speakers" : "submissions"}</span>
                  </div>
                </div>
                <div className="admin-task-progress">
                  <div><b>{task.completed}/{task.assigned}</b><span>{progress}%</span></div>
                  <ProgressBar label={`Completion for ${task.title}`} value={progress} tone={progress > 75 ? "green" : "accent"} />
                </div>
              </article>
            );
          })}
        </section>
        <aside className="task-insights panel">
          <header className="panel-header"><div><h2>Completion overview</h2><p>Across accepted speakers</p></div></header>
          <div className="completion-ring">
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /><circle className="value" cx="50" cy="50" r="40" pathLength="100" strokeDasharray="68 100" /></svg>
            <div><strong>68%</strong><span>complete</span></div>
          </div>
          <div className="task-legend">
            <div><i className="green" /><span>Complete</span><b>24</b></div>
            <div><i className="accent" /><span>In progress</span><b>8</b></div>
            <div><i className="amber" /><span>Overdue</span><b>4</b></div>
          </div>
          <Button variant="secondary" onClick={() => toast("Reminder queued for overdue assignments")}>Send overdue reminders</Button>
        </aside>
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create an onboarding task"
        description="Assign once to contacts or per accepted submission."
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={!title.trim() || !dueDate} onClick={create}>Create task</Button></>}
      >
        <div className="form-stack">
          <Field label="Task title" required>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Upload final slides" />
          </Field>
          <Field label="Completion mode" group>
            <div className="choice-cards compact">
              {(["manual", "form", "file_request"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={mode === value ? "active" : ""}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  <b>{value.replace("_", " ")}</b>
                  <small>{value === "manual" ? "One-click confirmation" : value === "form" ? "Structured questions" : "Document upload"}</small>
                </button>
              ))}
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Target">
              <select value={target} onChange={(event) => setTarget(event.target.value as TaskRecord["target"])}>
                <option value="contact">Accepted speakers</option>
                <option value="submission">Accepted submissions</option>
              </select>
            </Field>
            <Field label="Due date"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
