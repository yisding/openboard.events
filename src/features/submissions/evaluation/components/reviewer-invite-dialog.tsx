"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, Field } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { evaluationRequest } from "./evaluation-request";

/**
 * Adding a reviewer to the event.
 *
 * The account this creates is an ordinary admin-auth user with the lowest role,
 * so the invited person signs in at the same place organizers do and reaches
 * their review queue and nothing else. The initial password is set here and
 * shared out of band on purpose: the outbox stores a rendered body, and a body
 * containing a working password outlives the sign-in it was for.
 */
export function ReviewerInviteDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    try {
      const result = await evaluationRequest<{ email: string; createdUser: boolean }>(`/api/internal/evaluation/${eventId}/reviewers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password, role: "reviewer" }),
      }, "That reviewer was not added");
      if (!result.ok) {
        toast(result.message, { kind: "error" });
        return;
      }
      toast(result.data.createdUser
        ? `${result.data.email} can now sign in as a reviewer — send them the password you set`
        : `${result.data.email} already had an account and is now on this event`);
      onClose();
      router.refresh();
    } catch {
      toast("That reviewer was not added — check your connection and try again", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="Invite a reviewer">
      <div className="form-stack">
        <Field label="Email" required>
          <input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="reviewer@example.com" />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ada Lovelace" />
        </Field>
        <Field label="Initial password" required hint="At least 12 characters. Share it with them directly — it is never emailed.">
          <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </Field>
        <p className="portal-note">
          Reviewers get the lowest role on this event: their queue and the proposals assigned to them, and no organizer settings.
          An address that already has an account keeps its existing password and role.
        </p>
      </div>

      <div className="drawer-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || email.trim() === "" || password.length < 12} onClick={invite}>
          {busy ? "Adding…" : "Add reviewer"}
        </Button>
      </div>
    </Drawer>
  );
}
