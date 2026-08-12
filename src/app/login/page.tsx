import { Suspense } from "react";
import { LoginForm } from "@/features/auth/components/login-form";
import { getEnv } from "@/shared/lib/env";
import { Brand } from "@/shared/ui/brand";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const env = getEnv();
  const googleEnabled = env.ADMIN_AUTH_PROVIDER === "better-auth"
    && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const signupEnabled = env.ADMIN_AUTH_PROVIDER === "better-auth";
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading sign-in…</p>}><LoginForm googleEnabled={googleEnabled} signupEnabled={signupEnabled} /></Suspense></div></section>
  </main>;
}
