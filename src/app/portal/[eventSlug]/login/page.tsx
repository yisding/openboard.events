import type { Metadata } from "next";
import { PortalLoginForm } from "@/features/auth/components/portal-login-form";
import { getEventBySlug } from "@/features/events";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Speaker portal sign in" };

export default async function PortalLoginPage({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<{ next?: string }> }) {
  const { eventSlug } = await params;
  const { next } = await searchParams;
  // Codes are minted per event, so both steps say which event is being signed
  // into — the same name the signed-in portal header and the OTP email carry.
  const event = await getEventBySlug(eventSlug);
  return <main className="login-page"><section className="login-card portal-login-card"><div className="login-card__brand"><Brand /></div>{event && <span className="public-eyebrow">{event.name}</span>}<PortalLoginForm eventSlug={eventSlug} {...(next ? { next } : {})} /></section></main>;
}
