import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { ActivationResendForm } from "@/features/auth/components/activation-resend-form";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { getAdminAuthFallbackLink } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const query = await searchParams;
  const email = (query.email ?? "").trim().toLowerCase();
  const next = safeInternalPath(query.next, "/organizations");
  const fallbackLink = email ? await getAdminAuthFallbackLink(email) : null;
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><div>
      <span className="metric-icon accent"><MailCheck size={20} /></span>
      <h1>Check your inbox</h1>
      <p>Check{email ? <> <b>{email}</b></> : " your email"} for a confirmation link. If this address still needs confirmation, a fresh link is on its way. Use it within one hour to continue into your workspace.</p>
      <aside className="auth-help"><b>Nothing yet?</b><span>Check spam or request a fresh link to the same address.</span></aside>
      <ActivationResendForm initialEmail={email} next={next} emailLocked={Boolean(email)} />
      {fallbackLink && <aside className="demo-code"><b>Demo access</b><span>Email delivery is limited in this environment.</span><Link href={fallbackLink}>Confirm email and continue</Link></aside>}
      {email && <p>Wrong email? <Link href="/signup">Start again with the correct address</Link></p>}
      <p><Link href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
    </div></div></section>
  </main>;
}
