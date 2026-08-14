"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BULK_REMINDER_TARGET_LIMIT,
  bulkReminderResultSchema,
  type BulkReminderResult,
  type BulkReminderTarget,
  type EventId,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import {
  bulkReminderRecoveryStorage,
  bulkReminderRecoveryStorageKey,
  bulkReminderRecoveryLockManager,
  bulkReminderRecoverySchema,
  bulkReminderTargetSetFingerprint,
  bulkReminderResultMessage,
  clearBulkReminderRecovery,
  createBulkReminderRecovery,
  loadBulkReminderRecovery,
  persistBulkReminderRecovery,
  withBulkReminderResolution,
  withBulkReminderRecoveryLock,
  type BulkReminderRecovery,
  type BulkReminderSurface,
} from "../bulk-reminder-recovery";

// One id per loaded browser document: stable across React remounts, different
// in another/duplicated tab, and intentionally renewed on a full reload where
// the table's in-memory selection is also renewed.
const bulkReminderDocumentId = crypto.randomUUID();

export type BulkReminderRecoveryController = {
  blocked: boolean;
  confirmedButUnsynced: boolean;
  recovery: BulkReminderRecovery | null;
  sending: boolean;
  unreadable: boolean;
  start: (targets: readonly BulkReminderTarget[]) => Promise<boolean>;
  retry: () => Promise<void>;
  finishCleanup: () => void | Promise<void>;
  clearUnreadable: () => void;
};

function isUnknownOutcome(caught: unknown): boolean {
  return !isAppError(caught) || caught.code === "INTERNAL";
}

function sameUnresolvedAttempt(left: BulkReminderRecovery, right: BulkReminderRecovery): boolean {
  return !left.resolution
    && !right.resolution
    && left.eventId === right.eventId
    && left.attemptId === right.attemptId
    && left.originId === right.originId
    && left.surface === right.surface
    && left.targetFingerprint === right.targetFingerprint
    && JSON.stringify(left.targets) === JSON.stringify(right.targets);
}

export function useBulkReminderRecovery({
  eventId,
  surface,
  onAcknowledged,
  originId = bulkReminderDocumentId,
  getSelectionFingerprint,
}: {
  eventId: EventId;
  surface: BulkReminderSurface;
  onAcknowledged: (result: BulkReminderResult) => void;
  /** Stable selection owner; production defaults to this loaded document. */
  originId?: string;
  /** Exact target set currently represented by this surface's selection. */
  getSelectionFingerprint?: () => string | null;
}): BulkReminderRecoveryController {
  const { toast } = useToast();
  const acknowledgedRef = useRef(onAcknowledged);
  const selectionFingerprintRef = useRef(getSelectionFingerprint);
  acknowledgedRef.current = onAcknowledged;
  selectionFingerprintRef.current = getSelectionFingerprint;
  const startedTargetFingerprintRef = useRef<string | null>(null);
  const [recovery, setRecovery] = useState<BulkReminderRecovery | null>(null);
  const recoveryRef = useRef<BulkReminderRecovery | null>(null);
  const [sending, setSending] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [confirmedButUnsynced, setConfirmedButUnsynced] = useState(false);
  useUnsavedWorkGuard(recovery !== null, { blocking: true });

  const ownsOriginatingSelection = useCallback((value: BulkReminderRecovery) => (
    value.originId === originId
    && value.surface === surface
    && value.targetFingerprint !== undefined
    && value.targetFingerprint === bulkReminderTargetSetFingerprint(value.targets)
    && value.targetFingerprint === (selectionFingerprintRef.current
      ? selectionFingerprintRef.current()
      : startedTargetFingerprintRef.current)
  ), [originId, surface]);

  const ownsResolvedSelection = useCallback((value: BulkReminderRecovery, result: BulkReminderResult) => (
    ownsOriginatingSelection(value)
    && value.targetFingerprint === bulkReminderTargetSetFingerprint(result.results)
  ), [ownsOriginatingSelection]);

  const updateRecovery = useCallback((next: BulkReminderRecovery | null) => {
    recoveryRef.current = next;
    setRecovery(next);
  }, []);

  const adoptRecovery = useCallback((next: BulkReminderRecovery) => {
    setConfirmedButUnsynced(false);
    setUnreadable(false);
    updateRecovery(next);
  }, [updateRecovery]);

  const refreshStored = useCallback(() => {
    const storage = bulkReminderRecoveryStorage();
    if (!storage) return;
    const loaded = loadBulkReminderRecovery(storage, eventId);
    if (loaded.ok
      && !selectionFingerprintRef.current
      && loaded.recovery.originId === originId
      && loaded.recovery.surface === surface) {
      startedTargetFingerprintRef.current = loaded.recovery.targetFingerprint ?? null;
    }
    updateRecovery(loaded.ok ? loaded.recovery : null);
    setUnreadable(!loaded.ok && loaded.reason === "unreadable");
  }, [eventId, originId, surface, updateRecovery]);

  useEffect(() => {
    refreshStored();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const current = recoveryRef.current;
      if (event.newValue === null && current) {
        if (!current.resolution) {
          // Deletion by itself is not an acknowledgement. Restore the frozen
          // attempt so a devtools/manual clear or a racing tab cannot silently
          // unlock a selection whose server outcome is still unknown.
          const storage = bulkReminderRecoveryStorage();
          if (storage) {
            const latest = loadBulkReminderRecovery(storage, eventId);
            if (latest.ok) {
              adoptRecovery(latest.recovery);
              return;
            }
            persistBulkReminderRecovery(storage, current);
          }
          toast("Saved reminder recovery was removed before its outcome was confirmed. Retry the exact batch to continue.", { kind: "error" });
          return;
        }
        if (current.resolution.kind === "result") {
          const summary = bulkReminderResultMessage(current.resolution.result);
          if (ownsResolvedSelection(current, current.resolution.result)) acknowledgedRef.current(current.resolution.result);
          toast(summary.message, summary.kind ? { kind: summary.kind } : undefined);
        } else {
          toast(current.resolution.message, { kind: "error" });
        }
        // A later attempt may already occupy the event-wide marker by the
        // time this queued removal event reaches us. Re-read after applying
        // this outcome so that newer authority remains blocked and visible.
        refreshStored();
        return;
      }
      if (event.newValue !== null) {
        try {
          const parsed = bulkReminderRecoverySchema.safeParse(JSON.parse(event.newValue));
          if (parsed.success && parsed.data.eventId === eventId) {
            // Storage events can be delivered late. If another tab has
            // already completed this generation and installed a newer one,
            // the current stored marker wins over the stale event payload.
            const storage = bulkReminderRecoveryStorage();
            const latest = storage ? loadBulkReminderRecovery(storage, eventId) : null;
            if (latest?.ok && JSON.stringify(latest.recovery) !== JSON.stringify(parsed.data)) {
              adoptRecovery(latest.recovery);
              return;
            }
            if (latest && !latest.ok && latest.reason === "unreadable") {
              refreshStored();
              return;
            }
            adoptRecovery(parsed.data);
            return;
          }
        } catch {
          // Fall through to the authoritative current storage value.
        }
      }
      refreshStored();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adoptRecovery, eventId, ownsResolvedSelection, refreshStored, toast, updateRecovery]);

  const complete = useCallback((resolved: BulkReminderRecovery) => {
    const storage = bulkReminderRecoveryStorage();
    if (!storage || !clearBulkReminderRecovery(storage, resolved)) {
      updateRecovery(resolved);
      toast("The reminder result is confirmed, but browser recovery cleanup is blocked. Finish cleanup to continue.", { kind: "error" });
      return false;
    }
    if (resolved.resolution?.kind === "result") {
      const summary = bulkReminderResultMessage(resolved.resolution.result);
      toast(summary.message, summary.kind ? { kind: summary.kind } : undefined);
      if (ownsResolvedSelection(resolved, resolved.resolution.result)) acknowledgedRef.current(resolved.resolution.result);
    } else if (resolved.resolution?.kind === "error") {
      toast(resolved.resolution.message, { kind: "error" });
    }
    setConfirmedButUnsynced(false);
    updateRecovery(null);
    return true;
  }, [ownsResolvedSelection, toast, updateRecovery]);

  const persistConfirmed = useCallback((
    attempt: BulkReminderRecovery,
    resolved: BulkReminderRecovery,
  ): boolean => {
    const storage = bulkReminderRecoveryStorage();
    if (storage && persistBulkReminderRecovery(storage, resolved)) {
      setConfirmedButUnsynced(false);
      updateRecovery(resolved);
      return true;
    }
    // `setItem` is atomic: quota/security failures leave the smaller
    // unresolved marker intact. Never clear it merely because a server
    // response arrived; it is the durable proof that Retry must reuse this
    // exact attempt id and target set.
    setConfirmedButUnsynced(true);
    updateRecovery(attempt);
    toast("The reminder outcome was confirmed, but browser recovery could not save it. Check this exact attempt again; no new attempt can start.", { kind: "error" });
    return false;
  }, [toast, updateRecovery]);

  const send = useCallback(async (attempt: BulkReminderRecovery): Promise<boolean> => {
    if (attempt.resolution) return complete(attempt);
    setSending(true);
    try {
      const result = await api(
        `deliverables/remind?eventId=${encodeURIComponent(eventId)}`,
        bulkReminderResultSchema,
        { method: "POST", body: { targets: attempt.targets, attemptId: attempt.attemptId } },
      );
      const resolved = withBulkReminderResolution(attempt, { kind: "result", result });
      if (!persistConfirmed(attempt, resolved)) return false;
      return complete(resolved);
    } catch (caught) {
      if (isUnknownOutcome(caught)) {
        updateRecovery(attempt);
        toast("Could not confirm which reminders were queued. Retry the exact batch to recover its current status.", { kind: "error" });
        return false;
      }
      const message = isAppError(caught) ? caught.message : "Could not queue reminders";
      const resolved = withBulkReminderResolution(attempt, { kind: "error", message: message.slice(0, 500) });
      if (!persistConfirmed(attempt, resolved)) return false;
      return complete(resolved);
    } finally {
      setSending(false);
    }
  }, [complete, eventId, persistConfirmed, toast, updateRecovery]);

  const start = useCallback(async (targets: readonly BulkReminderTarget[]): Promise<boolean> => {
    if (targets.length > BULK_REMINDER_TARGET_LIMIT) {
      toast(`Send reminders to up to ${BULK_REMINDER_TARGET_LIMIT} assignments at a time. Your selection is still available.`, { kind: "error" });
      return false;
    }
    const locked = await withBulkReminderRecoveryLock(eventId, bulkReminderRecoveryLockManager(), async () => {
      const storage = bulkReminderRecoveryStorage();
      if (!storage) {
        toast("Could not prepare a safe reminder retry. No reminders were sent.", { kind: "error" });
        return false;
      }
      const loaded = loadBulkReminderRecovery(storage, eventId);
      if (loaded.ok) {
        adoptRecovery(loaded.recovery);
        toast("Finish the saved reminder attempt before starting another.", { kind: "error" });
        return false;
      }
      if (loaded.reason === "unreadable") {
        setUnreadable(true);
        toast("Saved reminder recovery is unreadable. No reminders were sent.", { kind: "error" });
        return false;
      }
      let attempt: BulkReminderRecovery;
      try {
        attempt = createBulkReminderRecovery(eventId, surface, targets, originId);
      } catch {
        toast("Could not prepare that reminder selection. No reminders were sent.", { kind: "error" });
        return false;
      }
      if (!persistBulkReminderRecovery(storage, attempt)) {
        refreshStored();
        toast("Could not prepare a safe reminder retry. No reminders were sent.", { kind: "error" });
        return false;
      }
      startedTargetFingerprintRef.current = attempt.targetFingerprint ?? null;
      updateRecovery(attempt);
      return send(attempt);
    });
    if (!locked.ok) {
      refreshStored();
      toast(locked.reason === "busy"
        ? "Another reminder attempt is already active in this browser."
        : "Could not acquire safe reminder recovery. No reminders were sent.", { kind: "error" });
      return false;
    }
    return locked.value;
  }, [adoptRecovery, eventId, originId, refreshStored, send, surface, toast, updateRecovery]);

  const retry = useCallback(async () => {
    if (!recovery || sending) return;
    const locked = await withBulkReminderRecoveryLock(eventId, bulkReminderRecoveryLockManager(), async () => {
      const storage = bulkReminderRecoveryStorage();
      if (!storage) {
        toast("Could not read safe reminder recovery. The saved attempt stays locked and no reminder was sent.", { kind: "error" });
        return;
      }
      const loaded = loadBulkReminderRecovery(storage, eventId);
      if (!loaded.ok) {
        if (loaded.reason === "unreadable") {
          setUnreadable(true);
          toast("Saved reminder recovery is unreadable. No reminder was sent.", { kind: "error" });
          return;
        }
        // Missing is not success: preserve the prior unexplained-deletion
        // rule, restore the exact frozen attempt, and require a fresh click.
        if (!persistBulkReminderRecovery(storage, recovery)) {
          toast("Saved reminder recovery is missing and could not be restored. No reminder was sent.", { kind: "error" });
          return;
        }
        adoptRecovery(recovery);
        toast("Saved reminder recovery was missing, so the exact attempt was restored. Retry again to check its status.", { kind: "error" });
        return;
      }
      const authoritative = loaded.recovery;
      if (!sameUnresolvedAttempt(recovery, authoritative)) {
        adoptRecovery(authoritative);
        if (authoritative.resolution) {
          complete(authoritative);
        } else {
          toast("Another reminder attempt is now authoritative. Its exact targets remain locked for safe recovery.", { kind: "error" });
        }
        return;
      }
      adoptRecovery(authoritative);
      await send(authoritative);
    });
    if (!locked.ok) {
      refreshStored();
      toast(locked.reason === "busy"
        ? "That exact reminder attempt is already being checked in another tab."
        : "Could not acquire safe reminder recovery. Retry was not started.", { kind: "error" });
    }
  }, [adoptRecovery, complete, eventId, recovery, refreshStored, send, sending, toast]);

  const finishCleanup = useCallback(async () => {
    if (!recovery?.resolution) return;
    const locked = await withBulkReminderRecoveryLock(eventId, bulkReminderRecoveryLockManager(), async () => complete(recovery));
    if (!locked.ok) toast("Could not acquire safe reminder recovery cleanup.", { kind: "error" });
  }, [complete, eventId, recovery, toast]);

  const clearUnreadable = useCallback(() => {
    const storage = bulkReminderRecoveryStorage();
    if (!storage) {
      toast("Browser recovery storage is unavailable.", { kind: "error" });
      return;
    }
    try {
      const current = loadBulkReminderRecovery(storage, eventId);
      if (current.ok) {
        updateRecovery(current.recovery);
        setUnreadable(false);
        return;
      }
      storage.removeItem(bulkReminderRecoveryStorageKey(eventId));
      const loaded = loadBulkReminderRecovery(storage, eventId);
      if (!loaded.ok && loaded.reason === "missing") {
        setUnreadable(false);
        return;
      }
    } catch {
      // Fall through to the truthful error below.
    }
    toast("Could not clear saved reminder recovery.", { kind: "error" });
  }, [eventId, toast, updateRecovery]);

  return {
    blocked: recovery !== null || unreadable,
    confirmedButUnsynced,
    recovery,
    sending,
    unreadable,
    start,
    retry,
    finishCleanup,
    clearUnreadable,
  };
}

export function BulkReminderRecoveryDialog({ controller }: { controller: BulkReminderRecoveryController }) {
  const { confirmedButUnsynced, recovery, sending, unreadable } = controller;
  if (unreadable) {
    return (
      <div className="notify-bar" role="alert">
        <p>
          <b>Saved reminder recovery needs attention</b>
          <small>Check Communications before clearing this unreadable record. New reminder batches stay blocked meanwhile.</small>
        </p>
        <Button size="sm" variant="secondary" onClick={controller.clearUnreadable}>Clear after checking</Button>
      </div>
    );
  }
  const resolved = recovery?.resolution;
  return (
    <ConfirmDialog
      open={recovery !== null}
      variant="primary"
      title={resolved
        ? "Reminder result confirmed"
        : confirmedButUnsynced ? "Reminder result needs browser sync" : sending ? "Sending reminders…" : "Reminder outcome unconfirmed"}
      body={resolved
        ? "The server result is saved. Finish browser cleanup to acknowledge it and continue."
        : confirmedButUnsynced
          ? "The server confirmed this exact batch, but browser recovery could not save the result. Check reminder status safely reuses the same attempt and cannot create a new batch."
          : `This exact ${recovery?.targets.length ?? 0}-assignment batch is saved. Retry reminders safely checks every target and fills only reminders that did not commit.`}
      confirmLabel={resolved ? "Finish cleanup" : confirmedButUnsynced ? "Check reminder status" : "Retry reminders"}
      confirmDisabled={sending}
      cancelDisabled
      onConfirm={resolved ? controller.finishCleanup : controller.retry}
      onCancel={() => undefined}
    />
  );
}
