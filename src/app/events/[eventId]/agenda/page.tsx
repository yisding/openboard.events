import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agendaKeys, getAnnounceBundle, listAgendaVocabulary, listSessions } from "@/features/agenda";
import { AgendaPage } from "@/features/agenda/index.client";
import { parseDay, parseView } from "@/features/agenda/store";
import { requireAdmin } from "@/features/auth";
// M18 owns every read of `submissions`; the tray only filters on `alreadyPromoted`.
import { getAcceptedForScheduling } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

/**
 * The agenda's server entry point.
 *
 * Everything the six views need is read here, once: the full session list
 * (including the unscheduled rows), the vocabulary, and the query-owned
 * accepted/announcement reads. Conflicts are a pure derivation of the live
 * session cache, so every view updates together.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // Organizer, matching the layout's guard for this path — the reviewer bar
  // that used to be here let a reviewer soft-navigate in from `/review`, which
  // no longer re-runs the layout.
  await requireAdmin(eventId, "organizer");

  const query = await searchParams;
  const view = parseView(query.view);
  const day = parseDay(query.day);

  const event = (await db.execute<{ slug: string; timezone: string; starts_at: string | Date; ends_at: string | Date }>(sql`
    SELECT slug, timezone, starts_at, ends_at FROM events WHERE id = ${eventId}
  `)).rows?.[0];
  if (!event) notFound();

  const [sessions, vocabulary, accepted, announceBundle] = await Promise.all([
    listSessions(eventId),
    listAgendaVocabulary(eventId),
    getAcceptedForScheduling(eventId),
    // M60 — the "ready to announce" trigger; cheap to compute even when
    // nothing is published yet (it just reports `hasPublishedSchedule: false`).
    getAnnounceBundle(eventId),
  ]);
  const querySeeds = [
    { queryKey: agendaKeys.sessions(eventId), data: sessions },
    { queryKey: agendaKeys.accepted(eventId), data: accepted },
    { queryKey: agendaKeys.announceBundle(eventId), data: announceBundle },
  ];

  return (
    <AgendaPage
      eventId={eventId}
      eventSlug={event.slug}
      view={view}
      day={day}
      event={{
        timezone: event.timezone,
        startsAt: new Date(event.starts_at).toISOString(),
        endsAt: new Date(event.ends_at).toISOString(),
      }}
      rooms={vocabulary.rooms}
      tracks={vocabulary.tracks}
      formats={vocabulary.formats}
      speakers={vocabulary.speakers}
      querySeeds={querySeeds}
    />
  );
}
