import { Suspense } from "react";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { Brand } from "@/shared/ui/brand";

/**
 * M42 — where a password-reset email lands. Same two-panel shell as `/login`,
 * so nothing new is introduced to the design system: it reuses `login-page`,
 * the field/button classes and the accent ink tokens exactly as the sign-in
 * form does.
 */
export default function ResetPasswordPage() {
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><ResetPasswordForm /></Suspense></div></section>
  </main>;
}
