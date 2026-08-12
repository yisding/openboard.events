"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

type DecisionSelection = Pick<SubmissionListRow, "submissionId" | "status">;
type DecisionTransitionRequest = (url: string, init: RequestInit) => Promise<Response>;

export type BulkDecisionOutcome = {
  moved: number;
  unchanged: number;
  unconfirmed: number;
  confirmedGroups: number;
  failedGroups: number;
  failureMessages: string[];
};

type BulkDecisionEffects = {
  onDone: () => void;
  refresh: () => void;
  toast: (message: string, options?: { kind?: "error" }) => void;
};

/**
 * Apply one guarded transition per observed status and reconcile every group.
 *
 * A rejected request is "unconfirmed", not "unchanged": the server may have
 * committed before the response was lost. Retrying is safe because the retry
 * carries the same expected status and therefore cannot overwrite a concurrent
 * decision. Continuing through the remaining independent groups also gives the
 * organizer one complete outcome instead of hiding everything after the first
 * failure.
 */
export async function completeBulkDecision({
  eventId,
  selected,
  to,
  effects,
  request = (url, init) => fetch(url, init),
}: {
  eventId: string;
  selected: DecisionSelection[];
  to: SubmissionStatus;
  effects: BulkDecisionEffects;
  request?: DecisionTransitionRequest;
}): Promise<BulkDecisionOutcome> {
  const byObserved = new Map<SubmissionStatus, string[]>();
  for (const row of selected) {
    if (row.status === to) continue;
    byObserved.set(row.status, [...(byObserved.get(row.status) ?? []), row.submissionId]);
  }

  const outcome: BulkDecisionOutcome = {
    moved: 0,
    unchanged: selected.filter((row) => row.status === to).length,
    unconfirmed: 0,
    confirmedGroups: 0,
    failedGroups: 0,
    failureMessages: [],
  };

  for (const [observed, ids] of byObserved) {
    try {
      const response = await request(`/api/internal/submissions/${eventId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, to, expectedFrom: observed }),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { changed?: unknown; stale?: unknown };
        error?: { message?: string };
      } | null;
      const changed = payload?.data?.changed;
      const stale = payload?.data?.stale;
      if (!response.ok || !Array.isArray(changed) || !Array.isArray(stale)) {
        outcome.unconfirmed += ids.length;
        outcome.failedGroups += 1;
        outcome.failureMessages.push(payload?.error?.message ?? "That transition returned an invalid response");
        continue;
      }
      outcome.moved += changed.length;
      outcome.unchanged += stale.length;
      outcome.confirmedGroups += 1;
    } catch {
      outcome.unconfirmed += ids.length;
      outcome.failedGroups += 1;
      outcome.failureMessages.push("Could not reach the server");
    }
  }

  if (outcome.unconfirmed === 0) {
    effects.toast(outcome.unchanged === 0
      ? `${outcome.moved} moved`
      : `${outcome.moved} moved · ${outcome.unchanged} unchanged, someone else had already moved them`);
    effects.onDone();
    effects.refresh();
    return outcome;
  }

  const confirmedAnyGroup = outcome.confirmedGroups > 0;
  const confirmedSummary = [
    ...(outcome.moved > 0 ? [`${outcome.moved} moved`] : []),
    ...(outcome.unchanged > 0 ? [`${outcome.unchanged} unchanged`] : []),
  ];
  if (confirmedAnyGroup) {
    effects.toast(
      `${confirmedSummary.join(" · ")} · ${outcome.unconfirmed} could not be confirmed. The list was refreshed; reselect anything still pending and retry.`,
      { kind: "error" },
    );
    effects.onDone();
    effects.refresh();
  } else {
    const reason = outcome.failureMessages[0] ?? "That did not go through";
    effects.toast(
      `${outcome.unconfirmed} could not be confirmed. ${reason}. Keep this selection and retry; already-applied transitions are safe to retry.`,
      { kind: "error" },
    );
  }
  return outcome;
}

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
      await completeBulkDecision({
        eventId,
        selected,
        to,
        effects: { toast, onDone, refresh: () => router.refresh() },
      });
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
