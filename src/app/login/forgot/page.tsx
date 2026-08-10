import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { Brand } from "@/shared/ui/brand";
import { getEnv } from "@/shared/lib/env";

/**
 * M42 — where "Forgot your password?" goes. Same two-panel shell as `/login`
 * and `/login/reset`.
 *
 * The provider flag is read on the server and passed down, because the reset
 * flow exists only under `ADMIN_AUTH_PROVIDER=better-auth`: the fallback's
 * jose/PBKDF2 path has no reset endpoint at all, and `POST
 * /api/auth/request-password-reset` answers 404 there. Telling the user that
 * plainly beats a form that silently promises an email nothing will send.
 */
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const enabled = getEnv().ADMIN_AUTH_PROVIDER === "better-auth";
  return <main className="login-page">
    <section className="login-brand-panel"><Brand /><div><span>THE EVENT OS FOR AMBITIOUS TEAMS</span><h1>Build programs people remember.</h1><p>Submissions, speakers, schedules, and every detail in between.</p></div><small>© 2026 Openboard</small></section>
    <section className="login-form-panel"><div><ForgotPasswordForm enabled={enabled} /></div></section>
  </main>;
}
