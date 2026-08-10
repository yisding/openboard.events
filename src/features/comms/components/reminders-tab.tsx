"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import type { EventId } from "@/shared/contracts";
import type { ReminderRuleRow } from "@/features/comms";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useReminderRules, useSaveReminderRules } from "../hooks/use-reminder-rules";

function offsetLabel(offsetDays: number): string {
  if (offsetDays < 0) return `${Math.abs(offsetDays)} day${Math.abs(offsetDays) === 1 ? "" : "s"} before due`;
  if (offsetDays > 0) return `${offsetDays} day${offsetDays === 1 ? "" : "s"} after due`;
  return "On the due date";
}

/**
 * Reminders tab (step 4). Rows are `reminder_rules` — usually the seeded
 * three (−7, −1, +1) — each with an enable switch and an editable integer
 * offset. Saving replaces the whole set: `saveReminderRules` upserts every
 * row kept and deletes any offset no longer present.
 */
export function RemindersTab({ eventId, initialData }: { eventId: EventId; initialData: ReminderRuleRow[] }) {
  const { toast } = useToast();
  const query = useReminderRules(eventId, initialData);
  const save = useSaveReminderRules(eventId);
  const serverRows = query.data ?? initialData;
  const [rows, setRows] = useState<{ offsetDays: number; enabled: boolean }[]>(serverRows.map((row) => ({ offsetDays: row.offsetDays, enabled: row.enabled })));
  const [dirty, setDirty] = useState(false);

  // A save (or another organizer's poll refresh) replaces the working set —
  // but never while this organizer has an unsaved edit in progress.
  useEffect(() => {
    if (dirty) return;
    setRows(serverRows.map((row) => ({ offsetDays: row.offsetDays, enabled: row.enabled })));
  }, [serverRows, dirty]);

  function updateRow(index: number, patch: Partial<{ offsetDays: number; enabled: boolean }>) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setDirty(true);
  }

  async function onSave() {
    try {
      await save.mutateAsync(rows);
      setDirty(false);
      toast("Reminder ladder saved");
    } catch {
      toast("Could not save the reminder ladder");
    }
  }

  return (
    <div className="reminder-layout">
      <section className="panel reminder-rules">
        <header className="panel-header">
          <div><h2>Task reminder ladder</h2><p>Every open assignment is checked against these rungs on each scan.</p></div>
        </header>
        {rows.map((row, index) => (
          <div className="reminder-rule" key={index}>
            <label className="checkbox-row">
              <input type="checkbox" checked={row.enabled} onChange={(event) => updateRow(index, { enabled: event.target.checked })} />
              <b>{offsetLabel(row.offsetDays)}</b>
            </label>
            <label>
              Offset (days from due date)
              <input
                type="number"
                value={row.offsetDays}
                onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) updateRow(index, { offsetDays: Math.trunc(next) }); }}
              />
            </label>
          </div>
        ))}
        {rows.length === 0 && <p className="long-copy">No reminder rungs are configured — task reminders will never send.</p>}
        <footer><Button onClick={() => void onSave()} disabled={save.isPending || !dirty}>{save.isPending ? "Saving…" : "Save reminder rules"}</Button></footer>
      </section>
      <aside className="panel reminder-explainer">
        <span><Clock3 size={21} /></span>
        <h3>Burst-safe by design</h3>
        <p>Only the most recent applicable reminder is sent — a task that is already overdue gets one email, not three.</p>
        <ul>
          <li>Rechecks completion before send</li>
          <li>One idempotency key per rung</li>
          <li>Retires superseded rungs as a visible &quot;skipped&quot; log row</li>
        </ul>
      </aside>
    </div>
  );
}
