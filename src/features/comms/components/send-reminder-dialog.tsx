"use client";

import { useState } from "react";
import type { ContactId, EventId, SubmissionId, TaskId } from "@/shared/contracts";
import type { OpenAssignmentRow } from "@/features/comms";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Dash } from "@/shared/ui/app/dash";
import { Button, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useOpenAssignments, useSendReminderNow } from "../hooks/use-send-reminder";

/**
 * Step 7: a small dialog listing this speaker's currently open assignments —
 * picking one enqueues through `sendReminderNow` and nudges the outbox, the
 * same idempotent path the reminder scan itself uses. Never sends inline.
 */
export function SendReminderDialog({
  eventId,
  contactId,
  contactName,
  onClose,
}: {
  eventId: EventId;
  contactId: ContactId;
  contactName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const assignments = useOpenAssignments(eventId, contactId);
  const sendReminder = useSendReminderNow(eventId);
  const [sentTaskId, setSentTaskId] = useState<string | null>(null);
  const [pending, setPending] = useState<OpenAssignmentRow | null>(null);

  async function send(taskId: TaskId, submissionId: SubmissionId | null) {
    try {
      const result = await sendReminder.mutateAsync({ taskId, contactId, submissionId });
      setSentTaskId(taskId);
      toast(result.enqueued ? "Reminder queued — it will arrive in about a second" : "Already complete — nothing to remind");
    } catch {
      toast("Could not queue that reminder", { kind: "error" });
    }
  }

  return (
    <>
      <Modal open onClose={onClose} title={`Send reminder — ${contactName}`} description="Only this speaker's currently open assignments are listed.">
        {assignments.isLoading && <p className="long-copy">Loading open assignments…</p>}
        {assignments.isError && <p className="long-copy">Could not load this speaker&apos;s open assignments.</p>}
        {assignments.data && assignments.data.length === 0 && <p className="long-copy">No open assignments — this speaker is caught up.</p>}
        {assignments.data && assignments.data.length > 0 && (
          <ul className="send-reminder-list">
            {assignments.data.map((assignment) => (
              <li key={`${assignment.taskId}:${assignment.submissionId ?? "-"}`}>
                <div>
                  <b>{assignment.taskName}</b>
                  <span><Dash value={assignment.submissionCode} /> · due <Dash value={assignment.dueAt} /></span>
                </div>
                <Button size="sm" variant="secondary" disabled={sendReminder.isPending} onClick={() => setPending(assignment)}>
                  {sentTaskId === assignment.taskId ? "Sent" : "Send reminder"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={pending !== null}
        variant="destructive"
        title={pending ? `Send "${pending.taskName}" now?` : "Send reminder now?"}
        body="This emails the speaker immediately, outside the regular reminder ladder."
        confirmLabel="Send reminder"
        onConfirm={async () => {
          if (!pending) return;
          await send(pending.taskId, pending.submissionId);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
