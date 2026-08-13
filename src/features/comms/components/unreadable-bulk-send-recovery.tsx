"use client";

import { useState } from "react";
import {
  browserBulkSendRecoveryLockManager,
  removeUnreadableBulkSendRecovery,
  withBulkSendRecoveryLock,
  type BulkSendRecoveryIdentity,
} from "../bulk-send-recovery";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

export function UnreadableBulkSendRecovery({
  identity,
  onCleared,
}: {
  identity: BulkSendRecoveryIdentity;
  onCleared: () => void;
}) {
  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);

  async function clearUnreadableRecovery() {
    const locked = await withBulkSendRecoveryLock(
      identity,
      browserBulkSendRecoveryLockManager(),
      () => removeUnreadableBulkSendRecovery(window.localStorage, identity),
    );
    setConfirmClear(false);
    if (!locked.ok) {
      toast(locked.reason === "lock_busy"
        ? "Another tab is using this email recovery. Finish there before clearing it."
        : "This browser can’t safely coordinate recovery cleanup across tabs. Try a current browser or check its privacy settings.", { kind: "error" });
      return;
    }
    const removed = locked.value;
    if (removed.ok) {
      onCleared();
      toast("Unreadable email recovery cleared");
      return;
    }
    if (removed.reason === "recovery_readable") {
      toast("This recovery became readable in another tab. Reload before deciding what to do.", { kind: "error" });
      return;
    }
    toast("The unreadable recovery could not be cleared. Check your browser storage settings and try again.", { kind: "error" });
  }

  return <>
    <div className="notify-bar" role="alert">
      <div><p>
        <b>Saved email recovery can’t be read</b>
        <small>An older or damaged browser record is blocking new bulk email. Clear it explicitly to start a new send.</small>
      </p></div>
      <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)}>Clear unreadable recovery</Button>
    </div>
    <ConfirmDialog
      open={confirmClear}
      variant="destructive"
      title="Clear unreadable email recovery?"
      body="The saved send details cannot be restored. Clearing this browser record unlocks new bulk email, but you will not be able to recover its recipient list or outcome here. Check the communications log first if you are unsure."
      confirmLabel="Clear recovery"
      onConfirm={clearUnreadableRecovery}
      onCancel={() => setConfirmClear(false)}
    />
  </>;
}
