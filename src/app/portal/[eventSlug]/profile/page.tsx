import type { Metadata } from "next";
import { getSpeakerProfile, requirePortalContext } from "@/features/portal";
import { ProfileForm } from "@/features/portal/profile/components/profile-form";
import { PortalProfile } from "@/features/portal/portal-profile";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The credential-free demo has no database to read; it keeps the browser
  // fixture path the README promises. Everywhere else this is real data.
  if (isCredentialFreeLocalDemo()) return <PortalProfile />;

  const { event, contact } = await requirePortalContext(eventSlug);
  const profile = await getSpeakerProfile(event.id, contact.id);
  return <ProfileForm eventId={event.id} profile={profile} />;
}
