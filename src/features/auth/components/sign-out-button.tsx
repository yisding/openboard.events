"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/shared/ui/toast";

export function SignOutButton({ kind, eventSlug, compact = false }: {
  kind: "admin" | "portal";
  eventSlug?: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
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
      window.location.assign(kind === "admin" ? "/login" : `/portal/${encodeURIComponent(eventSlug ?? "")}/login`);
    } catch {
      setBusy(false);
      toast("Could not sign out — check your connection and try again");
    }
  }

  return (
    <button
      type="button"
      className={compact ? "icon-button" : "button button-ghost button-sm"}
      aria-label={compact ? "Sign out" : undefined}
      title={compact ? "Sign out" : undefined}
      disabled={busy}
      onClick={() => void signOut()}
    >
      <LogOut size={compact ? 15 : 14} aria-hidden />
      {!compact && (busy ? "Signing out…" : "Sign out")}
    </button>
  );
}
