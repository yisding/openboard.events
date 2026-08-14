"use client";

import { useState, type ReactNode } from "react";
import { Button, Modal } from "@/shared/ui/ui-kit";

/**
 * Every destructive action goes through here. Two variants:
 *
 * - `destructive` (default) — the confirm button is danger-styled.
 * - `stale` — what a 409 renders. Somebody else changed the row while this user
 *   was looking at it, so the only honest options are "reload" and "cancel";
 *   there is no "force" button, because the user cannot see what they would be
 *   overwriting.
 *
 * ```tsx
 * <ConfirmDialog
 *   open={pendingDelete !== null}
 *   title="Delete this session?"
 *   body="Speakers assigned to it keep their other sessions."
 *   confirmLabel="Delete session"
 *   onConfirm={async () => { await remove(pendingDelete); setPendingDelete(null); }}
 *   onCancel={() => setPendingDelete(null)}
 * />
 * ```
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "destructive",
  confirmDisabled = false,
  cancelDisabled = false,
  wide = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "stale" | "primary";
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  wide?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy || cancelDisabled ? () => undefined : onCancel}
      title={title}
      wide={wide}
      dismissible={!busy && !cancelDisabled}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy || cancelDisabled}>{cancelLabel}</Button>
          <Button variant={variant === "destructive" ? "danger" : "primary"} onClick={confirm} disabled={busy || confirmDisabled}>
            {busy ? "Working…" : confirmLabel ?? (variant === "stale" ? "Reload" : "Confirm")}
          </Button>
        </>
      }
    >
      <div className="long-copy">{body}</div>
    </Modal>
  );
}
