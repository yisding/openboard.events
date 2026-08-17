"use client";

import Link from "next/link";
import { CalendarPlus, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { formatDayKeyInZone, formatInZone, formatTimeRangeInZone, zoneAbbreviation } from "@/shared/lib/time";
import type { PublishedScheduleDTO } from "@/shared/contracts";
import type { EmbedFilters } from "./embed-config-types";
import { readStarredIds, reconcileStarredIds, toggleStarredId, writeStarredIds } from "./itinerary-storage";
import { PublicComingSoon } from "./public-coming-soon";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";

function dayLabel(dayKey: string, timezone: string): { weekday: string; date: string } {
  return {
    weekday: formatDayKeyInZone(dayKey, timezone, { weekday: "long" }),
    date: formatDayKeyInZone(dayKey, timezone, { month: "short", day: "numeric" }),
  };
}

export function myScheduleEmptyCopy(starredCount: number): {
  title: string;
  description: string;
  hiddenByEmbed: boolean;
} {
  return starredCount > 0
    ? {
      title: "Your starred sessions are outside this embed",
      description: "This embed’s track, format, or location filters hide them. Open the full itinerary to see every starred session.",
      hiddenByEmbed: true,
    }
    : {
      title: "No starred sessions yet",
      description: "Browse the sessions in this embed and tap a star to add one to My schedule.",
      hiddenByEmbed: false,
    };
}

export function FilteredItineraryEmptyState({ eventSlug, starredCount }: { eventSlug: string; starredCount: number }) {
  const emptyCopy = myScheduleEmptyCopy(starredCount);
  const hasHiddenStars = emptyCopy.hiddenByEmbed;
  return (
    <PublicComingSoon
      icon={Star}
      title={hasHiddenStars ? emptyCopy.title : "No itinerary sessions match this embed"}
      description={hasHiddenStars
        ? emptyCopy.description
        : "Its configured track, format, or location filters currently exclude every published session. Ask the organizer to update the embed settings."}
      {...(hasHiddenStars ? { linkHref: `/e/${eventSlug}/itinerary`, linkLabel: "Open the full itinerary" } : {})}
    />
  );
}

/**
 * Schedule Itinerary — the M53 anonymous, no-account "My schedule": star any
 * number of sessions, persisted in `localStorage` keyed by event slug
 * (`itinerary-storage.ts`), with an exact "My schedule" filter and a
 * selected-sessions iCal export that goes through the shared `/schedule/ics`
 * route (M35's builder, not a second implementation). Sections are
 * chronological by day (not tabbed) — the whole point of this surface is
 * seeing your own program end to end.
 */
export function PublicItinerary({
  eventSlug,
  schedule,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  filters = {},
}: {
  eventSlug: string;
  schedule: PublishedScheduleDTO;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  filters?: EmbedFilters;
}) {
  const { event } = schedule;
  const showDescription = filters.fields?.description !== false;

  const sessions = useMemo(() => {
    const trackIds = filters.trackIds && filters.trackIds.length > 0 ? new Set(filters.trackIds) : null;
    const formatIds = filters.formatIds && filters.formatIds.length > 0 ? new Set(filters.formatIds) : null;
    const roomIds = filters.roomIds && filters.roomIds.length > 0 ? new Set(filters.roomIds) : null;
    return schedule.sessions
      .filter((session) => {
        if (trackIds && (!session.track || !trackIds.has(session.track.id))) return false;
        if (formatIds && (!session.format || !formatIds.has(session.format.id))) return false;
        if (roomIds && (!session.room || !roomIds.has(session.room.id))) return false;
        return true;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [schedule.sessions, filters.trackIds, filters.formatIds, filters.roomIds]);

  const [starred, setStarred] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [myScheduleOnly, setMyScheduleOnly] = useState(false);

  // Read on mount (client only — localStorage has no SSR value) and
  // reconcile against the currently *published* set: a starred session that
  // was later unpublished or deleted must silently drop out rather than
  // linger in the export or the count. Reconciles against `schedule.sessions`
  // (the full published set) and never against the filtered `sessions`
  // above — an embed-configured track/format/room filter narrows what this
  // view *displays*, not what counts as "still exists"; reconciling against
  // the filtered view would wrongly discard a star this same visitor made
  // through an unfiltered surface (or a differently-filtered embed).
  useEffect(() => {
    const publishedIds = new Set(schedule.sessions.map((session) => session.id));
    const stored = readStarredIds(eventSlug);
    const reconciled = reconcileStarredIds(stored, publishedIds);
    setStarred(reconciled);
    if (reconciled.length !== stored.length) writeStarredIds(eventSlug, reconciled);
    setHydrated(true);
  }, [eventSlug, schedule.sessions]);

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = toggleStarredId(prev, id);
      writeStarredIds(eventSlug, next);
      return next;
    });
  }

  const starredSet = useMemo(() => new Set(starred), [starred]);
  const visible = useMemo(() => (myScheduleOnly ? sessions.filter((session) => starredSet.has(session.id)) : sessions), [sessions, myScheduleOnly, starredSet]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof sessions>();
    for (const session of visible) {
      const bucket = groups.get(session.dayKey) ?? [];
      bucket.push(session);
      groups.set(session.dayKey, bucket);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const exportHref = starred.length > 0
    ? `/api/v1/events/${encodeURIComponent(eventSlug)}/schedule/ics?${starred.map((id) => `session=${encodeURIComponent(id)}`).join("&")}`
    : null;
  const emptyCopy = myScheduleEmptyCopy(starred.length);

  // See `public-sessions.tsx`: with nothing published there are no confirmed
  // speakers to send anyone to either, so this empty state offers no link.
  const body = schedule.sessions.length === 0 ? (
    <PublicComingSoon
      icon={Star}
      title="Schedule coming soon"
      description={`Sessions land closer to ${formatInZone(event.startsAt, event.timezone, { month: "long", day: "numeric" })} — come back then to star the ones you want.`}
    />
  ) : sessions.length === 0 ? (
    <FilteredItineraryEmptyState eventSlug={eventSlug} starredCount={hydrated ? starred.length : 0} />
  ) : (
    <>
      <div className="itinerary-toolbar">
        <button
          type="button"
          className={`itinerary-my-schedule ${myScheduleOnly ? "active" : ""}`}
          onClick={() => setMyScheduleOnly((v) => !v)}
          aria-pressed={myScheduleOnly}
        >
          <Star size={14} fill={myScheduleOnly ? "currentColor" : "none"} />
          My schedule {hydrated && starred.length > 0 ? `(${starred.length})` : ""}
        </button>
        {exportHref ? (
          <a className="itinerary-export" href={exportHref}>
            <CalendarPlus size={15} /> Export my schedule ({starred.length})
          </a>
        ) : (
          <span className="itinerary-export disabled">
            <CalendarPlus size={15} /> Star sessions to export
          </span>
        )}
      </div>
      {myScheduleOnly && visible.length === 0 && (
        <div className="public-empty">
          <Star size={24} />
          <h3>{emptyCopy.title}</h3>
          <p>{emptyCopy.description}</p>
          {emptyCopy.hiddenByEmbed ? (
            <Link className="button button-secondary" href={`/e/${eventSlug}/itinerary`} target="_blank" rel="noreferrer">Open the full itinerary</Link>
          ) : (
            <button type="button" onClick={() => setMyScheduleOnly(false)}>Browse sessions in this embed</button>
          )}
        </div>
      )}
      {grouped.map(([dayKey, items]) => {
        const label = dayLabel(dayKey, event.timezone);
        return (
          <section className="itinerary-day" key={dayKey}>
            <h3>{label.weekday} <span>{label.date}</span></h3>
            <div className="itinerary-sessions">
              {items.map((session) => {
                const primary = session.speakers[0];
                return (
                <article key={session.id} className={starredSet.has(session.id) ? "starred" : ""}>
                  <button
                    type="button"
                    className="itinerary-star"
                    onClick={() => toggleStar(session.id)}
                    aria-pressed={starredSet.has(session.id)}
                    aria-label={starredSet.has(session.id) ? `Remove ${session.title} from My schedule` : `Add ${session.title} to My schedule`}
                  >
                    <Star size={17} fill={starredSet.has(session.id) ? "currentColor" : "none"} />
                  </button>
                  <div>
                    <span className="itinerary-time">
                      {formatTimeRangeInZone(session.startsAt, session.endsAt, event.timezone)}
                      {session.room ? ` · ${session.room.name}` : ""}
                    </span>
                    <h4>{session.title}</h4>
                    {primary && (
                      <div className="public-session-speaker">
                        <SpeakerAvatar name={primary.name} headshotUrl={primary.headshotUrl} size="sm" />
                        <b>
                          <Link href={`/e/${eventSlug}/speakers?speaker=${primary.contactId}`}>{primary.name}</Link>
                          {session.speakers.length > 1 ? ` +${session.speakers.length - 1}` : ""}
                        </b>
                      </div>
                    )}
                    {showDescription && session.descriptionHtml && <RichTextView html={session.descriptionHtml} className="itinerary-desc" />}
                  </div>
                </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );

  return (
    <PublicEventShell active="itinerary" eventSlug={eventSlug} event={event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-schedule ${embed ? "embed-content" : "public-event-container"}`}>
        <header>
          <div>
            <span className="public-eyebrow">BUILD YOUR DAY</span>
            <h2>Star your sessions,<br />export your schedule.</h2>
          </div>
          <p>
            No account needed — star sessions to build My schedule on this device, then export it to your calendar.
            {sessions.length > 0 && <> All times {zoneAbbreviation(event.startsAt, event.timezone)}.</>}
          </p>
        </header>
        {body}
      </main>
    </PublicEventShell>
  );
}
