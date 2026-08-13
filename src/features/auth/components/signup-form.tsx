"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, Mail, User } from "lucide-react";
import { Button } from "@/shared/ui/ui-kit";
import { authPathWithNext, safeInternalPath } from "../safe-next";
import { invitationTokenFromNextPath } from "../signup-context";
import { beginGoogleSignup, signupAndAwaitVerification } from "../signup-request";
import type { SignupLegalConsent } from "../legal-consent";
import { AuthPasswordField } from "./auth-password-field";
import { GoogleMark } from "./google-mark";

/**
 * M44 — self-serve signup. Posts straight to Better Auth's own
 * `/api/auth/sign-up/email` (forwarded transparently by the catch-all route,
 * the same way `ResetPasswordForm` posts to `/api/auth/reset-password`). The
 * account remains sessionless until its product-level confirmation email is
 * used; the successful response advances to an explicit check-inbox state.
 *
 * The account that lands here already has an organization: the Better Auth
 * `databaseHooks.user.create.after` hook provisions one or, when the user
 * arrived through `/join?token=…`, consumes that exact invitation token. An
 * email match alone is never enough to claim organization membership.
 *
 * M45: the default landing spot after signup is `/organizations` rather than
 * the global, organization-blind `/events` list — that page resolves a
 * single-organization account straight down to its organization, which sends
 * a brand-new (eventless) organization on into the guided setup wizard. This
 * is the "un-disable the entry point" step the roadmap calls out as last: the
 * wizard and the organization-scoped create-event route both have to exist
 * first, or this redirect would hand a fresh signup to an empty screen.
 */
type SignupFormProps = {
  googleEnabled?: boolean;
  legalConsent?: SignupLegalConsent | null;
};

function LegalConsentField({ legalConsent }: { legalConsent: SignupLegalConsent | null }) {
  if (!legalConsent) return null;
  return <label className="auth-consent">
    <input name="legalConsentAccepted" required type="checkbox" />
    <span>
      I agree to the <a href={legalConsent.termsUrl} target="_blank" rel="noreferrer">Terms of Service</a> and acknowledge the <a href={legalConsent.privacyUrl} target="_blank" rel="noreferrer">Privacy Policy</a>.
    </span>
  </label>;
}

export function SignupForm({ googleEnabled = false, legalConsent = null }: SignupFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"), "/organizations");
  const loginHref = authPathWithNext("/login", next);
  const invitationToken = invitationTokenFromNextPath(next);
  const oauthReturnedWithError = googleEnabled && Boolean(searchParams.get("error"));
  const [googleSetup, setGoogleSetup] = useState(oauthReturnedWithError);
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState(oauthReturnedWithError
    ? "Google could not create that account. Check the workspace details or use email instead."
    : "");

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("email");
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "");
    const organizationName = String(data.get("organizationName") ?? "");
    try {
      const transition = await signupAndAwaitVerification({
        email,
        password,
        name,
        organizationName,
        invitationToken,
        legalConsent,
        legalConsentAccepted: data.get("legalConsentAccepted") === "on",
        next,
      });
      if ("error" in transition) {
        setError(transition.error);
        return;
      }
      router.replace(transition.destination);
      if (transition.refresh) router.refresh();
    } catch {
      setError("Signup is temporarily unavailable");
    } finally {
      setPending(null);
    }
  }

  async function submitGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("google");
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const transition = await beginGoogleSignup({
        organizationName: String(data.get("organizationName") ?? ""),
        invitationToken,
        legalConsent,
        legalConsentAccepted: data.get("legalConsentAccepted") === "on",
        next,
      });
      if ("error" in transition) {
        setError(transition.error);
        return;
      }
      window.location.assign(transition.url);
    } catch {
      setError("Google signup is temporarily unavailable");
    } finally {
      setPending(null);
    }
  }

  if (googleSetup) return <form onSubmit={submitGoogle}>
    <span className="metric-icon accent"><User size={20} /></span>
    <h1>{invitationToken ? "Join with Google" : "Set up with Google"}</h1>
    <p>{invitationToken
      ? "Use the Google account that received this invitation. We’ll take you straight to the invited workspace."
      : "Name your organization, then continue securely with your Google account."}</p>
    <aside className="auth-help auth-signup-path">
      <b>What happens next</b>
      <span>{invitationToken
        ? "Google confirms your identity, then you’ll continue straight to the workspace that invited you."
        : "Google confirms your identity, then guided setup takes you from event details to a shareable CFP."}</span>
    </aside>
    {!invitationToken && <label className="field"><span>Organization name</span><div className="input-icon"><Building2 size={16} /><input name="organizationName" autoComplete="organization" required maxLength={160} type="text" placeholder="Acme Events" /></div></label>}
    <LegalConsentField legalConsent={legalConsent} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button variant="secondary" size="lg" className="google-signin" disabled={pending !== null} type="submit">
      <GoogleMark /> {pending === "google" ? "Connecting…" : invitationToken ? "Join with Google" : "Create with Google"}
    </Button>
    <Button variant="ghost" size="lg" className="auth-provider-back" disabled={pending !== null} onClick={() => { setGoogleSetup(false); setError(""); }} type="button">
      Use email instead
    </Button>
    <p>Already have an account? <Link href={loginHref}>Sign in</Link></p>
  </form>;

  return <form onSubmit={submitEmail}>
    <span className="metric-icon accent"><User size={20} /></span>
    <h1>{invitationToken ? "Create your account" : "Create your workspace"}</h1>
    <p>{invitationToken
      ? "Create an Openboard account to securely join the workspace that invited you."
      : "Start your organization now, then publish your first call for speakers in guided setup."}</p>
    <aside className="auth-help auth-signup-path">
      <b>What happens next</b>
      <span>{invitationToken
        ? "Confirm your email, then continue straight to the workspace that invited you."
        : "Confirm your email, add your event details, and leave with a ready-to-share CFP."}</span>
    </aside>
    {googleEnabled && <>
      <Button variant="secondary" size="lg" className="google-signin" disabled={pending !== null} onClick={() => { setGoogleSetup(true); setError(""); }} type="button">
        <GoogleMark /> Continue with Google
      </Button>
      <div className="auth-divider"><span>or create with email</span></div>
    </>}
    <label className="field"><span>Your name</span><input name="name" autoComplete="name" required maxLength={160} type="text" /></label>
    {!invitationToken && <label className="field"><span>Organization name</span><div className="input-icon"><Building2 size={16} /><input name="organizationName" autoComplete="organization" required maxLength={160} type="text" placeholder="Acme Events" /></div></label>}
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    <AuthPasswordField id="signup-password" name="password" label="Password" autoComplete="new-password" minLength={12} hint="Use at least 12 characters." />
    <LegalConsentField legalConsent={legalConsent} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button size="lg" disabled={pending !== null} type="submit">{pending === "email" ? "Creating…" : "Create account"} <ArrowRight size={16} /></Button>
    <p>Already have an account? <Link href={loginHref}>Sign in</Link></p>
  </form>;
}
