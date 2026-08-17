import { Suspense } from "react";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import type { Metadata } from "next";
import { AuthBrandPanel } from "@/features/auth/components/auth-brand-panel";
import { JoinInvitationView } from "@/features/auth/components/join-invitation-view";

export const metadata: Metadata = { title: "Accept invitation" };

export default function JoinPage() {
  return <main className="login-page">
    <AuthBrandPanel />
    <section className="login-form-panel"><div><Suspense fallback={<SkeletonText lines={4} label="Loading your invitation…" />}><JoinInvitationView /></Suspense></div></section>
  </main>;
}
