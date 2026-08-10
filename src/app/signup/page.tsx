import { Suspense } from "react";
import type { Metadata } from "next";
import { SignupForm } from "@/features/auth/components/signup-form";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Create your workspace" };

export default function SignupPage() {
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><SignupForm /></Suspense></div></section>
  </main>;
}
