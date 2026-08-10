import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSchedule } from "@/features/public/public-schedule";
import { isEmbedEnabled } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // The kill switch gates serving, not just a UI affordance: this check runs
  // before any published-data read, so a disabled embed never even calls
  // `getPublishedSchedule` (M33 work order guardrail). A live host page's
  // iframe should see a calm inert message at HTTP 200, never a 404.
  if (!(await isEmbedEnabled(event.id, "schedule_itinerary"))) {
    return (
      <PublicEventShell active="schedule" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="schedule" />
      </PublicEventShell>
    );
  }

  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicSchedule eventSlug={eventSlug} schedule={schedule} embed embedOptions={embedOptions} />;
}
