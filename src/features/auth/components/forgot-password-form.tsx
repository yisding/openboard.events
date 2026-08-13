"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { Button } from "@/shared/ui/ui-kit";
import { authPathWithNext, safeInternalPath } from "../safe-next";

export function PasswordResetConfirmation({
  headingRef,
  loginHref = "/login",
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  loginHref?: string;
}) {
  return <div>
    <span className="metric-icon accent"><Mail size={20} /></span>
    <h1 ref={headingRef} tabIndex={-1}>Check your email</h1>
    <p>If that address has an account, a reset link is on its way. The link works once and expires in an hour.</p>
    <p><Link href={loginHref}>Back to sign in</Link></p>
  </div>;
}

/**
 * M42 — the entry point to the password-reset flow.
 *
 * `/login/reset` (`ResetPasswordForm`) has existed since M42 landed, but until
 * this form was added nothing in `src/`, `e2e/` or `scripts/` ever asked Better
 * Auth to *send* a reset link, so that page could only be reached by a link the
 * product had no way to cause. `LoginForm` now links here, and here is the only
 * caller of the send endpoint.
 *
 * The endpoint is `/api/auth/request-password-reset` — Better Auth 1.6's name
 * for it; there is no `/forget-password` route in core. `redirectTo` points at
 * our reset page and carries only a validated internal `next`. The mail hook
 * moves Better Auth's path token into that page's `token=` query parameter so
 * the dispatcher's credential redaction still covers it.
 *
 * The confirmation is unconditional and identical whether or not the address
 * exists, matching what the endpoint itself answers ("If this email exists in
 * our system…"). Anything that varied by outcome would turn a public form into
 * an account-enumeration oracle.
 */
export function ForgotPasswordForm({ enabled }: { enabled: boolean }) {
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"), "");
  const loginHref = authPathWithNext("/login", next);
  const resetHref = authPathWithNext("/login/reset", next);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!sent) return;
    return focusOnNextFrame(sentHeadingRef);
  }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), redirectTo: resetHref }),
      });
      if (!response.ok) {
        setError("Password reset is temporarily unavailable");
        return;
      }
      setSent(true);
    } catch {
      setError("Password reset is temporarily unavailable");
    } finally {
      setPending(false);
    }
  }

  if (!enabled) {
    return <div>
      <span className="metric-icon accent"><Mail size={20} /></span>
      <h1>Ask your organizer</h1>
      <p>Self-service password reset is not switched on for this workspace. An owner or organizer on your team can set a new password for you.</p>
      <p><Link href={loginHref}>Back to sign in</Link></p>
    </div>;
  }

  if (sent) {
    return <PasswordResetConfirmation headingRef={sentHeadingRef} loginHref={loginHref} />;
  }

  return <form onSubmit={submit}>
    <span className="metric-icon accent"><Mail size={20} /></span>
    <h1>Reset your password</h1>
    <p>We will email you a link to choose a new one.</p>
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button size="lg" disabled={pending} type="submit">{pending ? "Sending…" : "Email me a link"} <ArrowRight size={16} /></Button>
    <p><Link href={loginHref}>Back to sign in</Link></p>
  </form>;
}
