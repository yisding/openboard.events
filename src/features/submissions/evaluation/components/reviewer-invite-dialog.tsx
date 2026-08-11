"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button, Drawer, Field } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { evaluationFailureMessage, evaluationRequest } from "./evaluation-request";

const reviewerEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

export function normalizeReviewerEmail(value: string): string | null {
  const parsed = reviewerEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function reviewerEmailValidationError(value: string): string | null {
  if (!value.trim()) return "Email is required";
  return normalizeReviewerEmail(value) ? null : "Enter a valid email address";
}

export function canAttemptReviewerInvite(email: string, password: string, busy: boolean): boolean {
  return !busy && email.trim() !== "" && password.length >= 12;
}

export function focusReviewerEmail(
  ref: { current: { focus: () => void } | null },
  schedule: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
) {
  schedule(() => ref.current?.focus());
}

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
  const [emailError, setEmailError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function invite() {
    const nextEmailError = reviewerEmailValidationError(email);
    const validEmail = normalizeReviewerEmail(email);
    if (nextEmailError || !validEmail) {
      setEmailError(nextEmailError ?? "Enter a valid email address");
      focusReviewerEmail(emailRef);
      return;
    }
    setEmailError("");
    setBusy(true);
    try {
      const result = await evaluationRequest<{ email: string; createdUser: boolean }>(`/api/internal/evaluation/${eventId}/reviewers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: validEmail, name, password, role: "reviewer" }),
      }, "That reviewer was not added");
      if (!result.ok) {
        toast(evaluationFailureMessage(result), { kind: "error" });
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
      <form noValidate onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <div className="form-stack">
          <Field label="Email" required error={emailError} errorId="reviewer-email-error">
            <input ref={emailRef} required type="email" aria-invalid={Boolean(emailError) || undefined} aria-describedby={emailError ? "reviewer-email-error" : undefined} value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} onBlur={() => setEmailError(reviewerEmailValidationError(email) ?? "")} placeholder="reviewer@example.com" />
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
          <Button type="submit" disabled={!canAttemptReviewerInvite(email, password, busy)}>
            {busy ? "Adding…" : "Add reviewer"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
