"use client";

import { useEffect, useState } from "react";
import type { ContactId, EventId, SendReminderNowInput } from "@/shared/contracts";
import type { OpenAssignmentRow } from "@/features/comms";
import { isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Dash } from "@/shared/ui/app/dash";
import { Button, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useOpenAssignments, useSendReminderNow } from "../hooks/use-send-reminder";
import {
  clearTargetedReminderRecovery,
  loadTargetedReminderRecovery,
  persistTargetedReminderRecovery,
} from "../targeted-reminder-recovery";

type FrozenReminderAttempt = {
  assignment: OpenAssignmentRow;
  input: SendReminderNowInput & { attemptId: string };
  outcomeUnknown: boolean;
};

function assignmentKey(assignment: Pick<OpenAssignmentRow, "taskId" | "submissionId">): string {
  return `${assignment.taskId}:${assignment.submissionId ?? "-"}`;
}

function outcomeIsUnknown(caught: unknown): boolean {
  return !isAppError(caught) || caught.code === "INTERNAL";
}

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
  const [sentAssignmentKey, setSentAssignmentKey] = useState<string | null>(null);
  const [pending, setPending] = useState<FrozenReminderAttempt | null>(null);

  useEffect(() => {
    const recovered = loadTargetedReminderRecovery(window.localStorage, eventId, contactId);
    if (recovered) {
      setPending((current) => current ?? {
        assignment: recovered.assignment,
        input: recovered.input,
        outcomeUnknown: true,
      });
    }
  }, [contactId, eventId]);

  function beginAttempt(assignment: OpenAssignmentRow) {
    setPending({
      assignment,
      input: {
        taskId: assignment.taskId,
        contactId,
        submissionId: assignment.submissionId,
        attemptId: crypto.randomUUID(),
      },
      outcomeUnknown: false,
    });
  }

  async function send(attempt: FrozenReminderAttempt) {
    const recoveryStored = persistTargetedReminderRecovery(window.localStorage, {
      version: 1,
      eventId,
      contactId,
      assignment: attempt.assignment,
      input: attempt.input,
    });
    if (!recoveryStored) {
      toast("Could not prepare a safe reminder retry. The reminder was not sent.", { kind: "error" });
      return;
    }
    try {
      const result = await sendReminder.mutateAsync(attempt.input);
      clearTargetedReminderRecovery(window.localStorage, eventId, contactId, attempt.input.attemptId);
      if (result.enqueued) setSentAssignmentKey(assignmentKey(attempt.assignment));
      toast(result.enqueued ? "Reminder queued — it will arrive in about a second" : "Already complete — nothing to remind");
      setPending((current) => current?.input.attemptId === attempt.input.attemptId ? null : current);
    } catch (caught) {
      if (outcomeIsUnknown(caught)) {
        setPending((current) => current?.input.attemptId === attempt.input.attemptId
          ? { ...current, outcomeUnknown: true }
          : current);
        toast("Could not confirm whether that reminder was queued", { kind: "error" });
        return;
      }
      clearTargetedReminderRecovery(window.localStorage, eventId, contactId, attempt.input.attemptId);
      setPending((current) => current?.input.attemptId === attempt.input.attemptId ? null : current);
      toast(isAppError(caught) ? caught.message : "Could not queue that reminder", { kind: "error" });
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
                <Button size="sm" variant="secondary" disabled={sendReminder.isPending} onClick={() => beginAttempt(assignment)}>
                  {sentAssignmentKey === assignmentKey(assignment) ? "Sent" : "Send reminder"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={pending !== null}
        variant="destructive"
        title={pending ? `Send "${pending.assignment.taskName}" now?` : "Send reminder now?"}
        body={pending?.outcomeUnknown
          ? "The outcome is unknown. Retry reminder safely resends this exact attempt; it will not queue a duplicate."
          : "This emails the speaker immediately, outside the regular reminder ladder."}
        confirmLabel={pending?.outcomeUnknown ? "Retry reminder" : "Send reminder"}
        cancelDisabled={pending?.outcomeUnknown ?? false}
        onConfirm={async () => {
          if (!pending) return;
          await send(pending);
        }}
        onCancel={() => {
          if (pending) {
            clearTargetedReminderRecovery(window.localStorage, eventId, contactId, pending.input.attemptId);
          }
          setPending(null);
        }}
      />
    </>
  );
}
