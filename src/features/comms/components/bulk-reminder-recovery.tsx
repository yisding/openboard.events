"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
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

export type BulkReminderRecoveryController = {
  blocked: boolean;
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

export function useBulkReminderRecovery({
  eventId,
  surface,
  onAcknowledged,
}: {
  eventId: EventId;
  surface: BulkReminderSurface;
  onAcknowledged: (result: BulkReminderResult) => void;
}): BulkReminderRecoveryController {
  const { toast } = useToast();
  const acknowledgedRef = useRef(onAcknowledged);
  acknowledgedRef.current = onAcknowledged;
  const [recovery, setRecovery] = useState<BulkReminderRecovery | null>(null);
  const [sending, setSending] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  useUnsavedWorkGuard(recovery !== null, { blocking: true });

  const refreshStored = useCallback(() => {
    const storage = bulkReminderRecoveryStorage();
    if (!storage) return;
    const loaded = loadBulkReminderRecovery(storage, eventId);
    setRecovery(loaded.ok ? loaded.recovery : null);
    setUnreadable(!loaded.ok && loaded.reason === "unreadable");
  }, [eventId]);

  useEffect(() => {
    refreshStored();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) refreshStored();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [eventId, refreshStored]);

  const complete = useCallback((resolved: BulkReminderRecovery) => {
    const storage = bulkReminderRecoveryStorage();
    if (!storage || !clearBulkReminderRecovery(storage, resolved)) {
      setRecovery(resolved);
      toast("The reminder result is confirmed, but browser recovery cleanup is blocked. Finish cleanup to continue.", { kind: "error" });
      return false;
    }
    setRecovery(null);
    if (resolved.resolution?.kind === "result") {
      const summary = bulkReminderResultMessage(resolved.resolution.result);
      toast(summary.message, summary.kind ? { kind: summary.kind } : undefined);
      acknowledgedRef.current(resolved.resolution.result);
    } else if (resolved.resolution?.kind === "error") {
      toast(resolved.resolution.message, { kind: "error" });
    }
    return true;
  }, [toast]);

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
      const storage = bulkReminderRecoveryStorage();
      if (storage) persistBulkReminderRecovery(storage, resolved);
      setRecovery(resolved);
      return complete(resolved);
    } catch (caught) {
      if (isUnknownOutcome(caught)) {
        setRecovery(attempt);
        toast("Could not confirm which reminders were queued. Retry the exact batch to recover its current status.", { kind: "error" });
        return false;
      }
      const message = isAppError(caught) ? caught.message : "Could not queue reminders";
      const resolved = withBulkReminderResolution(attempt, { kind: "error", message: message.slice(0, 500) });
      const storage = bulkReminderRecoveryStorage();
      if (storage) persistBulkReminderRecovery(storage, resolved);
      setRecovery(resolved);
      return complete(resolved);
    } finally {
      setSending(false);
    }
  }, [complete, eventId, toast]);

  const start = useCallback(async (targets: readonly BulkReminderTarget[]): Promise<boolean> => {
    const locked = await withBulkReminderRecoveryLock(eventId, bulkReminderRecoveryLockManager(), async () => {
      const storage = bulkReminderRecoveryStorage();
      if (!storage) {
        toast("Could not prepare a safe reminder retry. No reminders were sent.", { kind: "error" });
        return false;
      }
      const loaded = loadBulkReminderRecovery(storage, eventId);
      if (loaded.ok) {
        setRecovery(loaded.recovery);
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
        attempt = createBulkReminderRecovery(eventId, surface, targets);
      } catch {
        toast("Could not prepare that reminder selection. No reminders were sent.", { kind: "error" });
        return false;
      }
      if (!persistBulkReminderRecovery(storage, attempt)) {
        refreshStored();
        toast("Could not prepare a safe reminder retry. No reminders were sent.", { kind: "error" });
        return false;
      }
      setRecovery(attempt);
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
  }, [eventId, refreshStored, send, surface, toast]);

  const retry = useCallback(async () => {
    if (!recovery || sending) return;
    const locked = await withBulkReminderRecoveryLock(eventId, bulkReminderRecoveryLockManager(), () => send(recovery));
    if (!locked.ok) {
      refreshStored();
      toast(locked.reason === "busy"
        ? "That exact reminder attempt is already being checked in another tab."
        : "Could not acquire safe reminder recovery. Retry was not started.", { kind: "error" });
    }
  }, [eventId, recovery, refreshStored, send, sending, toast]);

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
        setRecovery(current.recovery);
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
  }, [eventId, toast]);

  return {
    blocked: recovery !== null || unreadable,
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
  const { recovery, sending, unreadable } = controller;
  if (unreadable && !recovery) {
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
      title={resolved ? "Reminder result confirmed" : sending ? "Sending reminders…" : "Reminder outcome unconfirmed"}
      body={resolved
        ? "The server result is saved. Finish browser cleanup to acknowledge it and continue."
        : `This exact ${recovery?.targets.length ?? 0}-assignment batch is saved. Retry reminders safely checks every target and fills only reminders that did not commit.`}
      confirmLabel={resolved ? "Finish cleanup" : "Retry reminders"}
      confirmDisabled={sending}
      cancelDisabled
      onConfirm={resolved ? controller.finishCleanup : controller.retry}
      onCancel={() => undefined}
    />
  );
}
