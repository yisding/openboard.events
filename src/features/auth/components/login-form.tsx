"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { authPathWithNext, safeInternalPath } from "../safe-next";

type LoginFormProps = {
  googleEnabled?: boolean;
};

function GoogleMark() {
  return <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.3L6.5 14Z" />
    <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.8 9.8 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 5.9Z" />
  </svg>;
}

export function LoginForm({ googleEnabled = false }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const signupHref = authPathWithNext("/signup", requestedNext);
  const forgotPasswordHref = authPathWithNext("/login/forgot", requestedNext);
  const [pending, setPending] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  async function signInWithGoogle() {
    setPending("google");
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: safeInternalPath(searchParams.get("next")),
        }),
      });
      const body = await response.json().catch(() => null) as { url?: string } | null;
      if (!response.ok || !body?.url || new URL(body.url).protocol !== "https:") {
        setError("Google sign-in is temporarily unavailable");
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("Google sign-in is temporarily unavailable");
    } finally {
      setPending(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("password");
    setError("");
    setUnverifiedEmail("");
    setVerificationSent(false);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: data.get("password") }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        if (body?.error?.code === "EMAIL_NOT_VERIFIED") {
          setError("Confirm your email before signing in.");
          setUnverifiedEmail(email);
          return;
        }
        setError("Invalid email or password");
        return;
      }
      router.replace(safeInternalPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable");
    } finally {
      setPending(null);
    }
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    setResending(true);
    setError("");
    try {
      const next = safeInternalPath(searchParams.get("next"));
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: unverifiedEmail,
          callbackURL: `/signup/verified?confirmed=1&next=${encodeURIComponent(next)}`,
        }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Too many requests. Check your inbox or try again in a few minutes."
          : "We could not send another confirmation link right now.");
        return;
      }
      setVerificationSent(true);
    } catch {
      setError("We could not send another confirmation link right now.");
    } finally {
      setResending(false);
    }
  }

  return <form onSubmit={submit}>
    <span className="metric-icon accent"><LockKeyhole size={20} /></span>
    <h1>Welcome back</h1>
    <p>Sign in to your Openboard workspace.</p>
    {googleEnabled && <>
      <button className="button button-secondary button-lg google-signin" disabled={pending !== null} onClick={signInWithGoogle} type="button">
        <GoogleMark /> {pending === "google" ? "Connecting…" : "Continue with Google"}
      </button>
      <div className="auth-divider"><span>or continue with email</span></div>
    </>}
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    <label className="field"><span>Password</span><input name="password" autoComplete="current-password" required minLength={8} type="password" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {unverifiedEmail && (verificationSent
      ? <p className="auth-inline-success" role="status">A fresh confirmation link is on its way.</p>
      : <button className="button button-secondary" disabled={resending} onClick={resendVerification} type="button">{resending ? "Sending…" : "Resend confirmation email"}</button>)}
    <button className="button button-primary button-lg" disabled={pending !== null} type="submit">{pending === "password" ? "Signing in…" : "Sign in"} <ArrowRight size={16} /></button>
    {/* The only route into M42's reset flow. `/login/reset` is where the
        emailed link lands; `/login/forgot` is what causes it to be sent. */}
    <p><Link href={forgotPasswordHref}>Forgot your password?</Link></p>
    <p>New to Openboard? <Link href={signupHref}>Create your workspace</Link></p>
  </form>;
}
