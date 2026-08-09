import { Suspense } from "react";
import { LoginForm } from "@/features/auth/components/login-form";
import { Brand } from "@/shared/ui/brand";

export default function LoginPage() {
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading sign-in…</p>}><LoginForm /></Suspense></div></section>
  </main>;
}
