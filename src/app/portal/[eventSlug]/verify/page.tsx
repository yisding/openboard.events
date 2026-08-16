import type { Metadata } from "next";
import { MagicLinkForm } from "@/features/auth/components/magic-link-form";
import { OtpForm } from "@/features/auth/components/otp-form";
import { getEventBySlug } from "@/features/events";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Confirm portal sign in" };

export default async function PortalVerifyPage({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<{ token?: string; email?: string; impersonate?: string; next?: string }> }) {
  const { eventSlug } = await params;
  const query = await searchParams;
  // Same reason as the login page: a speaker holding two events' portals open
  // needs to see which one this code belongs to.
  const event = await getEventBySlug(eventSlug);
  return <main className="login-page"><section className="login-card portal-login-card"><div className="login-card__brand"><Brand /></div>{event && <span className="public-eyebrow">{event.name}</span>}<h1>Confirm portal sign in</h1>
    {query.token
      ? <MagicLinkForm eventSlug={eventSlug} token={query.token} impersonate={query.impersonate === "1"} {...(query.next ? { next: query.next } : {})} />
      : query.email
        ? <OtpForm eventSlug={eventSlug} email={query.email} {...(query.next ? { next: query.next } : {})} />
        : <p>This sign-in link is incomplete. Request a fresh code from the portal login page.</p>}
  </section></main>;
}
