"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { Button } from "@/shared/ui/ui-kit";

export function ActivationResendForm({
  initialEmail = "",
  next = "/organizations",
  emailLocked = false,
}: {
  initialEmail?: string;
  next?: string;
  /** A resend cannot change the address attached to the account being activated. */
  emailLocked?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSent(false);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          callbackURL: `/signup/verified?confirmed=1&next=${encodeURIComponent(next)}`,
        }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Too many requests. Check your inbox or try again in a few minutes."
          : "We could not send another link right now.");
        return;
      }
      setSent(true);
    } catch {
      setError("We could not send another link right now.");
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-resend-form" onSubmit={submit}>
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input
      name="email"
      autoComplete="email"
      defaultValue={initialEmail}
      required
      readOnly={emailLocked}
      type="email"
      aria-describedby={emailLocked ? "activation-resend-email-help" : undefined}
    /></div></label>
    {emailLocked && <small id="activation-resend-email-help">A new link can only be sent to the address used to create this account.</small>}
    {sent && <p className="auth-inline-success" role="status">If that address still needs confirmation, a fresh link is on its way.</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button variant="secondary" disabled={pending} type="submit">{pending ? "Sending…" : sent ? "Send another link" : "Send a new link"} <ArrowRight size={16} /></Button>
  </form>;
}
