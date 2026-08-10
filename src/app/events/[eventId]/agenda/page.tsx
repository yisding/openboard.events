import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { detectConflicts, getSchedulableSessions, listAgendaVocabulary, listSessions } from "@/features/agenda";
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
 * (including the unscheduled rows), the vocabulary, the accepted abstracts, and
 * — critically — the conflict list computed **server-side** from
 * `getSchedulableSessions`. The client never recomputes overlaps for display, so
 * the tab badge, the grid and the Conflicts view all quote the same verdict.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const eventId = eventIdSchema.parse((await params).eventId);
  await requireAdmin(eventId, "reviewer");

  const query = await searchParams;
  const view = parseView(query.view);
  const day = parseDay(query.day);

  const event = (await db.execute<{ slug: string; timezone: string; starts_at: string | Date; ends_at: string | Date }>(sql`
    SELECT slug, timezone, starts_at, ends_at FROM events WHERE id = ${eventId}
  `)).rows?.[0];
  if (!event) notFound();

  const [sessions, schedulable, vocabulary, accepted] = await Promise.all([
    listSessions(eventId),
    // Day-scoped when a tab is selected, so a large conference does not compute
    // the whole conference's conflicts to paint one day.
    getSchedulableSessions(eventId, day),
    listAgendaVocabulary(eventId),
    getAcceptedForScheduling(eventId),
  ]);

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
      sessions={sessions}
      conflicts={detectConflicts(schedulable)}
      rooms={vocabulary.rooms}
      tracks={vocabulary.tracks}
      formats={vocabulary.formats}
      speakers={vocabulary.speakers}
      accepted={accepted}
    />
  );
}
