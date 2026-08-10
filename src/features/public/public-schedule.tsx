"use client";

import Link from "next/link";
import { CalendarPlus, Clock3, MapPin, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Dash } from "@/shared/ui/app/dash";
import { formatInZone, zoneAbbreviation } from "@/shared/lib/time";
import type { PublishedScheduleDTO, PublishedSessionDTO } from "@/shared/contracts";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";

// Client-side ICS download for a single session — no account needed.
function downloadSessionIcs(session: PublishedSessionDTO) {
  const utc = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "PRODID:-//Openboard//Public Schedule//EN", "VERSION:2.0", "BEGIN:VEVENT",
    `UID:${session.id}@openboard`, `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(session.startsAt)}`, `DTEND:${utc(session.endsAt)}`,
    `SUMMARY:${session.title.replaceAll(",", "\\,")}`,
    `LOCATION:${(session.room?.name ?? "").replaceAll(",", "\\,")}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([lines], { type: "text/calendar" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${session.id}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Noon-UTC pivot for a `YYYY-MM-DD` dayKey keeps the formatted label on the
// same calendar day in any timezone within +/-12h of UTC — the same trick
// time.ts's daysToEvent uses.
function dayLabel(dayKey: string, timezone: string): { weekday: string; date: string } {
  const pivot = `${dayKey}T12:00:00.000Z`;
  return {
    weekday: formatInZone(pivot, timezone, { weekday: "long" }),
    date: formatInZone(pivot, timezone, { month: "short", day: "numeric" }),
  };
}

function SessionDetail({ session, eventSlug }: { session: PublishedSessionDTO; eventSlug: string }) {
  return (
    <div className="session-detail">
      {session.descriptionHtml ? <RichTextView html={session.descriptionHtml} /> : <p className="session-detail-empty"><Dash /> No description yet.</p>}
      {session.speakers.length > 0 && (
        <ul className="session-detail-speakers">
          {session.speakers.map((speaker) => (
            <li key={speaker.contactId}>
              <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="md" />
              <Link href={`/e/${eventSlug}/speakers?speaker=${speaker.contactId}`}>{speaker.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PublicSchedule({
  eventSlug,
  schedule,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  initialSearch = "",
  initialExpandedSessionId = null,
}: {
  eventSlug: string;
  schedule: PublishedScheduleDTO;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  initialSearch?: string;
  initialExpandedSessionId?: string | null;
}) {
  const { event, days, sessions } = schedule;
  // If a deep-linked session was resolved server-side (or is found on the
  // initial client render before the effect below runs), start on *its*
  // day tab rather than always defaulting to days[0] — otherwise a
  // multi-day event's `?session=<id>` link (or a "Their sessions"
  // cross-link from the speaker gallery) silently renders nothing: the day
  // filter excludes the session's row entirely, so no amount of
  // `expandedId` matching can surface its accordion.
  const initialSession = initialExpandedSessionId
    ? sessions.find((item) => item.id === initialExpandedSessionId)
    : undefined;
  const [day, setDay] = useState<string | undefined>(initialSession?.dayKey ?? days[0]);
  const [search, setSearch] = useState(initialSearch);
  const [track, setTrack] = useState("All tracks");
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedSessionId);

  // Deep links (`?search=`, `?session=`) are read client-side, after
  // hydration, so the route itself never reads `searchParams` — that read is
  // what keeps this page eligible for `revalidate = 60` edge caching (see the
  // PR #71 fix this file inherits: a server-side searchParams read opts the
  // whole route into dynamic rendering).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("search") ?? initialSearch);
    const sessionParam = params.get("session");
    const matched = sessionParam
      ? sessions.find((item) => item.id === sessionParam || item.slug === sessionParam)
      : undefined;
    setExpandedId(matched ? matched.id : (initialExpandedSessionId ?? null));
    // Jump the active day tab to the deep-linked session's day so the
    // filtered list actually includes its row — without this, a session on
    // any day other than days[0] never renders regardless of expandedId.
    if (matched) setDay(matched.dayKey);
  }, [initialSearch, initialExpandedSessionId, sessions]);

  const tracks = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>();
    for (const session of sessions) if (session.track) map.set(session.track.id, session.track);
    return [...map.values()];
  }, [sessions]);

  const daySessions = useMemo(() => sessions.filter((session) => session.dayKey === day), [sessions, day]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return daySessions.filter((session) => {
      if (track !== "All tracks" && session.track?.name !== track) return false;
      if (!needle) return true;
      const haystack = `${session.title} ${session.track?.name ?? ""} ${session.speakers.map((s) => s.name).join(" ")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [daySessions, search, track]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PublishedSessionDTO[]>();
    for (const session of filtered) {
      const bucket = groups.get(session.startsAt) ?? [];
      bucket.push(session);
      groups.set(session.startsAt, bucket);
    }
    return [...groups.entries()];
  }, [filtered]);

  function toggleExpanded(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("session", next); else url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
  }

  const body = days.length === 0 ? (
    <div className="public-empty">
      <Star size={24} />
      <h3>Schedule coming soon</h3>
      <p>Sessions will appear here as soon as they&rsquo;re published.</p>
    </div>
  ) : (
    <>
      <div className="schedule-controls">
        <div className="public-day-tabs">
          {days.map((dayKey) => {
            const label = dayLabel(dayKey, event.timezone);
            return (
              <button key={dayKey} type="button" className={day === dayKey ? "active" : ""} onClick={() => setDay(dayKey)}>
                <b>{label.weekday}</b>
                <span>{label.date}</span>
              </button>
            );
          })}
        </div>
        <div className="public-filters">
          <label>
            <Search size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions or speakers" />
            {search && <button type="button" onClick={() => setSearch("")}><X size={14} /></button>}
          </label>
          {tracks.length > 0 && (
            <div>
              <SlidersHorizontal size={15} />
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                <option>All tracks</option>
                {tracks.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
      <section className="schedule-list">
        {grouped.map(([time, items]) => (
          <div className="schedule-time-group" key={time}>
            <time>{formatInZone(time, event.timezone, { hour: "numeric", minute: "2-digit" })}</time>
            <div>
              {items.map((session) => {
                const primary = session.speakers[0];
                const minutes = Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000);
                return (
                  <div key={session.id}>
                    <article onClick={() => toggleExpanded(session.id)} role="button" tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleExpanded(session.id)}>
                      <i className="session-stripe" style={{ background: session.track?.color ?? "var(--accent)" }} />
                      <div className="public-session-main">
                        <span>{session.track?.name ?? "General session"}</span>
                        <h3>{session.title}</h3>
                        {primary ? (
                          <div className="public-session-speaker">
                            <SpeakerAvatar name={primary.name} headshotUrl={primary.headshotUrl} size="sm" />
                            <b>{primary.name}{session.speakers.length > 1 ? ` +${session.speakers.length - 1}` : ""}</b>
                          </div>
                        ) : <div className="public-session-speaker"><small><Dash /></small></div>}
                      </div>
                      <div className="public-session-meta">
                        <span><Clock3 size={14} />{minutes > 0 ? minutes : 30} min</span>
                        <span><MapPin size={14} />{session.room ? session.room.name : <Dash />}</span>
                        <button type="button" title="Add to calendar" aria-label={`Add ${session.title} to calendar`}
                          onClick={(e) => { e.stopPropagation(); downloadSessionIcs(session); }}>
                          <CalendarPlus size={17} />
                        </button>
                      </div>
                    </article>
                    {expandedId === session.id && <SessionDetail session={session} eventSlug={eventSlug} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="public-empty">
            <Search size={24} />
            <h3>No sessions match those filters</h3>
            <button type="button" onClick={() => { setSearch(""); setTrack("All tracks"); }}>Clear filters</button>
          </div>
        )}
      </section>
      <div className="schedule-note">
        <Star size={17} />
        <div>
          <b>Schedule updates automatically</b>
          <p>Times and rooms can change — check back before the event for the latest program.</p>
        </div>
      </div>
    </>
  );

  return (
    <PublicEventShell active="schedule" eventSlug={eventSlug} event={event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-schedule ${embed ? "embed-content" : "public-event-container"}`}>
        <header>
          <div>
            <span className="public-eyebrow">EXPLORE THE PROGRAM</span>
            <h2>The full program,<br />session by session.</h2>
          </div>
          <p>
            Browse by day, search by title or speaker, and tap a session for the full description.
            {days.length > 0 && <> All times {zoneAbbreviation(event.startsAt, event.timezone)}.</>}
          </p>
        </header>
        {body}
      </main>
    </PublicEventShell>
  );
}
