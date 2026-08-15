"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/ui-kit";

/**
 * The speaker's half of `POST .../withdraw`. Offered only where the server can
 * honour it — the submitter, on a proposal that has not been decided against or
 * already withdrawn — because the endpoint answers "somebody else's row" and
 * "not withdrawable" with the same bare NOT_FOUND.
 */
export function WithdrawSubmissionButton({ eventId, submissionId, title }: {
  eventId: string;
  submissionId: string;
  title: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  // A draft can reach the portal with no title yet, and quoting one produces a
  // pair of empty curly quotes where the proposal's name should be. Name the
  // thing generically instead of quoting nothing.
  const quotedTitle = title.trim();

  async function withdraw() {
    const response = await fetch(
      `/api/internal/submissions/${encodeURIComponent(eventId)}/${encodeURIComponent(submissionId)}/withdraw`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ).catch(() => null);
    if (!response) {
      toast("That did not reach us — check your connection and try again", { kind: "error" });
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      toast(payload?.error?.message ?? "That did not go through", { kind: "error" });
      return;
    }
    setConfirming(false);
    toast("Submission withdrawn");
    router.refresh();
  }

  return <>
    <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Withdraw submission</Button>
    <ConfirmDialog
      open={confirming}
      title="Withdraw this submission?"
      body={<>{quotedTitle ? <>“{quotedTitle}”</> : "This proposal"} leaves the organizers’ review queue. You can’t undo this from the portal — ask the organizers if you change your mind.</>}
      confirmLabel="Withdraw submission"
      onConfirm={withdraw}
      onCancel={() => setConfirming(false)}
    />
  </>;
}
