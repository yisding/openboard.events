import { Suspense } from "react";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import type { Metadata } from "next";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

/**
 * M42 — where "Forgot your password?" goes. Same two-panel shell as `/login`
 * and `/login/reset`.
 *
 * Better Auth owns the reset token and credential update; the application
 * owns the product-specific landing page and durable email delivery.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<SkeletonText lines={4} label="Loading the password recovery form…" />}><ForgotPasswordForm /></Suspense></div></section>
  </main>;
}
