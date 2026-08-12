import type { Metadata } from "next";
import { getSpeakerProfile, requirePortalContext } from "@/features/portal";
import { ProfileForm } from "@/features/portal/profile/components/profile-form";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { event, contact } = await requirePortalContext(eventSlug);
  const profile = await getSpeakerProfile(event.id, contact.id);
  return <ProfileForm eventId={event.id} profile={profile} />;
}
