import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
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
export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  const enabled = getEnv().ADMIN_AUTH_PROVIDER === "better-auth";
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<p>Loading…</p>}><ForgotPasswordForm enabled={enabled} /></Suspense></div></section>
  </main>;
}
