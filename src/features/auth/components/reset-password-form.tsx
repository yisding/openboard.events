"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/shared/ui/ui-kit";
import { authPathWithNext, safeInternalPath } from "../safe-next";

/**
 * M42 — the landing page for a Better Auth password-reset link.
 *
 * The token arrives as `?token=…` (chosen in `better-auth.ts` so the
 * dispatcher's existing `token=` redaction covers the stored email body) and is
 * posted straight back to Better Auth's own `reset-password` endpoint. Nothing
 * here validates the token itself — the server owns that, and a client that
 * pre-checked it would only leak whether a token is live.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const next = safeInternalPath(searchParams.get("next"), "");
  const loginHref = authPathWithNext("/login", next);
  const forgotPasswordHref = authPathWithNext("/login/forgot", next);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirm") ?? "")) {
      setError("Those passwords do not match");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (!response.ok) {
        setError("That reset link is no longer valid. Request a new one.");
        return;
      }
      setDone(true);
      router.replace(loginHref);
    } catch {
      setError("Password reset is temporarily unavailable");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return <div>
      <span className="metric-icon accent"><LockKeyhole size={20} /></span>
      <h1>This link is incomplete</h1>
      <p>Open the reset link from your email again, or request a new one.</p>
      <Link className="button button-primary button-lg" href={forgotPasswordHref}>Request a new link</Link>
      <p><Link href={loginHref}>Back to sign in</Link></p>
    </div>;
  }

  return <form onSubmit={submit}>
    <span className="metric-icon accent"><LockKeyhole size={20} /></span>
    <h1>Choose a new password</h1>
    <p>Pick something you have not used here before.</p>
    <label className="field"><span>New password</span><input name="password" autoComplete="new-password" required minLength={12} type="password" /></label>
    <label className="field"><span>Confirm new password</span><input name="confirm" autoComplete="new-password" required minLength={12} type="password" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {error.includes("no longer valid") && <p><Link href={forgotPasswordHref}>Request a new reset link</Link></p>}
    <Button size="lg" disabled={pending || done} type="submit">
      {pending ? "Saving…" : "Save password"} <ArrowRight size={16} />
    </Button>
  </form>;
}
