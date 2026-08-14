"use client";

import Link from "next/link";
import { CalendarPlus, Clock3, MapPin, Radio, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { formatDayKeyInZone, formatInZone, zoneAbbreviation } from "@/shared/lib/time";
import type { PublishedScheduleDTO, PublishedSessionDTO } from "@/shared/contracts";
import { computeLiveHighlight, EMPTY_LIVE_HIGHLIGHT, type LiveHighlight } from "./live-highlight";
import { PublicComingSoon } from "./public-coming-soon";
import type { EmbedFilters } from "./embed-config-types";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";

/** How often the live highlight re-checks the clock. A minute is "alive", not "chatty". */
const LIVE_REFRESH_MS = 60_000;

/**
 * M60 — "Happening now / up next," computed on a client-only timer so the
 * server-rendered (edge-cached) HTML never carries a highlight a CDN would
 * then serve stale. Starting from `EMPTY_LIVE_HIGHLIGHT` (nothing marked)
 * matches what the server rendered, so the first client render after
 * hydration is not a mismatch — the real value lands one effect tick later.
 */
function useLiveHighlight(sessions: ReadonlyArray<{ id: string; startsAt: string; endsAt: string }>): LiveHighlight {
  const [highlight, setHighlight] = useState<LiveHighlight>(EMPTY_LIVE_HIGHLIGHT);
  useEffect(() => {
    const tick = () => setHighlight(computeLiveHighlight(sessions, new Date()));
    tick();
    const interval = setInterval(tick, LIVE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [sessions]);
  return highlight;
}

function dayLabel(dayKey: string, timezone: string): { weekday: string; date: string } {
  return {
    weekday: formatDayKeyInZone(dayKey, timezone, { weekday: "long" }),
    date: formatDayKeyInZone(dayKey, timezone, { month: "short", day: "numeric" }),
  };
}

function SessionDetail({ session, eventSlug }: { session: PublishedSessionDTO; eventSlug: string }) {
  return (
    <div className="session-detail">
      {session.descriptionHtml && <RichTextView html={session.descriptionHtml} />}
      {session.speakers.length > 0 && (
        <ul className="session-detail-speakers">
          {session.speakers.map((speaker) => (
            <li key={speaker.contactId}>
              <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="md" />
              <span>
                <Link href={`/e/${eventSlug}/speakers?speaker=${speaker.contactId}`}>{speaker.name}</Link>
                {(speaker.jobTitle || speaker.company) && (
                  <small>{[speaker.jobTitle, speaker.company].filter(Boolean).join(" · ")}</small>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hasPublicSessionDetail(session: PublishedSessionDTO): boolean {
  return Boolean(session.descriptionHtml) || session.speakers.length > 0;
}

/**
 * Agenda — the M53 day/time/room structural surface: day navigation, a
 * chronological time grid with room shown as a first-class column, and a
 * reversible per-session detail that never loses the active day when you
 * expand or collapse a row. Search/track/format/location filters live on the
 * Sessions List instead, which is what keeps the two surfaces visibly
 * distinct rather than the same list wearing two skins.
 */
export function PublicAgenda({
  eventSlug,
  schedule,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  filters = {},
  initialExpandedSessionId = null,
}: {
  eventSlug: string;
  schedule: PublishedScheduleDTO;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  filters?: EmbedFilters;
  initialExpandedSessionId?: string | null;
}) {
  const { event } = schedule;

  const sessions = useMemo(() => {
    const trackIds = filters.trackIds && filters.trackIds.length > 0 ? new Set(filters.trackIds) : null;
    const formatIds = filters.formatIds && filters.formatIds.length > 0 ? new Set(filters.formatIds) : null;
    const roomIds = filters.roomIds && filters.roomIds.length > 0 ? new Set(filters.roomIds) : null;
    return schedule.sessions.filter((session) => {
      if (trackIds && (!session.track || !trackIds.has(session.track.id))) return false;
      if (formatIds && (!session.format || !formatIds.has(session.format.id))) return false;
      if (roomIds && (!session.room || !roomIds.has(session.room.id))) return false;
      return true;
    });
  }, [schedule.sessions, filters.trackIds, filters.formatIds, filters.roomIds]);

  const days = useMemo(() => [...new Set(sessions.map((session) => session.dayKey))].sort(), [sessions]);
  const live = useLiveHighlight(sessions);

  const initialSession = initialExpandedSessionId ? sessions.find((item) => item.id === initialExpandedSessionId) : undefined;
  const [day, setDay] = useState<string | undefined>(initialSession?.dayKey ?? days[0]);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialSession && hasPublicSessionDetail(initialSession) ? initialSession.id : null,
  );

  // Same after-hydration deep-link contract as every other public surface
  // (keeps the route cacheable — see the sessions list's identical comment).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    const matched = sessionParam ? sessions.find((item) => item.id === sessionParam || item.slug === sessionParam) : undefined;
    const fallback = initialExpandedSessionId ? sessions.find((item) => item.id === initialExpandedSessionId) : undefined;
    let nextExpandedId: string | null = null;
    if (matched && hasPublicSessionDetail(matched)) nextExpandedId = matched.id;
    if (!matched && fallback && hasPublicSessionDetail(fallback)) nextExpandedId = fallback.id;
    setExpandedId(nextExpandedId);
    if (matched) setDay(matched.dayKey);
  }, [initialExpandedSessionId, sessions]);

  const daySessions = useMemo(() => sessions.filter((session) => session.dayKey === day), [sessions, day]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PublishedSessionDTO[]>();
    for (const session of daySessions) {
      const bucket = groups.get(session.startsAt) ?? [];
      bucket.push(session);
      groups.set(session.startsAt, bucket);
    }
    return [...groups.entries()];
  }, [daySessions]);

  function selectDay(next: string) {
    setDay(next);
    // Parent state (the active day) is preserved across an expand/collapse,
    // but switching days deliberately collapses any open detail — its
    // session is no longer even in view.
    setExpandedId(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
  }

  function toggleExpanded(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("session", next); else url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
  }

  const dayTabs = days.length > 0 ? (
    <div className="public-day-tabs" role="group" aria-label="Agenda days">
      {days.map((dayKey) => {
        const label = dayLabel(dayKey, event.timezone);
        return (
          <button key={dayKey} type="button" aria-pressed={day === dayKey} className={day === dayKey ? "active" : ""} onClick={() => selectDay(dayKey)}>
            <b>{label.weekday}</b>
            <span>{label.date}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  const body = schedule.sessions.length === 0 ? (
    <PublicComingSoon
      icon={Star}
      title="Agenda coming soon"
      description={`The day-by-day program lands closer to ${formatInZone(event.startsAt, event.timezone, { month: "long", day: "numeric" })} — meet the confirmed speakers meanwhile.`}
      linkHref={`/e/${eventSlug}/speakers`}
      linkLabel="Speaker gallery"
    />
  ) : sessions.length === 0 ? (
    <PublicComingSoon
      icon={Star}
      title="No agenda sessions match this embed"
      description="Its configured track, format, or location filters currently exclude every published session. Ask the organizer to update the embed settings."
    />
  ) : (
    <div className="schedule-controls">
      {embed && dayTabs}
      <section className="schedule-list">
          {grouped.map(([time, items]) => (
            <div className="schedule-time-group" key={time}>
              <time>{formatInZone(time, event.timezone, { hour: "numeric", minute: "2-digit" })}</time>
              <div>
                {items.map((session) => {
                  const primary = session.speakers[0];
                  const isLiveNow = live.nowSessionIds.has(session.id);
                  const isUpNext = live.nextSessionId === session.id;
                  const hasDetails = hasPublicSessionDetail(session);
                  const detailId = `session-${session.id}-details`;
                  return (
                    <div key={session.id}>
                      <article
                        className={[
                          isLiveNow ? "session-live-now" : isUpNext ? "session-up-next" : "",
                          hasDetails ? "session-has-details" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={hasDetails ? () => toggleExpanded(session.id) : undefined}>
                        <i className="session-stripe" style={{ background: session.track?.color ?? "var(--accent)" }} />
                        <div className="public-session-main">
                          <span>
                            {session.room ? session.room.name : "General session"}
                            {isLiveNow && <em className="live-now-badge"><Radio size={10} /> Happening now</em>}
                            {!isLiveNow && isUpNext && <em className="up-next-badge">Up next</em>}
                          </span>
                          <h3>{hasDetails
                            ? <button type="button" aria-expanded={expandedId === session.id} aria-controls={detailId} onClick={(event) => { event.stopPropagation(); toggleExpanded(session.id); }}>{session.title}</button>
                            : session.title}</h3>
                          {primary && (
                            <div className="public-session-speaker">
                              <SpeakerAvatar name={primary.name} headshotUrl={primary.headshotUrl} size="sm" />
                              <b>{primary.name}{session.speakers.length > 1 ? ` +${session.speakers.length - 1}` : ""}</b>
                            </div>
                          )}
                        </div>
                        <div className="public-session-meta">
                          <span><Clock3 size={14} />{Math.max(1, Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000))} min</span>
                          {session.room && <span><MapPin size={14} />{session.room.name}</span>}
                          <a className="public-calendar-link" title="Add to calendar" aria-label={`Add ${session.title} to calendar`}
                            href={`/api/v1/events/${encodeURIComponent(eventSlug)}/schedule/ics?session=${encodeURIComponent(session.id)}`}
                            onClick={(e) => e.stopPropagation()}>
                            <CalendarPlus size={17} />
                          </a>
                        </div>
                      </article>
                      {hasDetails && expandedId === session.id && <div id={detailId}><SessionDetail session={session} eventSlug={eventSlug} /></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </section>
    </div>
  );

  return (
    <PublicEventShell active="agenda" eventSlug={eventSlug} event={event} embed={embed} embedOptions={embedOptions} heroControls={!embed ? dayTabs : null}>
      <main className={`public-schedule ${embed ? "embed-content" : "public-event-container"}`}>
        <header>
          <div>
            <span className="public-eyebrow">DAY BY DAY</span>
            <h2>The full agenda,<br />room by room.</h2>
          </div>
          <p>
            Browse by day and tap a session for the full detail.
            {days.length > 0 && <> All times {zoneAbbreviation(event.startsAt, event.timezone)}.</>}
          </p>
        </header>
        {body}
      </main>
    </PublicEventShell>
  );
}
