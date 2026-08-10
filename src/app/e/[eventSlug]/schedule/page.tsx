import { redirect } from "next/navigation";

/**
 * Legacy route: M53 split this single combined view into five distinct
 * surfaces (`sessions`, `agenda`, `itinerary`, `speakers`, `gallery`). The
 * closest match for "/schedule" — and what pre-M53 links (including the
 * marketing page's "See the public agenda" CTA) mean by it — is the Agenda
 * surface, so old links keep working instead of 404ing.
 */
export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  redirect(`/e/${eventSlug}/agenda`);
}
