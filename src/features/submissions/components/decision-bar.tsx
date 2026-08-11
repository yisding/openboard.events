"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

/**
 * Bulk decisions. Queueing and notifying are deliberately two actions: an
 * organizer builds a queue over a morning and sends once, and a Notify that
 * fired on every click would mail speakers a decision the team was still
 * arguing about.
 */
export function DecisionBar({
  eventId,
  selected,
  pendingNotify,
  onDone,
}: {
  eventId: string;
  selected: SubmissionListRow[];
  pendingNotify: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmingNotify, setConfirmingNotify] = useState(false);

  async function move(to: SubmissionStatus) {
    setBusy(true);
    try {
      // One call per observed status, not one blanket list. Sending every status
      // as `expectedFrom` would match a row another organizer had already moved
      // and overwrite their decision — which is the exact thing the stale set
      // exists to prevent.
      const byObserved = new Map<SubmissionStatus, string[]>();
      for (const row of selected) {
        if (row.status === to) continue;
        byObserved.set(row.status, [...(byObserved.get(row.status) ?? []), row.submissionId]);
      }

      let moved = 0;
      let unchanged = selected.filter((row) => row.status === to).length;
      for (const [observed, ids] of byObserved) {
        const response = await fetch(`/api/internal/submissions/${eventId}/transition`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids, to, expectedFrom: observed }),
        });
        const payload = await response.json().catch(() => null) as { data?: { changed: string[]; stale: string[] }; error?: { message?: string } } | null;
        if (!response.ok || !payload?.data) {
          toast(payload?.error?.message ?? "That did not go through", { kind: "error" });
          return;
        }
        moved += payload.data.changed.length;
        unchanged += payload.data.stale.length;
      }

      toast(unchanged === 0
        ? `${moved} moved`
        : `${moved} moved · ${unchanged} unchanged, someone else had already moved them`);
      onDone();
      router.refresh();
    } catch {
      toast("Could not reach the server. Check the latest decision state before trying again.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function notify() {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => null) as {
        data?: { accepted: string[]; declined: string[]; emailsQueued: number; skippedNoRecipient: string[] };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Notify did not go through", { kind: "error" });
        return;
      }
      const { accepted, declined, emailsQueued, skippedNoRecipient } = payload.data;
      const decided = accepted.length + declined.length;
      toast(decided === 0
        ? "Nothing was queued to notify"
        : `${decided} decided · ${emailsQueued} email${emailsQueued === 1 ? "" : "s"} queued`
          + (skippedNoRecipient.length > 0 ? ` · ${skippedNoRecipient.length} had no recipient` : ""));
      onDone();
      router.refresh();
      setConfirmingNotify(false);
    } catch {
      toast("Could not reach the server. Check Communications before retrying this notification batch.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return <>
    <BulkActionBar
      count={selected.length}
      onClear={onDone}
      actions={<>
        <Button variant="secondary" disabled={busy} onClick={() => move("accept_queue")}>Move to accept queue</Button>
        <Button variant="secondary" disabled={busy} onClick={() => move("decline_queue")}>Move to decline queue</Button>
      </>}
      {...(pendingNotify > 0 ? { emptyNote: <span>{pendingNotify} decision{pendingNotify === 1 ? "" : "s"} queued and not yet sent</span> } : {})}
      {...(pendingNotify > 0 ? {
        trailing: <Button disabled={busy} onClick={() => setConfirmingNotify(true)}>{busy ? "Queuing…" : `Notify ${pendingNotify}`}</Button>,
      } : {})}
    />
    <ConfirmDialog
      open={confirmingNotify}
      title={`Notify ${pendingNotify} decision${pendingNotify === 1 ? "" : "s"}?`}
      body="This finalizes every queued accept and decline decision for the event and queues the corresponding speaker emails. Review both queues before continuing."
      confirmLabel="Queue decision emails"
      variant="destructive"
      onConfirm={notify}
      onCancel={() => setConfirmingNotify(false)}
    />
  </>;
}
