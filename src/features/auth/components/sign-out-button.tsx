"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { safeInternalPath } from "../safe-next";

export function signOutDestination(kind: "admin" | "portal", eventSlug?: string, redirectTo?: string): string {
  const fallback = kind === "admin" ? "/login" : `/portal/${encodeURIComponent(eventSlug ?? "")}/login`;
  return safeInternalPath(redirectTo, fallback);
}

export function SignOutButton({ kind, eventSlug, compact = false, redirectTo, label = "Sign out" }: {
  kind: "admin" | "portal";
  eventSlug?: string;
  compact?: boolean;
  redirectTo?: string;
  label?: string;
}) {
  const { toast } = useToast();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(kind === "admin" ? "/api/auth/sign-out" : "/api/internal/auth/portal/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "admin" ? "{}" : JSON.stringify({ eventSlug }),
      });
      if (!response.ok) throw new Error("sign-out refused");
      allowNextNavigation(() => {
        window.location.assign(signOutDestination(kind, eventSlug, redirectTo));
      }, { hardUnload: true });
    } catch {
      setBusy(false);
      toast("Could not sign out — check your connection and try again", { kind: "error" });
    }
  }

  if (compact) return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => runGuarded(() => { void signOut(); })}
    >
      <LogOut size={15} aria-hidden />
    </button>
  );

  return (
    // Secondary, not ghost: this is the only way off the screens that render
    // it, and a borderless control beside an avatar reads as a caption rather
    // than as a button.
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={() => runGuarded(() => { void signOut(); })}
    >
      <LogOut size={14} aria-hidden />
      {busy ? "Signing out…" : label}
    </Button>
  );
}
