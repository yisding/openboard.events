import { Suspense } from "react";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import type { Metadata } from "next";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

/**
 * M42 — where a password-reset email lands. Same two-panel shell as `/login`,
 * so nothing new is introduced to the design system: it reuses `login-page`,
 * the field/button classes and the accent ink tokens exactly as the sign-in
 * form does.
 */
export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<SkeletonText lines={4} label="Loading the password reset form…" />}><ResetPasswordForm /></Suspense></div></section>
  </main>;
}
