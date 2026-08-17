"use client";

import { CheckCircle2, ClipboardCheck, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { EmptyState, ProgressBar, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { TzTime } from "@/shared/ui/app/tz-time";
import { moveRovingTab } from "@/shared/ui/app/roving-tabs";
import { formatCode } from "@/features/submissions/index.client";
import { taskHref } from "@/features/portal/lib/task-href";
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

const TASK_TABS = ["all", "mine", "submissions"] as const;
type Tab = (typeof TASK_TABS)[number];
type Filter = "open" | "completed" | "overdue" | "all";

function TaskCard({ task, eventSlug, timezone }: { task: MyTaskDTO; eventSlug: string; timezone: string }) {
  return (
    <Link className={`portal-task-card${task.completed ? " completed" : ""}`} href={taskHref(eventSlug, task)}>
      <span className={`portal-task-icon ${task.completionMode}`}>{MODE_ICON[task.completionMode]}</span>
      <div>
        <div className="portal-task-meta">
          <StatusBadge value={task.completed ? "complete" : task.completionMode} />
          {task.overdue && <StatusBadge value="overdue" />}
          {task.dueAt && !task.completed && (
            <span className="due-label">Due <TzTime instant={task.dueAt} tz={timezone} style="date" /></span>
          )}
          {task.completedAt && (
            <span className="due-label">Completed <TzTime instant={task.completedAt} tz={timezone} style="date" /></span>
          )}
        </div>
        <h3>{task.taskName}</h3>
        {task.submissionCode !== null && <p>{formatCode(task.submissionCode)} · {task.submissionTitle}</p>}
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

  // Progress is over *every* task, always: "6/8 tasks complete" under a filtered
  // set would mean nothing.
  const progress = useMemo(() => ({
    all: tasks.length,
    done: tasks.filter((task) => task.completed).length,
  }), [tasks]);

  const matchesFilter = useCallback((task: MyTaskDTO) => {
    if (filter === "open") return !task.completed;
    if (filter === "completed") return task.completed;
    if (filter === "overdue") return task.overdue;
    return true;
  }, [filter]);

  // Tab badges count what each tab would actually show. They used to count the
  // unfiltered array while the section heading below counted the filtered one,
  // so a speaker with 8 assignments and 6 complete landed on the default "open"
  // filter and read the tab "My tasks 8" directly above the heading "My tasks 2"
  // — the same words, two numbers, one screen. The file's own header states the
  // rule: a count that disagrees with the list under it is the bug.
  const counts = useMemo(() => {
    const inFilter = tasks.filter(matchesFilter);
    return {
      all: inFilter.length,
      mine: inFilter.filter((task) => task.submissionId === null).length,
      submissions: inFilter.filter((task) => task.submissionId !== null).length,
    };
  }, [tasks, matchesFilter]);

  const shown = useMemo(() => tasks.filter((task) => {
    if (tab === "mine" && task.submissionId !== null) return false;
    if (tab === "submissions" && task.submissionId === null) return false;
    return matchesFilter(task);
  }), [tasks, tab, matchesFilter]);

  // Submission tasks are grouped by the session they belong to, because "upload
  // your slides" twice with no context is indistinguishable from a bug.
  const grouped = useMemo(() => {
    const groups = new Map<string, { submissionId: string; heading: string; rows: MyTaskDTO[] }>();
    for (const task of shown.filter((entry) => entry.submissionId !== null)) {
      const key = task.submissionId ?? "";
      // Headed by code and title, but keyed by id: two submissions with neither
      // would collapse to the same heading and React would reuse the wrong
      // section.
      const heading = [task.submissionCode === null ? "" : formatCode(task.submissionCode), task.submissionTitle ?? ""]
        .filter(Boolean).join(" · ") || "Session";
      const group = groups.get(key) ?? { submissionId: key, heading, rows: [] };
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
          <strong>{progress.done}/{progress.all}</strong>
          <span>tasks complete</span>
        </div>
        <ProgressBar label="Task completion" value={progress.all === 0 ? 100 : Math.round((progress.done / progress.all) * 100)} tone="green" />
      </div>

      <div className="abstract-status-tabs">
        {/* Only tabs may live inside a tablist, so the filter sits beside it
            rather than in it, and each tab names the panel it controls. */}
        <div className="tab-row" role="tablist" aria-label="Task groups">
          {([["all", `All ${counts.all}`], ["mine", `My tasks ${counts.mine}`], ["submissions", `Sessions ${counts.submissions}`]] as const)
            .map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`task-tab-${id}`}
                aria-controls="task-panel"
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                className={tab === id ? "active" : ""}
                onKeyDown={(event) => moveRovingTab(event, TASK_TABS, id, setTab)}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
        </div>
        <Select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter tasks">
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
          <option value="all">Everything</option>
        </Select>
      </div>

      <div id="task-panel" role="tabpanel" aria-labelledby={`task-tab-${tab}`}>
      {shown.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={28} />}
          title={counts.all === 0 ? "Nothing is needed from you yet" : "Nothing here right now"}
          description={counts.all === 0
            ? "When the team needs something — a bio, a headshot, your slides — it will appear here."
            : "Try another tab or filter; your other tasks are still there."}
        />
      ) : (
        <div className="portal-task-board">
          {mine.length > 0 && (
            <section>
              <h2>My tasks <span>{mine.length}</span></h2>
              {mine.map((task) => <TaskCard key={task.taskId} task={task} eventSlug={eventSlug} timezone={timezone} />)}
            </section>
          )}
          {grouped.map((group) => (
            <section key={group.submissionId}>
              <h2>{group.heading} <span>{group.rows.length}</span></h2>
              {group.rows.map((task) => (
                <TaskCard key={`${task.taskId}:${task.submissionId}`} task={task} eventSlug={eventSlug} timezone={timezone} />
              ))}
            </section>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
