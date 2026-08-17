"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/ui-kit";
import { safeInternalPath } from "../safe-next";
import { portalAuthRequest } from "./portal-auth-request";

export function MagicLinkForm({ eventSlug, token, impersonate, next }: { eventSlug: string; token: string; impersonate: boolean; next?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /**
   * The impersonation link expired *behind this very page*: confirming here is
   * a deliberate second step, so the link can die between the organizer opening
   * the tab and reading it. Before this, the only re-issue path was the admin
   * tab they had just left (or closed). Offer the way back from here instead —
   * see `/api/internal/auth/portal/impersonate/renew`.
   */
  const [staleLink, setStaleLink] = useState(false);

  function enter() {
    window.location.assign(safeInternalPath(next, `/portal/${eventSlug}`));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/verify", { eventSlug, token, impersonate });
      if (!result.ok) {
        const unreachable = result.status === null;
        const serverFault = result.status !== null && result.status >= 500;
        // A refused impersonation link is recoverable from here, and the panel
        // that replaces this form says so in full — no error line repeating
        // half of it.
        if (impersonate && !unreachable && !serverFault) {
          setStaleLink(true);
          return;
        }
        setError(unreachable
          ? "We couldn't reach the server — check your connection and try again"
          : serverFault
            ? "We couldn't confirm that link right now — try again"
            : "That link is invalid or expired");
        return;
      }
      if (result.data.alreadySignedIn) await new Promise((resolve) => setTimeout(resolve, 250));
      enter();
    } finally {
      setPending(false);
    }
  }

  async function renew() {
    setPending(true);
    setError("");
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/impersonate/renew", { eventSlug, token });
      if (!result.ok) {
        setError(result.status === null
          ? "We couldn't reach the server — check your connection and try again"
          : result.status === 401 || result.status === 403
            ? "Your organizer sign-in has expired — sign in again, then reopen the portal from the speaker's page"
            : result.message);
        return;
      }
      enter();
    } finally {
      setPending(false);
    }
  }

  if (staleLink) {
    return <div className="form-stack">
      {/* Announced, because it replaces the form the organizer just submitted
          and a screen-reader user would otherwise hear nothing happen. */}
      <p role="status">That link expired while this page was open. Impersonation links are short-lived; you can pick up where you left off with a fresh one.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <Button disabled={pending} type="button" onClick={renew}>{pending ? "Reopening…" : "Get a fresh link and continue"}</Button>
    </div>;
  }

  return <form onSubmit={submit}>
    <p>For your security, opening this page did not sign you in. Confirm below to use the link.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Signing in…" : impersonate ? "Open speaker portal" : "Confirm sign in"}</Button>
  </form>;
}
