import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/components/signup-form";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { getAdminSession } from "@/features/auth";
import { authenticatedAuthDestination, authPathWithNext } from "@/features/auth/safe-next";
import { getEnv } from "@/shared/lib/env";
import { signupLegalConsent } from "@/features/auth/legal-consent";

export const metadata: Metadata = { title: "Create your workspace" };
// Keep the page in lockstep with the runtime auth provider used by the API.
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  if (await getAdminSession()) redirect(authenticatedAuthDestination(query.next));
  const env = getEnv();
  // Self-service signup only exists under Better Auth; every other provider
  // has its accounts provisioned elsewhere, so send the visitor to sign in.
  if (env.ADMIN_AUTH_PROVIDER !== "better-auth") redirect(authPathWithNext("/login", query.next));
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><SignupForm googleEnabled={googleEnabled} legalConsent={signupLegalConsent(env)} /></Suspense></div></section>
  </main>;
}
