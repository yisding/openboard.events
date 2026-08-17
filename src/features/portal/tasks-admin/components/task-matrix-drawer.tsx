"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { BulkReminderRecoveryController } from "@/features/comms/index.client";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { SkeletonText } from "@/shared/ui/app/skeleton";
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
  onCompletionReopened,
  reminderRecovery,
  reminderAcknowledgement,
  nav,
}: {
  eventId: string;
  task: AdminTaskDTO;
  timezone: string;
  onClose: () => void;
  reminderRecovery: BulkReminderRecoveryController;
  reminderAcknowledgement: number;
  nav?: { index: number; total: number; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined };
  /**
   * Reopening changes the parent's counts, and the parent's state is what draws
   * the progress bar and decides `locked`. Without this the drawer said "0 of 1"
   * while the row behind it still said "1/1 · 100%", and Edit still greyed the
   * shape controls out with "This task has completions" even though the server
   * would now allow the change — only a full browser reload fixed it. Every
   * sibling mutation in this module already funnels through the same refresh.
   */
  onCompletionReopened?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminTaskAssignmentDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set());
  }, [reminderAcknowledgement]);

  // Flowing down the task list opens several tasks in a row; a late response
  // for one already passed must not replace what is on screen now. `seqRef`
  // drops a fetch that a newer one has superseded, and `activeTaskRef` drops
  // one that reopen()'s stale closure fired for the previous task.
  const seqRef = useRef(0);
  const activeTaskRef = useRef(task.id);

  async function load(taskId: string = task.id) {
    if (taskId !== activeTaskRef.current) return;
    const seq = ++seqRef.current;
    const current = () => seq === seqRef.current && taskId === activeTaskRef.current;
    setLoadError(false);
    try {
      const response = await fetch(`/api/internal/tasks/${taskId}?eventId=${eventId}`);
      const payload = await response.json().catch(() => null) as { data?: { assignments: AdminTaskAssignmentDTO[] } } | null;
      if (!current()) return;
      if (!response.ok || !payload?.data) throw new Error("assignment refresh failed");
      setRows(payload.data.assignments);
    } catch {
      if (current()) setLoadError(true);
    }
  }

  useEffect(() => {
    activeTaskRef.current = task.id;
    setRows(null);
    setSelected(new Set());
    void load(task.id);
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
      if (!result.ok) { toast(result.message, { kind: "error" }); return; }
      toast(`${row.contactName}'s completion was reopened`);
      await load();
      await onCompletionReopened?.();
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
    await reminderRecovery.start(targets.map((row) => ({ taskId: task.id, contactId: row.contactId, submissionId: row.submissionId })));
  }

  const completed = rows?.filter((row) => row.completed).length ?? 0;
  const total = rows?.length ?? 0;

  return (
    <Drawer
      open
      onClose={() => { if (!reminderRecovery.blocked) onClose(); }}
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
              <Button size="sm" variant="secondary" disabled={reminderRecovery.blocked} onClick={() => void remindSelected()}>
                {reminderRecovery.sending ? "Reminding…" : "Send reminder"}
              </Button>
            }
          />
          {rows === null && !loadError && <SkeletonText lines={3} label="Loading assignees…" />}
          {loadError && <LoadFailure message="Assignments could not be loaded." onRetry={() => void load()} />}
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
                      disabled={reminderRecovery.blocked}
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                    />
                  </label>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: "block", fontSize: "var(--text-xs)" }}>{row.contactName}</b>
                  {row.submissionCode !== null && <small style={{ display: "block", color: "var(--muted)", fontSize: "var(--text-xs)" }}>#{row.submissionCode} {row.submissionTitle}</small>}
                  <small style={{ display: "block", color: "var(--muted)", fontSize: "var(--text-xs)", marginTop: 2 }}>
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
