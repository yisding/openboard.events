import type { Metadata } from "next";
import { PortalLoginForm } from "@/features/auth/components/portal-login-form";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Speaker portal sign in" };

export default async function PortalLoginPage({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<{ next?: string }> }) {
  const { eventSlug } = await params;
  const { next } = await searchParams;
  return <main className="login-page"><section className="login-card portal-login-card"><div className="login-card__brand"><Brand /></div><PortalLoginForm eventSlug={eventSlug} {...(next ? { next } : {})} /></section></main>;
}
