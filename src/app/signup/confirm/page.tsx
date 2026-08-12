import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { safeInternalPath } from "@/features/auth/safe-next";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

export default async function ConfirmEmailPage({ searchParams }: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const query = await searchParams;
  const token = query.token?.trim() ?? "";
  const next = safeInternalPath(query.next, "/organizations");

  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><div>
      <span className="metric-icon accent"><MailCheck size={20} /></span>
      <h1>Confirm your email</h1>
      {token ? <>
        <p>Continue to verify this address and securely open your new workspace.</p>
        <aside className="auth-help"><b>Why one more click?</b><span>It prevents automated email scanners from activating your account before you do.</span></aside>
        <form className="auth-confirm-form" method="post" action="/api/auth/confirm-email">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="next" value={next} />
          <button className="button button-primary button-lg" type="submit">Confirm and continue</button>
        </form>
      </> : <>
        <p>This confirmation link is incomplete. Request a fresh link to continue.</p>
        <Link className="button button-primary button-lg" href={`/signup/verified?error=invalid&next=${encodeURIComponent(next)}`}>Request a new link</Link>
      </>}
      <p><Link href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
    </div></div></section>
  </main>;
}
