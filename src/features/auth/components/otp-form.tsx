"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/ui-kit";
import { safeInternalPath } from "../safe-next";
import { portalAuthRequest } from "./portal-auth-request";

export function OtpForm({ eventSlug, email, next }: { eventSlug: string; email: string; next?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/verify", { eventSlug, email, code });
      if (!result.ok) {
        setError(result.status === null
          ? "We couldn’t reach the server — check your connection and try again"
          : result.status >= 500
            ? "We couldn’t verify that code right now — try again"
            : "That code is invalid or expired");
        return;
      }
      if (result.data.alreadySignedIn) await new Promise((resolve) => setTimeout(resolve, 250));
      window.location.assign(safeInternalPath(next, `/portal/${eventSlug}`));
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit}>
    <label className="field"><span>6-digit code</span><input className="otp-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Verifying…" : "Verify code"}</Button>
  </form>;
}
