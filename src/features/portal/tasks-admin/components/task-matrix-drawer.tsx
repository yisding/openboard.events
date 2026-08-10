"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AdminTaskAssignmentDTO, AdminTaskDTO } from "../server/queries";

const VIA_LABEL: Record<string, string> = {
  manual: "Marked complete",
  form_response: "Form response",
  file_upload: "File upload",
  admin: "Marked by organizer",
};

/**
 * One row per `task_assignments_v` row for this task — the completion matrix
 * the work order calls for. This never recomputes who is assigned; it only
 * renders what the server already read from the view (resolution #14).
 */
export function TaskMatrixDrawer({
  eventId,
  task,
  timezone,
  onClose,
}: {
  eventId: string;
  task: AdminTaskDTO;
  timezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminTaskAssignmentDTO[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`/api/internal/tasks/${task.id}?eventId=${eventId}`);
    const payload = await response.json().catch(() => null) as { data?: { assignments: AdminTaskAssignmentDTO[] } } | null;
    setRows(payload?.data?.assignments ?? []);
  }

  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function reopen(row: AdminTaskAssignmentDTO) {
    const key = `${row.contactId}:${row.submissionId ?? ""}`;
    setBusyKey(key);
    try {
      const response = await fetch(`/api/internal/tasks/${task.id}/reopen?eventId=${eventId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: row.contactId, submissionId: row.submissionId }),
      });
      if (!response.ok) {
        toast("That completion could not be reopened");
        return;
      }
      toast(`${row.contactName}'s completion was reopened`);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  const completed = rows?.filter((row) => row.completed).length ?? 0;
  const total = rows?.length ?? 0;

  return (
    <Drawer open onClose={onClose} title={task.name}>
      <div className="drawer-content">
        <section>
          <h3>Progress</h3>
          <p className="long-copy">{completed} of {total} complete</p>
        </section>
        <section>
          <h3>Assignees</h3>
          {rows === null && <p className="portal-note">Loading…</p>}
          {rows !== null && rows.length === 0 && <p className="portal-note">Nobody is assigned to this task yet.</p>}
          {rows !== null && rows.map((row) => {
            const key = `${row.contactId}:${row.submissionId ?? ""}`;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: "block", fontSize: 10 }}>{row.contactName}</b>
                  {row.submissionCode !== null && <small style={{ display: "block", color: "var(--muted)", fontSize: 8 }}>#{row.submissionCode} {row.submissionTitle}</small>}
                  <small style={{ display: "block", color: "var(--muted)", fontSize: 8, marginTop: 2 }}>
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
