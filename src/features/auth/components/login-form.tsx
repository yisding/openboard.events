"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/shared/ui/ui-kit";
import { authPathWithNext, safeInternalPath } from "../safe-next";
import { AuthPasswordField } from "./auth-password-field";
import { GoogleMark } from "./google-mark";

type LoginFormProps = {
  googleEnabled?: boolean;
};

export function googleSignInErrorMessage(code: string | null): string {
  if (!code) return "";
  return code === "signup_disabled"
    ? "We couldn’t find an Openboard account for that Google address."
    : "Google sign-in did not finish. Try again or continue with email.";
}

export function LoginForm({ googleEnabled = false }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const signupHref = authPathWithNext("/signup", requestedNext);
  const forgotPasswordHref = authPathWithNext("/login/forgot", requestedNext);
  const [pending, setPending] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState(() => googleSignInErrorMessage(searchParams.get("error")));
  const [googleSignupRequired, setGoogleSignupRequired] = useState(() => searchParams.get("error") === "signup_disabled");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  async function signInWithGoogle() {
    setPending("google");
    setError("");
    setGoogleSignupRequired(false);
    try {
      const next = safeInternalPath(requestedNext);
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: next,
          errorCallbackURL: authPathWithNext("/login", requestedNext),
          requestSignUp: false,
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
    setGoogleSignupRequired(false);
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
      <Button variant="secondary" size="lg" className="google-signin" disabled={pending !== null} onClick={signInWithGoogle} type="button">
        <GoogleMark /> {pending === "google" ? "Connecting…" : "Continue with Google"}
      </Button>
      <div className="auth-divider"><span>or continue with email</span></div>
    </>}
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    <AuthPasswordField id="login-password" name="password" label="Password" autoComplete="current-password" minLength={8} />
    {error && <p className="field-error" role="alert">
      {error}{googleSignupRequired && <> <Link href={signupHref}>Create your workspace</Link> to continue.</>}
    </p>}
    {unverifiedEmail && (verificationSent
      ? <p className="auth-inline-success" role="status">A fresh confirmation link is on its way.</p>
      : <Button variant="secondary" disabled={resending} onClick={resendVerification} type="button">{resending ? "Sending…" : "Resend confirmation email"}</Button>)}
    <Button size="lg" disabled={pending !== null} type="submit">{pending === "password" ? "Signing in…" : "Sign in"} <ArrowRight size={16} /></Button>
    {/* The only route into M42's reset flow. `/login/reset` is where the
        emailed link lands; `/login/forgot` is what causes it to be sent. */}
    <p><Link href={forgotPasswordHref}>Forgot your password?</Link></p>
    <p>New to Openboard? <Link href={signupHref}>Create your workspace</Link></p>
  </form>;
}
