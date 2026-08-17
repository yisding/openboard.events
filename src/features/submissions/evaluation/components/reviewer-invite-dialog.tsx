"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { OrganizationInvitationDTO } from "@/shared/contracts";
import { TzTime } from "@/shared/ui/app/tz-time";
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

export function canAttemptReviewerInvite(email: string, busy: boolean): boolean {
  return !busy && email.trim() !== "";
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
 * The reviewer proves control of their own mailbox, then signs in or creates
 * their own account through the same invitation journey as a teammate. The
 * accepted credential grants only this event's review access.
 */
export function ReviewerInviteDialog({
  eventId,
  initialPendingInvitations,
  timezone,
  onClose,
}: {
  eventId: string;
  initialPendingInvitations: OrganizationInvitationDTO[];
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState(initialPendingInvitations);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPendingInvitations(initialPendingInvitations), [initialPendingInvitations]);

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
      const result = await evaluationRequest<{ email: string; emailQueued: boolean; eventName: string }>(`/api/internal/evaluation/${eventId}/reviewers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: validEmail }),
      }, "That invitation was not sent");
      if (!result.ok) {
        toast(evaluationFailureMessage(result), { kind: "error" });
        return;
      }
      toast(`Invitation queued for ${result.data.email}`);
      onClose();
      router.refresh();
    } catch {
      toast("That invitation was not sent — check your connection and try again", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: OrganizationInvitationDTO) {
    if (revokingId) return;
    setRevokingId(invitation.id);
    try {
      const result = await evaluationRequest<{ revoked: boolean }>(
        `/api/internal/evaluation/${eventId}/reviewers/invitations/${invitation.id}`,
        { method: "DELETE" },
        "That invitation was not revoked",
      );
      if (!result.ok) {
        toast(evaluationFailureMessage(result), { kind: "error" });
        return;
      }
      setPendingInvitations((current) => current.filter((row) => row.id !== invitation.id));
      toast(`Invitation to ${invitation.email} revoked`);
      router.refresh();
    } catch {
      toast("That invitation was not revoked — check your connection and try again", { kind: "error" });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Drawer open compact onClose={() => { if (!busy && !revokingId) onClose(); }} title="Invite a reviewer">
      <form className="drawer-body drawer-form" noValidate onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <div className="form-stack">
          <Field label="Email" required error={emailError} errorId="reviewer-email-error">
            <input ref={emailRef} required type="email" aria-invalid={Boolean(emailError) || undefined} aria-describedby={emailError ? "reviewer-email-error" : undefined} value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} onBlur={() => setEmailError(reviewerEmailValidationError(email) ?? "")} placeholder="reviewer@example.com" />
          </Field>
          <p className="portal-note reviewer-invite-note">
            They’ll get an email-bound link to sign in or create their own account. Accepting it grants this event’s review queue only; existing passwords and stronger roles are never changed.
          </p>
          {pendingInvitations.length > 0 && (
            <section className="reviewer-pending-invitations" aria-labelledby="reviewer-pending-heading">
              <h3 id="reviewer-pending-heading">Pending invitations</h3>
              <ul>
                {pendingInvitations.map((invitation) => (
                  <li key={invitation.id}>
                    <span><b>{invitation.email}</b><small>Expires <TzTime instant={invitation.expiresAt} tz={timezone} style="date" /></small></span>
                    <Button type="button" size="sm" variant="danger" disabled={Boolean(revokingId)} onClick={() => void revoke(invitation)}>
                      {revokingId === invitation.id ? "Revoking…" : "Revoke"}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="drawer-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy || Boolean(revokingId)}>Cancel</Button>
          <Button type="submit" disabled={!canAttemptReviewerInvite(email, busy || Boolean(revokingId))}>
            {busy ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
