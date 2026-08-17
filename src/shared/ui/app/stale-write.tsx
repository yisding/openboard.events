"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui/ui-kit";

/**
 * What a 409 looks like, everywhere.
 *
 * A stale write is not an error the writer made and not one they can fix by
 * pressing Save again — somebody else changed the row while they were looking
 * at it. The only honest options are "keep what I typed" and "replace it with
 * what is saved", and the second one destroys work, so it is never taken
 * without asking. That makes the surface two pieces, always in this order:
 *
 * 1. this notice — announced (`role="alert"`) and focused, because the writer
 *    has already looked away from the button they pressed;
 * 2. a `<ConfirmDialog variant="stale">`, opened by "Load latest", built from
 *    {@link staleWriteConfirm} so the question reads the same on every screen.
 *
 * The dialog stays with the caller rather than living in here: every editor
 * that needs it is itself inside a `<Modal>` or `<Drawer>`, and the confirm has
 * to render as that dialog's sibling, not nested inside it.
 *
 * ```tsx
 * {stale && <StaleWriteNotice subject="task" busy={loadingLatest} onLoadLatest={() => setConfirming(true)} />}
 * …
 * <ConfirmDialog open={confirming} {...staleWriteConfirm("task")} onConfirm={loadLatest} onCancel={() => setConfirming(false)} />
 * ```
 */
export function StaleWriteNotice({ subject, busy = false, onLoadLatest }: {
  /** The thing that changed, lower case and singular: "task", "event", "template". */
  subject: string;
  busy?: boolean;
  onLoadLatest: () => void;
}) {
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => noticeRef.current?.focus());
  }, []);

  return (
    <div ref={noticeRef} className="notify-bar" role="alert" tabIndex={-1}>
      <div>
        <p><b>This {subject} changed since you opened it.</b></p>
        <small>Your draft is still here. Load the latest {subject} only when you are ready to replace it.</small>
      </div>
      <Button variant="secondary" disabled={busy} onClick={onLoadLatest}>
        {busy ? "Loading…" : "Load latest"}
      </Button>
    </div>
  );
}

/** The confirm half of the pattern — spread onto a `<ConfirmDialog>`. */
export function staleWriteConfirm(subject: string) {
  return {
    title: `Load the latest ${subject}?`,
    body: `Your unsaved changes will be replaced by the latest saved version. This cannot be undone.`,
    confirmLabel: "Load latest",
    variant: "stale",
  } as const;
}
