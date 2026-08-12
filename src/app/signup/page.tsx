import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/components/signup-form";
import { Brand } from "@/shared/ui/brand";
import { getEnv, isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { signupLegalConsent } from "@/features/auth/legal-consent";

export const metadata: Metadata = { title: "Create your workspace" };
// Keep the page in lockstep with the runtime auth provider used by the API.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  const env = getEnv();
  if (env.ADMIN_AUTH_PROVIDER !== "better-auth") {
    redirect(isCredentialFreeLocalDemo(env) ? "/events" : "/login");
  }
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><SignupForm googleEnabled={googleEnabled} legalConsent={signupLegalConsent(env)} /></Suspense></div></section>
  </main>;
}
