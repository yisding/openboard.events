"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
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

  async function move(to: SubmissionStatus) {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: selected.map((row) => row.submissionId),
          to,
          // What the screen showed. Anything that moved since comes back stale
          // rather than being overwritten by a decision made against old data.
          expectedFrom: ["pending", "accept_queue", "decline_queue"],
        }),
      });
      const payload = await response.json().catch(() => null) as { data?: { changed: string[]; stale: string[] }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "That did not go through");
        return;
      }
      const { changed, stale } = payload.data;
      toast(stale.length === 0
        ? `${changed.length} moved`
        : `${changed.length} moved · ${stale.length} unchanged, someone else had already moved them`);
      onDone();
      router.refresh();
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
        toast(payload?.error?.message ?? "Notify did not go through");
        return;
      }
      const { accepted, declined, emailsQueued, skippedNoRecipient } = payload.data;
      const decided = accepted.length + declined.length;
      toast(decided === 0
        ? "Nothing was queued to notify"
        : `${decided} decided · ${emailsQueued} email${emailsQueued === 1 ? "" : "s"} sent`
          + (skippedNoRecipient.length > 0 ? ` · ${skippedNoRecipient.length} had no recipient` : ""));
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (selected.length === 0 && pendingNotify === 0) return null;

  return (
    <div className="bulk-bar">
      {selected.length > 0 ? (
        <>
          <span>{selected.length} selected</span>
          <Button variant="secondary" disabled={busy} onClick={() => move("accept_queue")}>Move to accept queue</Button>
          <Button variant="secondary" disabled={busy} onClick={() => move("decline_queue")}>Move to decline queue</Button>
          <Button variant="ghost" disabled={busy} onClick={onDone}>Clear</Button>
        </>
      ) : (
        <span>{pendingNotify} decision{pendingNotify === 1 ? "" : "s"} queued and not yet sent</span>
      )}
      {pendingNotify > 0 && (
        <Button disabled={busy} onClick={notify}>
          {busy ? "Sending…" : `Notify ${pendingNotify}`}
        </Button>
      )}
    </div>
  );
}
