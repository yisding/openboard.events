import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent } from "@/features/events";
import { AIRTABLE_COPY, getAirtableConnection, listSyncRuns } from "@/features/airtable";
import { AirtableSettingsPanel } from "@/features/airtable/index.client";
import { PageHeader } from "@/shared/ui/ui-kit";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: AIRTABLE_COPY.page.title };
export const dynamic = "force-dynamic";

/**
 * Its own route file, the same call the API keys page makes: a surface with
 * credential entry, run history and a manual trigger wants its own URL and its
 * own data fetch rather than another branch of the `/settings` tab shell.
 */
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;

  const eventId = eventIdSchema.parse(rawEventId);
  // The layout runs the same guard, but it does not re-run on a client-side
  // navigation between sibling settings segments, so the page holds the bar
  // itself before it reads any connection metadata.
  await requireAdmin(eventId, "organizer");
  const [event, connection, runs] = await Promise.all([
    getEvent(eventId),
    getAirtableConnection(eventId),
    listSyncRuns(eventId, 10),
  ]);
  if (!event) notFound();

  return (
    <>
      <PageHeader
        eyebrow={AIRTABLE_COPY.page.eyebrow}
        title={AIRTABLE_COPY.page.title}
        description={AIRTABLE_COPY.page.description}
      />
      <AirtableSettingsPanel
        eventId={eventId}
        eventName={event.name}
        timezone={event.timezone}
        initialConnection={connection}
        initialRuns={runs}
      />
    </>
  );
}
