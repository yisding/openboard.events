import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/login-form";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { getAdminSession } from "@/features/auth";
import { authenticatedAuthDestination } from "@/features/auth/safe-next";
import { getEnv } from "@/shared/lib/env";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  if (await getAdminSession()) redirect(authenticatedAuthDestination(query.next));
  const env = getEnv();
  const googleEnabled = env.ADMIN_AUTH_PROVIDER === "better-auth"
    && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const signupEnabled = env.ADMIN_AUTH_PROVIDER === "better-auth";
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading sign-in…</p>}><LoginForm googleEnabled={googleEnabled} signupEnabled={signupEnabled} /></Suspense></div></section>
  </main>;
}
