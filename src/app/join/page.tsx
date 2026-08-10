import { Suspense } from "react";
import type { Metadata } from "next";
import { JoinInvitationView } from "@/features/auth/components/join-invitation-view";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Accept invitation" };

export default function JoinPage() {
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><JoinInvitationView /></Suspense></div></section>
  </main>;
}
