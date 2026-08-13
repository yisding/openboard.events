import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { ActivationResendForm } from "@/features/auth/components/activation-resend-form";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { getAdminSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";

export const metadata: Metadata = { title: "Email confirmation" };

export default async function VerifiedEmailPage({ searchParams }: { searchParams: Promise<{ confirmed?: string; error?: string; next?: string }> }) {
  const query = await searchParams;
  const next = safeInternalPath(query.next, "/organizations");
  const failed = Boolean(query.error) || query.confirmed !== "1";
  // The explicit confirmation POST normally continues straight into the
  // provisioned workspace. Keep this legacy success callback useful too: a
  // browser with a verified session continues, while an old/replayed link in
  // another browser retains the ordinary sign-in fallback below.
  if (!failed && await getAdminSession()) redirect(next);
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><div>
      <span className={`metric-icon ${failed ? "warn" : "accent"}`}>{failed ? <CircleAlert size={20} /> : <BadgeCheck size={20} />}</span>
      <h1>{failed ? "That link did not work" : "Email confirmed"}</h1>
      {failed ? <>
        <p>The confirmation link may be expired or invalid. Enter your email and we will send a fresh one.</p>
        <ActivationResendForm next={next} />
        <p><Link href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
      </> : <>
        <p>Your account is active. Sign in to continue setting up your workspace.</p>
        <Link className="button button-primary button-lg" href={`/login?next=${encodeURIComponent(next)}`}>Continue to sign in</Link>
      </>}
    </div></div></section>
  </main>;
}
