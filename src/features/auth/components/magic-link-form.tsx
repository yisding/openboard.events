"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/ui-kit";
import { safeInternalPath } from "../safe-next";
import { portalAuthRequest } from "./portal-auth-request";

export function MagicLinkForm({ eventSlug, token, impersonate, next }: { eventSlug: string; token: string; impersonate: boolean; next?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/verify", { eventSlug, token, impersonate });
      if (!result.ok) {
        setError(result.status === null
          ? "We couldn't reach the server — check your connection and try again"
          : result.status >= 500
            ? "We couldn't confirm that link right now — try again"
            : "That link is invalid or expired");
        return;
      }
      if (result.data.alreadySignedIn) await new Promise((resolve) => setTimeout(resolve, 250));
      window.location.assign(safeInternalPath(next, `/portal/${eventSlug}`));
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit}>
    <p>For your security, opening this page did not sign you in. Confirm below to use the link.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Signing in…" : impersonate ? "Open speaker portal" : "Confirm sign in"}</Button>
  </form>;
}
