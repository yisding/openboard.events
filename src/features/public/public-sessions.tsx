"use client";

import Link from "next/link";
import { CalendarPlus, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Dash } from "@/shared/ui/app/dash";
import { formatInZone, zoneAbbreviation } from "@/shared/lib/time";
import type { PublishedScheduleDTO, PublishedSessionDTO } from "@/shared/contracts";
import type { EmbedFilters } from "./embed-config-types";
import { PublicComingSoon } from "./public-coming-soon";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";

const ALL = "All";

function dayLabel(dayKey: string, timezone: string): string {
  const pivot = `${dayKey}T12:00:00.000Z`;
  return formatInZone(pivot, timezone, { weekday: "short", month: "short", day: "numeric" });
}

function speakerIdentity(speaker: PublishedSessionDTO["speakers"][number]): string {
  const parts = [speaker.jobTitle, speaker.company].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "";
}

/**
 * Sessions List — the M53 surface built for search/filter over full speaker
 * identity, distinct from the Agenda's day/time/room structure: no day tabs,
 * every session is a self-contained card so Track/Format/Location filters
 * can narrow the whole event at once instead of one day at a time.
 */
export function PublicSessions({
  eventSlug,
  schedule,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  filters = {},
  initialSearch = "",
}: {
  eventSlug: string;
  schedule: PublishedScheduleDTO;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  filters?: EmbedFilters;
  initialSearch?: string;
}) {
  const { event, sessions: allSessions } = schedule;
  const showDescription = filters.fields?.description !== false;
  const showCompany = filters.fields?.speakerCompany !== false;

  const sessions = useMemo(() => {
    const trackIds = filters.trackIds && filters.trackIds.length > 0 ? new Set(filters.trackIds) : null;
    const formatIds = filters.formatIds && filters.formatIds.length > 0 ? new Set(filters.formatIds) : null;
    const roomIds = filters.roomIds && filters.roomIds.length > 0 ? new Set(filters.roomIds) : null;
    return allSessions.filter((session) => {
      if (trackIds && (!session.track || !trackIds.has(session.track.id))) return false;
      if (formatIds && (!session.format || !formatIds.has(session.format.id))) return false;
      if (roomIds && (!session.room || !roomIds.has(session.room.id))) return false;
      return true;
    });
  }, [allSessions, filters.trackIds, filters.formatIds, filters.roomIds]);

  const [search, setSearch] = useState(initialSearch);
  const [track, setTrack] = useState(ALL);
  const [format, setFormat] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Same deep-link contract as every other public surface: read the search
  // query after hydration so this route stays revalidate-60 cacheable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("search") ?? initialSearch);
  }, [initialSearch]);

  const tracks = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) if (session.track) map.set(session.track.id, session.track.name);
    return [...map.values()].sort();
  }, [sessions]);
  const formats = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) if (session.format) map.set(session.format.id, session.format.name);
    return [...map.values()].sort();
  }, [sessions]);
  const locations = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) if (session.room) map.set(session.room.id, session.room.name);
    return [...map.values()].sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sessions
      .filter((session) => {
        if (track !== ALL && session.track?.name !== track) return false;
        if (format !== ALL && session.format?.name !== format) return false;
        if (location !== ALL && session.room?.name !== location) return false;
        if (!needle) return true;
        const haystack = `${session.title} ${session.track?.name ?? ""} ${session.speakers.map((s) => s.name).join(" ")}`.toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [sessions, search, track, format, location]);

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const body = allSessions.length === 0 ? (
    <PublicComingSoon
      icon={Search}
      title="Sessions coming soon"
      description={`The program lands closer to ${formatInZone(event.startsAt, event.timezone, { month: "long", day: "numeric" })} — meet the confirmed speakers meanwhile.`}
      linkHref={`/e/${eventSlug}/speakers`}
      linkLabel="Speaker gallery"
    />
  ) : (
    <>
      <div className="sessions-filters">
        <label>
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions or speakers" />
          {search && <button type="button" onClick={() => setSearch("")}><X size={14} /></button>}
        </label>
        {tracks.length > 0 && (
          <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Filter by track">
            <option value={ALL}>All tracks</option>
            {tracks.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {formats.length > 0 && (
          <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Filter by format">
            <option value={ALL}>All formats</option>
            {formats.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {locations.length > 0 && (
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Filter by location">
            <option value={ALL}>All locations</option>
            {locations.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>
      <div className="sessions-grid">
        {filtered.map((session) => {
          const expanded = expandedId === session.id;
          return (
            <article key={session.id} className={`session-card ${expanded ? "expanded" : ""}`}>
              <i className="session-stripe" style={{ background: session.track?.color ?? "var(--accent)" }} />
              <div className="session-card-body">
                <span className="session-card-eyebrow">
                  {session.track?.name ?? "General session"}{session.format ? ` · ${session.format.name}` : ""}
                </span>
                <h3>{session.title}</h3>
                <div className="session-card-meta">
                  <span>{dayLabel(session.dayKey, event.timezone)} · {formatInZone(session.startsAt, event.timezone, { hour: "numeric", minute: "2-digit" })}</span>
                  <span>{session.room ? session.room.name : <Dash />}</span>
                </div>
                {session.speakers.length > 0 && (
                  <ul className="session-card-speakers">
                    {session.speakers.map((speaker) => (
                      <li key={speaker.contactId}>
                        <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="sm" />
                        <span>
                          <Link href={`/e/${eventSlug}/speakers?speaker=${speaker.contactId}`}>{speaker.name}</Link>
                          {showCompany && speakerIdentity(speaker) && <small>{speakerIdentity(speaker)}</small>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {showDescription && (
                  <>
                    {session.descriptionHtml ? (
                      <div className={`session-card-desc ${expanded ? "" : "truncated"}`}><RichTextView html={session.descriptionHtml} /></div>
                    ) : (
                      <p className="session-detail-empty"><Dash /> No description yet.</p>
                    )}
                    {session.descriptionHtml && (
                      <button type="button" className="session-card-toggle" onClick={() => toggleExpanded(session.id)}>
                        {expanded ? "Show less" : "Read more"} <ChevronDown size={13} className={expanded ? "flipped" : ""} />
                      </button>
                    )}
                  </>
                )}
              </div>
              <a
                className="session-card-cal"
                title="Add to calendar"
                aria-label={`Add ${session.title} to calendar`}
                href={`/api/v1/events/${encodeURIComponent(eventSlug)}/schedule/ics?session=${encodeURIComponent(session.id)}`}
              >
                <CalendarPlus size={15} />
              </a>
            </article>
          );
        })}
        {filtered.length === 0 && (
          <div className="public-empty">
            <Search size={24} />
            <h3>No sessions match those filters</h3>
            <button type="button" onClick={() => { setSearch(""); setTrack(ALL); setFormat(ALL); setLocation(ALL); }}>Clear filters</button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <PublicEventShell active="sessions" eventSlug={eventSlug} event={event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-schedule ${embed ? "embed-content" : "public-event-container"}`}>
        <header>
          <div>
            <span className="public-eyebrow">EXPLORE THE PROGRAM</span>
            <h2>Every session,<br />search and filter.</h2>
          </div>
          <p>
            Search by title or speaker, then narrow by track, format, or location.
            {allSessions.length > 0 && <> All times {zoneAbbreviation(event.startsAt, event.timezone)}.</>}
          </p>
        </header>
        {body}
      </main>
    </PublicEventShell>
  );
}
