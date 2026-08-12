import Link from "next/link";
import type { Metadata } from "next";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { ActivationResendForm } from "@/features/auth/components/activation-resend-form";
import { safeInternalPath } from "@/features/auth/safe-next";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Email confirmation" };

export default async function VerifiedEmailPage({ searchParams }: { searchParams: Promise<{ confirmed?: string; error?: string; next?: string }> }) {
  const query = await searchParams;
  const next = safeInternalPath(query.next, "/organizations");
  const failed = Boolean(query.error) || query.confirmed !== "1";
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><div>
      <span className={`metric-icon ${failed ? "warn" : "accent"}`}>{failed ? <CircleAlert size={20} /> : <BadgeCheck size={20} />}</span>
      <h1>{failed ? "That link did not work" : "Email confirmed"}</h1>
      {failed ? <>
        <p>The confirmation link may be expired or invalid. Enter your email and we will send a fresh one.</p>
        <ActivationResendForm next={next} />
        <p><Link href="/login">Back to sign in</Link></p>
      </> : <>
        <p>Your account is active. Sign in to continue setting up your workspace.</p>
        <Link className="button button-primary button-lg" href={`/login?next=${encodeURIComponent(next)}`}>Continue to sign in</Link>
      </>}
    </div></div></section>
  </main>;
}
