"use client";

import { CheckCircle2, ClipboardCheck, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { TzTime } from "@/shared/ui/app/tz-time";
import type { MyTaskDTO } from "../server/queries";

/**
 * Everything a speaker owes, in one list.
 *
 * Tabs and filters narrow the rows that were already fetched — one request, then
 * arithmetic. A count that comes from a second query is a count that eventually
 * disagrees with the list under it.
 */

const MODE_ICON = {
  manual: <CheckCircle2 size={20} />,
  form: <FileText size={20} />,
  file_request: <Upload size={20} />,
} as const;

const MODE_CTA = { manual: "Mark complete", form: "Complete form", file_request: "Upload file" } as const;

type Tab = "all" | "mine" | "submissions";
type Filter = "open" | "completed" | "overdue" | "all";

/** The URL that completes exactly this assignment, submission and all. */
export function taskHref(eventSlug: string, task: MyTaskDTO): string {
  const query = task.submissionId ? `?submissionId=${task.submissionId}` : "";
  return `/portal/${encodeURIComponent(eventSlug)}/tasks/${task.taskId}${query}`;
}

function TaskCard({ task, eventSlug, timezone }: { task: MyTaskDTO; eventSlug: string; timezone: string }) {
  return (
    <Link className={`portal-task-card${task.completed ? " completed" : ""}`} href={taskHref(eventSlug, task)}>
      <span className={`portal-task-icon ${task.completionMode}`}>{MODE_ICON[task.completionMode]}</span>
      <div>
        <div className="portal-task-meta">
          <StatusBadge value={task.completed ? "Complete" : task.completionMode.replace("_", " ")} />
          {task.overdue && <StatusBadge value="Overdue" />}
          {task.dueAt && !task.completed && (
            <span className="due-label">Due <TzTime instant={task.dueAt} tz={timezone} style="date" /></span>
          )}
          {task.completedAt && (
            <span className="due-label">Completed <TzTime instant={task.completedAt} tz={timezone} style="date" /></span>
          )}
        </div>
        <h3>{task.taskName}</h3>
        {task.submissionCode !== null && <p>SESS-{task.submissionCode} · {task.submissionTitle}</p>}
      </div>
      <span className="button button-secondary button-sm">{task.completed ? "View" : MODE_CTA[task.completionMode]}</span>
    </Link>
  );
}

export function TaskList({
  tasks,
  eventSlug,
  timezone,
}: {
  tasks: MyTaskDTO[];
  eventSlug: string;
  timezone: string;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState<Filter>("open");

  const counts = useMemo(() => ({
    all: tasks.length,
    mine: tasks.filter((task) => task.submissionId === null).length,
    submissions: tasks.filter((task) => task.submissionId !== null).length,
    done: tasks.filter((task) => task.completed).length,
  }), [tasks]);

  const shown = useMemo(() => tasks.filter((task) => {
    if (tab === "mine" && task.submissionId !== null) return false;
    if (tab === "submissions" && task.submissionId === null) return false;
    if (filter === "open") return !task.completed;
    if (filter === "completed") return task.completed;
    if (filter === "overdue") return task.overdue;
    return true;
  }), [tasks, tab, filter]);

  // Submission tasks are grouped by the session they belong to, because "upload
  // your slides" twice with no context is indistinguishable from a bug.
  const grouped = useMemo(() => {
    const groups = new Map<string, { heading: string; rows: MyTaskDTO[] }>();
    for (const task of shown.filter((entry) => entry.submissionId !== null)) {
      const key = task.submissionId ?? "";
      const heading = `SESS-${task.submissionCode} · ${task.submissionTitle ?? ""}`.trim();
      const group = groups.get(key) ?? { heading, rows: [] };
      group.rows.push(task);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [shown]);

  const mine = shown.filter((task) => task.submissionId === null);

  return (
    <>
      <div className="portal-task-summary">
        <div>
          <strong>{counts.done}/{counts.all}</strong>
          <span>tasks complete</span>
        </div>
        <ProgressBar value={counts.all === 0 ? 100 : Math.round((counts.done / counts.all) * 100)} tone="green" />
      </div>

      <div className="abstract-status-tabs" role="tablist">
        {([["all", `All ${counts.all}`], ["mine", `My tasks ${counts.mine}`], ["submissions", `Sessions ${counts.submissions}`]] as const)
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        <label className="table-search">
          <span className="sr-only">Filter tasks</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter tasks">
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="overdue">Overdue</option>
            <option value="all">Everything</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <ClipboardCheck size={28} />
          <h3>{counts.all === 0 ? "Nothing is needed from you yet" : "Nothing here right now"}</h3>
          <p>
            {counts.all === 0
              ? "When the team needs something — a bio, a headshot, your slides — it will appear here."
              : "Try another tab or filter; your other tasks are still there."}
          </p>
        </div>
      ) : (
        <div className="portal-task-board">
          {mine.length > 0 && (
            <section>
              <h2>My tasks <span>{mine.length}</span></h2>
              {mine.map((task) => <TaskCard key={task.taskId} task={task} eventSlug={eventSlug} timezone={timezone} />)}
            </section>
          )}
          {grouped.map((group) => (
            <section key={group.heading}>
              <h2>{group.heading} <span>{group.rows.length}</span></h2>
              {group.rows.map((task) => (
                <TaskCard key={`${task.taskId}:${task.submissionId}`} task={task} eventSlug={eventSlug} timezone={timezone} />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
