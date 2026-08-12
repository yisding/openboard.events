"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, Mail, User } from "lucide-react";
import { safeInternalPath } from "../safe-next";
import { invitationTokenFromNextPath } from "../signup-context";
import { signupAndAwaitVerification } from "../signup-request";

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
export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"), "/organizations");
  const invitationToken = invitationTokenFromNextPath(next);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
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
      setPending(false);
    }
  }

  return <form onSubmit={submit}>
    <span className="metric-icon accent"><User size={20} /></span>
    <h1>{invitationToken ? "Create your account" : "Create your workspace"}</h1>
    <p>{invitationToken
      ? "Create an Openboard account to securely join the workspace that invited you."
      : "Start a new Openboard organization — invite your team once you’re in."}</p>
    <label className="field"><span>Your name</span><input name="name" autoComplete="name" required maxLength={160} type="text" /></label>
    {!invitationToken && <label className="field"><span>Organization name</span><div className="input-icon"><Building2 size={16} /><input name="organizationName" autoComplete="organization" required maxLength={160} type="text" placeholder="Acme Events" /></div></label>}
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    <label className="field"><span>Password</span><input name="password" autoComplete="new-password" required minLength={12} type="password" /></label>
    <small>At least 12 characters.</small>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary button-lg" disabled={pending} type="submit">{pending ? "Creating…" : "Create account"} <ArrowRight size={16} /></button>
    <p><a href="/login">Already have an account? Sign in</a></p>
  </form>;
}
