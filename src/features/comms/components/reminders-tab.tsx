"use client";

import { Clock3, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { EventId } from "@/shared/contracts";
import type { ReminderRuleRow } from "@/features/comms";
import { Button, EmptyState, Field, Switch } from "@/shared/ui/ui-kit";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { useReminderRules, useSaveReminderRules } from "../hooks/use-reminder-rules";

const EMPTY_RULES: ReminderRuleRow[] = [];
// Mirrors `reminderRulesInputSchema`, so a ladder the editor accepts can never
// come back from the route behind it as a 400.
const MAX_RUNGS = 20;
const MIN_OFFSET = -90;
const MAX_OFFSET = 90;

function offsetLabel(offsetDays: number): string {
  if (offsetDays < 0) return `${Math.abs(offsetDays)} day${Math.abs(offsetDays) === 1 ? "" : "s"} before due`;
  if (offsetDays > 0) return `${offsetDays} day${offsetDays === 1 ? "" : "s"} after due`;
  return "On the due date";
}

/** The next rung earlier than the whole ladder, so a new row never lands on a collision. */
function nextFreeOffset(rows: { offsetDays: number }[]): number {
  const taken = new Set(rows.map((row) => row.offsetDays));
  const earliest = rows.length === 0 ? 0 : Math.min(...taken);
  for (let candidate = earliest - 1; candidate >= MIN_OFFSET; candidate -= 1) {
    if (!taken.has(candidate)) return candidate;
  }
  for (let candidate = earliest + 1; candidate <= MAX_OFFSET; candidate += 1) {
    if (!taken.has(candidate)) return candidate;
  }
  return MIN_OFFSET;
}

/**
 * Reminders tab (step 4). Rows are `reminder_rules` — usually the seeded
 * three (−7, −1, +1) — each with an enable switch and an editable integer
 * offset. Saving replaces the whole set: `saveReminderRules` upserts every
 * row kept and deletes any offset no longer present.
 *
 * Offsets are the identity of a rung, so two rows sharing one would be merged
 * by that replacement — a rung disappearing with no warning. The editor
 * refuses to save a colliding set instead, and owns both directions of the
 * ladder: adding a rung and removing one are explicit controls rather than
 * side effects of editing a number.
 */
export function RemindersTab({ eventId }: { eventId: EventId }) {
  const { toast } = useToast();
  const query = useReminderRules(eventId);
  const save = useSaveReminderRules(eventId);
  const serverRows = query.data ?? EMPTY_RULES;
  const [rows, setRows] = useState<{ offsetDays: number; enabled: boolean }[]>(serverRows.map((row) => ({ offsetDays: row.offsetDays, enabled: row.enabled })));
  const [dirty, setDirty] = useState(false);
  useUnsavedWorkGuard(dirty);

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

  function addRung() {
    setRows((current) => [...current, { offsetDays: nextFreeOffset(current), enabled: true }]);
    setDirty(true);
  }

  function removeRung(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function onSave() {
    try {
      await save.mutateAsync(rows);
      setDirty(false);
      toast("Reminder ladder saved");
    } catch {
      toast("Could not save the reminder ladder", { kind: "error" });
    }
  }

  const offsets = rows.map((row) => row.offsetDays);
  const duplicates = new Set(offsets.filter((offset, index) => offsets.indexOf(offset) !== index));

  return (
    <div className="reminder-layout">
      <section className="panel reminder-rules reminder-rules-editor">
        <header className="panel-header">
          <div><h2>Task reminder ladder</h2><p>Every open assignment is checked against these rungs on each scan.</p></div>
          <Button variant="secondary" size="sm" onClick={addRung} disabled={rows.length >= MAX_RUNGS}>
            <Plus size={14} aria-hidden /> Add rung
          </Button>
        </header>
        {rows.map((row, index) => (
          <div className="reminder-rule" key={index}>
            <div className="reminder-rule-control">
              <span>
                <b>{offsetLabel(row.offsetDays)}</b>
                <small>{row.enabled ? "Active reminder" : "Paused"}</small>
              </span>
              <Switch label={`${offsetLabel(row.offsetDays)} reminder`} checked={row.enabled} onClick={() => updateRow(index, { enabled: !row.enabled })} />
            </div>
            <Field label="Offset (days from due date)" error={duplicates.has(row.offsetDays) ? "Another rung already uses this offset" : undefined}>
              <input
                type="number"
                min={MIN_OFFSET}
                max={MAX_OFFSET}
                value={row.offsetDays}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) updateRow(index, { offsetDays: Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.trunc(next))) });
                }}
              />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              className="reminder-rule-remove"
              aria-label={`Remove rung: ${offsetLabel(row.offsetDays)}`}
              onClick={() => removeRung(index)}
            >
              <Trash2 size={15} aria-hidden /> Remove
            </Button>
          </div>
        ))}
        {rows.length === 0 && (
          <EmptyState
            icon={<Clock3 size={21} />}
            title="No reminder rungs"
            description="Task reminders will never send until this ladder has at least one rung."
            action={<Button onClick={addRung}>Add rung</Button>}
          />
        )}
        <footer><Button onClick={() => void onSave()} disabled={save.isPending || !dirty || duplicates.size > 0}>{save.isPending ? "Saving…" : "Save reminder rules"}</Button></footer>
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
