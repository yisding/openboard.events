"use client";

import { useState, type FormEvent } from "react";
import { safeInternalPath } from "../safe-next";

export function MagicLinkForm({ eventSlug, token, impersonate, next }: { eventSlug: string; token: string; impersonate: boolean; next?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/internal/auth/portal/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, token, impersonate }),
    });
    const body = await response.json().catch(() => null) as { data?: { alreadySignedIn?: boolean } } | null;
    setPending(false);
    if (!response.ok) {
      setError("That link is invalid or expired");
      return;
    }
    if (body?.data?.alreadySignedIn) await new Promise((resolve) => setTimeout(resolve, 250));
    window.location.assign(safeInternalPath(next, `/portal/${eventSlug}`));
  }

  return <form onSubmit={submit}>
    <p>For your security, opening this page did not sign you in. Confirm below to use the link.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending} type="submit">{pending ? "Signing in…" : impersonate ? "Open speaker portal" : "Confirm sign in"}</button>
  </form>;
}
