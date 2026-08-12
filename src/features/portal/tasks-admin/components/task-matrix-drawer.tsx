"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AdminTaskAssignmentDTO, AdminTaskDTO } from "../server/queries";
import { taskMutation } from "./task-mutation";

const VIA_LABEL: Record<string, string> = {
  manual: "Marked complete",
  form_response: "Form response",
  file_upload: "File upload",
  admin: "Marked by organizer",
};

function assignmentKey(row: AdminTaskAssignmentDTO): string {
  return `${row.contactId}:${row.submissionId ?? ""}`;
}

/**
 * One row per `task_assignments_v` row for this task — the completion matrix
 * the work order calls for. This never recomputes who is assigned; it only
 * renders what the server already read from the view (resolution #14).
 *
 * M57 — `nav` gives this drawer the same keyboard/click next-prev across the
 * task list as the abstracts and speakers drawers, and the still-open
 * assignees get the same checkbox-selection + bulk bar pattern with a "Send
 * reminder" verb, reusing M52's generic bulk-reminder mutation.
 */
export function TaskMatrixDrawer({
  eventId,
  task,
  timezone,
  onClose,
  nav,
}: {
  eventId: string;
  task: AdminTaskDTO;
  timezone: string;
  onClose: () => void;
  nav?: { index: number; total: number; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined };
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminTaskAssignmentDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);

  async function load() {
    setLoadError(false);
    try {
      const response = await fetch(`/api/internal/tasks/${task.id}?eventId=${eventId}`);
      const payload = await response.json().catch(() => null) as { data?: { assignments: AdminTaskAssignmentDTO[] } } | null;
      if (!response.ok || !payload?.data) throw new Error("assignment refresh failed");
      setRows(payload.data.assignments);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    setRows(null);
    setSelected(new Set());
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function reopen(row: AdminTaskAssignmentDTO) {
    const key = assignmentKey(row);
    setBusyKey(key);
    try {
      const result = await taskMutation(`/api/internal/tasks/${task.id}/reopen?eventId=${eventId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: row.contactId, submissionId: row.submissionId }),
      }, "That completion could not be reopened");
      if (!result.ok) { toast(result.message); return; }
      toast(`${row.contactName}'s completion was reopened`);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function remindSelected() {
    const openRows = rows ?? [];
    const targets = openRows.filter((row) => !row.completed && selected.has(assignmentKey(row)));
    if (targets.length === 0) return;
    setReminding(true);
    try {
      const result = await taskMutation<{ enqueued: number; total: number }>(`/api/internal/deliverables/remind?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((row) => ({ taskId: task.id, contactId: row.contactId, submissionId: row.submissionId })),
        }),
      }, "Could not send reminders — try again");
      if (!result.ok || !result.payload?.data) { toast(result.ok ? "Could not send reminders — try again" : result.message); return; }
      toast(`Reminded ${result.payload.data.enqueued} of ${result.payload.data.total}`);
      setSelected(new Set());
    } finally {
      setReminding(false);
    }
  }

  const completed = rows?.filter((row) => row.completed).length ?? 0;
  const total = rows?.length ?? 0;

  return (
    <Drawer
      open
      onClose={onClose}
      title={task.name}
      {...(nav ? { headerExtra: <FlowNavControls index={nav.index} total={nav.total} itemLabel={task.name} onPrev={nav.onPrev} onNext={nav.onNext} /> } : {})}
    >
      <div className="drawer-content">
        <section>
          <h3>Progress</h3>
          <p className="long-copy">{completed} of {total} complete</p>
        </section>
        <section>
          <h3>Assignees</h3>
          <BulkActionBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            actions={
              <Button size="sm" variant="secondary" disabled={reminding} onClick={() => void remindSelected()}>
                {reminding ? "Reminding…" : "Send reminder"}
              </Button>
            }
          />
          {rows === null && !loadError && <p className="portal-note">Loading…</p>}
          {loadError && <p className="portal-note" role="alert">Assignments could not be loaded. <button type="button" className="text-button" onClick={() => void load()}>Try again</button></p>}
          {!loadError && rows !== null && rows.length === 0 && <p className="portal-note">Nobody is assigned to this task yet.</p>}
          {rows !== null && rows.map((row) => {
            const key = assignmentKey(row);
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                {/* `.checkbox-hit` carries the 44x44 touch target the bare
                    native control cannot — padding does not grow a checkbox.
                    The label toggles it with no extra handler. */}
                {!row.completed && (
                  <label className="checkbox-hit">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.contactName}`}
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                    />
                  </label>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: "block", fontSize: 11.5 }}>{row.contactName}</b>
                  {row.submissionCode !== null && <small style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>#{row.submissionCode} {row.submissionTitle}</small>}
                  <small style={{ display: "block", color: "var(--muted)", fontSize: 10, marginTop: 2 }}>
                    {row.completed
                      ? <>{VIA_LABEL[row.completedVia ?? ""] ?? "Complete"} · <TzTime instant={row.completedAt} tz={timezone} style="date" /></>
                      : row.overdue ? "Overdue" : row.dueAt ? <>Due <TzTime instant={row.dueAt} tz={timezone} style="date" /></> : "No due date"}
                  </small>
                </div>
                <StatusBadge value={row.completed ? "complete" : row.overdue ? "overdue" : "open"} />
                {row.completed && (
                  <button type="button" className="icon-button" aria-label={`Reopen ${row.contactName}'s completion`} disabled={busyKey === key} onClick={() => reopen(row)}>
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </Drawer>
  );
}
