"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import type { NotifyPreview } from "@/features/submissions";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { emitTourSignal } from "@/shared/ui/app/guided-tour/signals";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { STATUS_BADGES, type StatusBadgeValue } from "@/shared/ui/status-badge";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { MessagePreview } from "@/features/comms/index.client";

type DecisionSelection = Pick<SubmissionListRow, "submissionId" | "status">;
type DecisionTransitionRequest = (url: string, init: RequestInit) => Promise<Response>;

export type BulkDecisionOutcome = {
  moved: number;
  /**
   * The ids the server confirmed it moved, so the list on screen can show the
   * new status without waiting for a reload. `moved` is their count; the ids
   * themselves are what the table folds.
   */
  changedIds: string[];
  unchanged: number;
  /** Published sessions these moves removed from the public schedule. */
  unpublished: number;
  rejected: number;
  unconfirmed: number;
  confirmedGroups: number;
  rejectedGroups: number;
  unconfirmedGroups: number;
  rejectionMessages: string[];
  unconfirmedMessages: string[];
};

type TransitionErrorPayload = {
  code?: string;
  message?: string;
  data?: { from?: unknown; to?: unknown };
};

/**
 * What the organizer reads when the server refuses a move. `STALE_STATUS`
 * describes the refused edge with the column's own values (`decline_queue`),
 * which is not a word this screen uses anywhere else — so the pair is
 * re-rendered in the same vocabulary the rows' badges carry.
 */
export function transitionRejectionMessage(error: TransitionErrorPayload | undefined, status: number): string {
  const from = error?.data?.from;
  const to = error?.data?.to;
  if (error?.code === "STALE_STATUS" && typeof from === "string" && typeof to === "string") {
    const label = (value: string) => STATUS_BADGES[value as StatusBadgeValue]?.label ?? value.replace(/_/g, " ");
    return `A submission cannot go from “${label(from)}” to “${label(to)}”`;
  }
  return error?.message ?? `Transition rejected (${status})`;
}

type BulkDecisionEffects = {
  onDone: () => void;
  refresh: () => void;
  toast: (message: string, options?: { kind?: "error" }) => void;
};

/**
 * Apply one guarded transition per observed status and reconcile every group.
 *
 * Deterministic client errors are rejections: the server declined them before
 * updating, so their reason must survive and retrying the same action is not
 * useful. A network, retryable-client, server, or malformed-response failure is
 * instead "unconfirmed": the server may have committed before the response was
 * lost. Retrying those rows is safe because the retry carries the same expected
 * status and therefore cannot overwrite a concurrent decision. Continuing
 * through the remaining independent groups gives the organizer one complete
 * outcome instead of hiding everything after the first failure.
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
    changedIds: [],
    unchanged: selected.filter((row) => row.status === to).length,
    unpublished: 0,
    rejected: 0,
    unconfirmed: 0,
    confirmedGroups: 0,
    rejectedGroups: 0,
    unconfirmedGroups: 0,
    rejectionMessages: [],
    unconfirmedMessages: [],
  };

  for (const [observed, ids] of byObserved) {
    try {
      const response = await request(`/api/internal/submissions/${eventId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, to, expectedFrom: observed }),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { changed?: unknown; stale?: unknown; unpublished?: unknown };
        error?: TransitionErrorPayload;
      } | null;
      const changed = payload?.data?.changed;
      const stale = payload?.data?.stale;
      const unpublished = payload?.data?.unpublished;
      // 408, 425, and 429 explicitly invite a later retry. Other 4xx statuses
      // deterministically reject this request, notably assertTransition's 409
      // for an invalid source -> target pair.
      const deterministicRejection = response.status >= 400
        && response.status < 500
        && ![408, 425, 429].includes(response.status);
      if (deterministicRejection) {
        outcome.rejected += ids.length;
        outcome.rejectedGroups += 1;
        outcome.rejectionMessages.push(transitionRejectionMessage(payload?.error, response.status));
        continue;
      }
      if (!response.ok || !Array.isArray(changed) || !Array.isArray(stale)) {
        outcome.unconfirmed += ids.length;
        outcome.unconfirmedGroups += 1;
        outcome.unconfirmedMessages.push(payload?.error?.message ?? "That transition returned an invalid response");
        continue;
      }
      outcome.moved += changed.length;
      outcome.changedIds.push(...changed.filter((id): id is string => typeof id === "string"));
      outcome.unchanged += stale.length;
      outcome.unpublished += typeof unpublished === "number" ? unpublished : 0;
      outcome.confirmedGroups += 1;
    } catch {
      outcome.unconfirmed += ids.length;
      outcome.unconfirmedGroups += 1;
      outcome.unconfirmedMessages.push("Could not reach the server");
    }
  }

  // Reversing a decision on an already-published talk removes it and its
  // speaker from the public schedule. That is the one consequence of this bar
  // an organizer cannot see from the abstracts table, so it is said out loud.
  const unpublishedSummary = outcome.unpublished > 0
    ? `${outcome.unpublished} published ${outcome.unpublished === 1 ? "session" : "sessions"} removed from the public schedule`
    : null;

  if (outcome.rejected === 0 && outcome.unconfirmed === 0) {
    effects.toast([
      `${outcome.moved} moved`,
      unpublishedSummary,
      outcome.unchanged === 0 ? null : `${outcome.unchanged} unchanged, someone else had already moved them`,
    ].filter(Boolean).join(" · "));
    effects.onDone();
    effects.refresh();
    return outcome;
  }

  const confirmedAnyGroup = outcome.confirmedGroups > 0;
  const confirmedSummary = [
    ...(outcome.moved > 0 ? [`${outcome.moved} moved`] : []),
    ...(unpublishedSummary ? [unpublishedSummary] : []),
    ...(outcome.unchanged > 0 ? [`${outcome.unchanged} unchanged`] : []),
  ];
  const rejectionReasons = [...new Set(outcome.rejectionMessages)].join("; ");
  const rejectedSummary = outcome.rejected > 0
    ? `${outcome.rejected} rejected${rejectionReasons ? `: ${rejectionReasons}` : ""}`
    : null;
  const unconfirmedSummary = outcome.unconfirmed > 0
    ? `${outcome.unconfirmed} could not be confirmed`
    : null;
  if (confirmedAnyGroup) {
    const guidance = outcome.rejected > 0 && outcome.unconfirmed > 0
      ? "The list was refreshed; address the rejection separately, then reselect anything still pending and retry only the unconfirmed rows."
      : outcome.rejected > 0
        ? "The list was refreshed; address the rejection before acting on those rows."
        : "The list was refreshed; reselect anything still pending and retry.";
    effects.toast(
      `${[...confirmedSummary, rejectedSummary, unconfirmedSummary].filter(Boolean).join(" · ")}. ${guidance}`,
      { kind: "error" },
    );
    effects.onDone();
    effects.refresh();
  } else if (outcome.rejected > 0 && outcome.unconfirmed === 0) {
    effects.toast(
      `${rejectedSummary}. Address the rejection before acting on these selected rows.`,
      { kind: "error" },
    );
  } else if (outcome.rejected > 0) {
    effects.toast(
      `${rejectedSummary} · ${unconfirmedSummary}. Address the rejection separately; retry only the unconfirmed rows because already-applied transitions are safe to retry.`,
      { kind: "error" },
    );
  } else {
    const reason = outcome.unconfirmedMessages[0] ?? "That did not go through";
    effects.toast(
      `${outcome.unconfirmed} could not be confirmed. ${reason}. Keep this selection and retry; already-applied transitions are safe to retry.`,
      { kind: "error" },
    );
  }
  return outcome;
}

/**
 * Bulk decisions. Queueing and notifying are deliberately two actions: an
 * organizer builds a queue over a morning and sends once, and an email send that
 * fired on every click would mail speakers a decision the team was still
 * arguing about.
 */
export function DecisionBar({
  eventId,
  selected,
  pendingNotify,
  countLabel,
  allMatching = false,
  selectAllMatching,
  onMoved,
  onDone,
}: {
  eventId: string;
  selected: SubmissionListRow[];
  pendingNotify: number;
  countLabel?: ReactNode;
  allMatching?: boolean;
  selectAllMatching?: { count: number; busy: boolean; request: () => void };
  /**
   * The ids the server confirmed it moved. The list folds them so the rows and
   * the workflow counts agree with the toast immediately, instead of repeating
   * pre-decision statuses until the organizer reloads.
   */
  onMoved?: (changedIds: string[], to: SubmissionStatus) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmingNotify, setConfirmingNotify] = useState(false);
  const [preview, setPreview] = useState<NotifyPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);

  async function openNotifyPreflight() {
    if (busy || previewing) return;
    setConfirmingNotify(true);
    setPreview(null);
    setPreviewError("");
    setPreviewing(true);
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}/notify/preview`);
      const payload = await response.json().catch(() => null) as { data?: NotifyPreview; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        setPreviewError(payload?.error?.message ?? "Could not prepare this notification preview");
        return;
      }
      setPreview(payload.data);
    } catch {
      setPreviewError("Could not reach the server to prepare this preview");
    } finally {
      setPreviewing(false);
    }
  }

  async function move(to: SubmissionStatus) {
    setBusy(true);
    try {
      const outcome = await completeBulkDecision({
        eventId,
        selected,
        to,
        effects: { toast, onDone, refresh: () => router.refresh() },
      });
      // Before the next server snapshot arrives, and whether or not it ever
      // does: the rows the server said it moved read as moved now.
      onMoved?.(outcome.changedIds, to);
    } finally {
      setBusy(false);
    }
  }

  async function notify() {
    if (!preview) {
      setPreviewError("Review a fresh preview before queuing these emails.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueRevision: preview.queueRevision }),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { accepted: string[]; declined: string[]; emailsQueued: number; skippedNoRecipient: string[] };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Decision emails were not sent", { kind: "error" });
        setPreview(null);
        setPreviewError("The queue may have changed. Review a fresh preview before retrying.");
        return;
      }
      const { accepted, declined, emailsQueued, skippedNoRecipient } = payload.data;
      const decided = accepted.length + declined.length;
      toast(decided === 0
        ? "Nothing was queued to notify"
        : `${decided} decided · ${emailsQueued} email${emailsQueued === 1 ? "" : "s"} queued`
          + (skippedNoRecipient.length > 0 ? ` · ${skippedNoRecipient.length} had no recipient` : ""));
      // A latency shortcut for the guided tour and nothing more: it asks the
      // tour to look at the world now instead of on its next poll. Objectives
      // are still decided server-side, so deleting this line costs at most two
      // seconds and changes no outcome.
      emitTourSignal("submissions.decisions-notified");
      onDone();
      router.refresh();
      setConfirmingNotify(false);
      setPreview(null);
    } catch {
      toast("Could not reach the server. Check Communications before retrying this notification batch.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return <>
    <BulkActionBar
      count={selected.length}
      countLabel={<span {...(allMatching ? { role: "status", "aria-live": "polite" as const, "aria-atomic": true } : {})}>{countLabel}</span>}
      onClear={onDone}
      actions={<>
        {selectAllMatching && (
          <Button variant="secondary" disabled={busy || selectAllMatching.busy} onClick={selectAllMatching.request}>
            {selectAllMatching.busy ? `Selecting all ${selectAllMatching.count}…` : `Select all ${selectAllMatching.count} matching submissions`}
          </Button>
        )}
        {/* `data-tour`: the tour both points at this button and watches for it
            — the bar it lives in only exists while rows are ticked, which is
            what the step before this one is asking the organizer to do. An
            accessible name would answer the anchor but not the `via: "dom"`
            objective, which only ever looks at `data-tour`. */}
        <Button data-tour="abstracts.move-accept" variant="secondary" disabled={busy} onClick={() => move("accept_queue")}>Move to accept queue</Button>
        <Button variant="secondary" disabled={busy} onClick={() => move("decline_queue")}>Move to decline queue</Button>
      </>}
      {...(pendingNotify > 0 ? { emptyNote: <span>{pendingNotify} decision email{pendingNotify === 1 ? " is" : "s are"} ready to send</span> } : {})}
      {...(pendingNotify > 0 ? {
        // `data-tour`: three sibling `Button`s live in this bar and the label
        // carries a count, so neither a selector nor an accessible name can
        // address this one on its own.
        trailing: <Button data-tour="abstracts.decision-notify" disabled={busy || previewing} onClick={() => void openNotifyPreflight()}>{busy ? "Queuing…" : previewing ? "Preparing…" : `Send ${pendingNotify} decision email${pendingNotify === 1 ? "" : "s"}`}</Button>,
      } : {})}
    />
    <ConfirmDialog
      open={confirmingNotify}
      title="Review decision emails"
      body={<DecisionEmailPreflight
        preview={preview}
        error={previewError}
        loading={previewing}
        onRetry={() => void openNotifyPreflight()}
      />}
      confirmLabel="Queue decision emails"
      variant="destructive"
      confirmDisabled={!preview || previewing || Boolean(previewError)}
      wide
      onConfirm={notify}
      onCancel={() => { setConfirmingNotify(false); setPreview(null); setPreviewError(""); }}
    />
  </>;
}

export function DecisionEmailPreflight({
  preview,
  error,
  loading,
  onRetry,
}: {
  preview: NotifyPreview | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) return <p role="status">Preparing the exact queue counts and sample messages…</p>;
  if (error) return <LoadFailure message={error} onRetry={onRetry} />;
  if (!preview) return <p role="status">A fresh preview is required before these emails can be queued.</p>;
  const total = preview.accepted + preview.declined;
  return <div className="form-stack decision-email-preflight">
    <p><b>{total} queued decision{total === 1 ? "" : "s"}</b> · {preview.accepted} accepted · {preview.declined} declined · {preview.emailsQueued} email{preview.emailsQueued === 1 ? "" : "s"}</p>
    {preview.skippedNoRecipient > 0 && <p className="portal-note" role="alert">{preview.skippedNoRecipient} submission{preview.skippedNoRecipient === 1 ? " has" : "s have"} no recipient and will be finalized without email.</p>}
    {/* Re-deciding after a notification is legitimate and deliberately sends a
        new email; the organizer correcting a mis-decision still has to know
        the speaker is being told twice before they press send. */}
    {preview.alreadyNotified > 0 && <p className="portal-note" role="alert">
      {preview.alreadyNotified} queued submission{preview.alreadyNotified === 1 ? " has" : "s have"} already had a decision email sent —
      queuing now emails {preview.alreadyNotified === 1 ? "that speaker" : "those speakers"} a second time.
    </p>}
    {preview.samples.map((sample) => <section key={sample.decision}>
      <p><b>{sample.decision === "accepted" ? "Acceptance" : "Decline"} sample</b> · {sample.recipientName} ({sample.recipientEmail}) · {sample.submissionTitle}</p>
      {!sample.templateEnabled && <p className="portal-note" role="alert">This template is paused, so its messages will be skipped until it is enabled.</p>}
      <MessagePreview label={sample.decision.toUpperCase()} hint="Current template · sample recipient" message={{ subject: sample.subject, bodyHtml: sample.bodyHtml, bodyText: sample.bodyText }} />
    </section>)}
    <p className="portal-note">Links shown in samples are placeholders. Sending creates a fresh private link for each recipient.</p>
  </div>;
}
