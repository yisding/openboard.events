"use client";

import { useState } from "react";
import {
  removeUnreadableBulkSendRecovery,
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

  function clearUnreadableRecovery() {
    const removed = removeUnreadableBulkSendRecovery(window.sessionStorage, identity);
    setConfirmClear(false);
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
