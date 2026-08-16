"use client";

import { Eye } from "lucide-react";
import { useState } from "react";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";

/**
 * Persistent attribution for an impersonated portal session: who is being
 * viewed *and* who opened it, because on a shared machine the banner is the
 * only thing that says either.
 *
 * Leaving is a sign-out, not a navigation, so the control is a `<button>` like
 * `SignOutButton` and not a link: an anchor advertises a destination, and every
 * ordinary link gesture on one (cmd/ctrl-click, middle-click, "open in new
 * tab") would reach the admin URL without ever ending the session. Pushing the
 * admin URL used to leave the speaker's portal cookie live in the browser, so
 * re-typing the portal URL put whoever had the laptop straight back into the
 * speaker's session; the portal logout endpoint deletes the session row before
 * we go anywhere.
 */
export function ImpersonationBanner({ name, email, eventSlug, admin, backHref }: {
  name: string;
  email: string;
  eventSlug: string;
  admin: { name: string; email: string } | null;
  backHref: string;
}) {
  const { toast } = useToast();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const [busy, setBusy] = useState(false);

  async function exitImpersonation() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/internal/auth/portal/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventSlug }),
      });
      if (!response.ok) throw new Error("portal sign-out refused");
      // A hard load, so no cached portal RSC payload survives the exit.
      allowNextNavigation(() => {
        window.location.assign(backHref);
      }, { destination: backHref, hardUnload: true });
    } catch {
      setBusy(false);
      toast("Could not end the impersonated session — check your connection and try again", { kind: "error" });
    }
  }

  return <div className="impersonation-banner">
    <Eye size={14} />
    <span>Viewing as <b>{name}</b> ({email}){admin && <> · opened by <b>{admin.name}</b> ({admin.email})</>}</span>
    <button type="button" disabled={busy} onClick={() => runGuarded(() => { void exitImpersonation(); })}>
      {busy ? "Ending session…" : "Exit impersonation"}
    </button>
  </div>;
}
