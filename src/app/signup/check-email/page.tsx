import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { ActivationResendForm } from "@/features/auth/components/activation-resend-form";
import { getAdminAuthFallbackLink } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { Brand } from "@/shared/ui/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const query = await searchParams;
  const email = (query.email ?? "").trim().toLowerCase();
  const next = safeInternalPath(query.next, "/organizations");
  const fallbackLink = email ? await getAdminAuthFallbackLink(email) : null;
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><div>
      <span className="metric-icon accent"><MailCheck size={20} /></span>
      <h1>Check your inbox</h1>
      <p>We sent a confirmation link{email ? <> to <b>{email}</b></> : null}. Confirm your email to continue into your workspace. The link expires in one hour.</p>
      <aside className="auth-help"><b>Nothing yet?</b><span>Check spam or request a fresh link to the same address.</span></aside>
      <ActivationResendForm initialEmail={email} next={next} emailLocked={Boolean(email)} />
      {fallbackLink && <aside className="demo-code"><b>Development / fallback mode</b><Link href={fallbackLink}>Open confirmation link</Link></aside>}
      {email && <p>Wrong email? <Link href="/signup">Start again with the correct address</Link></p>}
      <p><Link href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
    </div></div></section>
  </main>;
}
