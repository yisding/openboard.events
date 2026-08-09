"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { OtpForm } from "./otp-form";

type Fallback = { otp: string; magicLink: string };

export function PortalLoginForm({ eventSlug, next }: { eventSlug: string; next?: string }) {
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const value = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    const response = await fetch("/api/internal/auth/portal/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, email: value }),
    });
    const body = await response.json().catch(() => null) as { data?: { fallback?: Fallback } } | null;
    setPending(false);
    if (!response.ok) {
      setError(response.status === 429 ? "Check your inbox, or try again in a few minutes" : "We couldn't send a code right now");
      return;
    }
    setEmail(value);
    setFallback(body?.data?.fallback ?? null);
    setRequested(true);
  }

  if (requested) return <>
    <h1>Check your inbox</h1>
    <p>Enter the six-digit code sent to <b>{email}</b>.</p>
    <OtpForm eventSlug={eventSlug} email={email} {...(next ? { next } : {})} />
    {fallback && <aside className="demo-code"><b>Development / fallback mode</b><span>Code <code>{fallback.otp}</code></span><Link href={fallback.magicLink}>Open magic link</Link></aside>}
    <button className="text-button" type="button" onClick={() => setRequested(false)}>Use a different email</button>
  </>;

  return <form onSubmit={requestCode}>
    <h1>Speaker portal</h1>
    <p>Enter your email to receive a one-time code and secure sign-in link.</p>
    <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" required /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending} type="submit">{pending ? "Sending…" : "Send sign-in code"}</button>
  </form>;
}
