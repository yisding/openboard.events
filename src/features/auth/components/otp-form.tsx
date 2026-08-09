"use client";

import { useState, type FormEvent } from "react";

export function OtpForm({ eventSlug, email, next }: { eventSlug: string; email: string; next?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const response = await fetch("/api/internal/auth/portal/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, email, code }),
    });
    setPending(false);
    if (!response.ok) {
      setError("That code is invalid or expired");
      return;
    }
    window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : `/portal/${eventSlug}`);
  }

  return <form onSubmit={submit}>
    <label className="field"><span>6-digit code</span><input className="otp-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending} type="submit">{pending ? "Verifying…" : "Verify code"}</button>
  </form>;
}
