"use client";

import Link from "next/link";
import { ChevronDown, Globe, Linkedin, Search, Twitter, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { formatInZone } from "@/shared/lib/time";
import type { PublishedSpeakersDTO } from "@/shared/contracts";
import type { EmbedFilters } from "./embed-config-types";
import { PublicComingSoon } from "./public-coming-soon";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";
import { matchesPublicSpeakerSearch } from "./speaker-search";

/**
 * Speakers List — the M53 compact, surname-sorted directory: rows, not
 * photo cards, each expanding in place (parent list stays put) into bio +
 * session time/room detail. The photo-forward equivalent is the Speaker
 * Gallery; this surface is the scan-a-long-roster one.
 */
export function PublicSpeakersList({
  eventSlug,
  speakers,
  hasSessions = false,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  filters = {},
  initialSpeakerId = null,
}: {
  eventSlug: string;
  speakers: PublishedSpeakersDTO;
  /**
   * Whether the agenda has anything published. The roster's empty state only
   * offers "View the agenda" when it is a live destination — on a brand-new
   * event both surfaces are empty and the cross-links become a loop of dead
   * ends. Defaults to no link, which is the honest answer when unknown.
   */
  hasSessions?: boolean;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  filters?: EmbedFilters;
  initialSpeakerId?: string | null;
}) {
  const showCompany = filters.fields?.speakerCompany !== false;
  const showBio = filters.fields?.speakerBio !== false;
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(initialSpeakerId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const speakerParam = params.get("speaker");
    setExpandedId(speakerParam && speakers.speakers.some((item) => item.contactId === speakerParam) ? speakerParam : (initialSpeakerId ?? null));
  }, [initialSpeakerId, speakers.speakers]);

  const filtered = useMemo(() => {
    return speakers.speakers.filter((speaker) => matchesPublicSpeakerSearch(speaker, search));
  }, [speakers.speakers, search]);

  function toggle(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("speaker", next); else url.searchParams.delete("speaker");
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <PublicEventShell active="speakers" eventSlug={eventSlug} event={speakers.event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-speakers ${embed ? "embed-content" : "public-event-container"}`}>
        <header>
          <div>
            <span className="public-eyebrow">THE FULL ROSTER</span>
            <h2>Every confirmed<br />speaker, A to Z.</h2>
          </div>
          <p>Sorted by last name — search by name, company, or topic.</p>
        </header>
        {speakers.speakers.length === 0 ? (
          <PublicComingSoon
            icon={Search}
            title="Speakers coming soon"
            description={hasSessions
              ? "Confirmed speakers will appear here as they're announced — the agenda already has sessions to browse."
              : "Confirmed speakers will appear here as they're announced."}
            {...(hasSessions ? { linkHref: `/e/${eventSlug}/agenda`, linkLabel: "View the agenda" } : {})}
          />
        ) : (
          <>
            <label className="speaker-search">
              <Search size={18} />
              <input aria-label="Search speakers, companies, or topics" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, or topic" />
              {search && <button type="button" aria-label="Clear speaker search" onClick={() => setSearch("")}><X size={15} /></button>}
            </label>
            <ul className="speakers-list">
              {filtered.map((speaker) => {
                const expanded = expandedId === speaker.contactId;
                return (
                  <li key={speaker.contactId} className={expanded ? "expanded" : ""}>
                    <button type="button" className="speaker-row" onClick={() => toggle(speaker.contactId)} aria-expanded={expanded}>
                      <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="md" />
                      <span className="speaker-row-name">
                        <b>{speaker.name}</b>
                        {(speaker.jobTitle || (showCompany && speaker.company)) && (
                          <small>{[speaker.jobTitle, showCompany ? speaker.company : null].filter(Boolean).join(" · ")}</small>
                        )}
                      </span>
                      <ChevronDown size={16} className={expanded ? "flipped" : ""} />
                    </button>
                    {expanded && (
                      <div className="speaker-row-detail">
                        {(speaker.linkedinUrl || speaker.twitterUrl || speaker.websiteUrl) && (
                          <div className="speaker-detail-links">
                            {speaker.linkedinUrl && <a href={speaker.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin size={15} /> LinkedIn</a>}
                            {speaker.twitterUrl && <a href={speaker.twitterUrl} target="_blank" rel="noreferrer"><Twitter size={15} /> Twitter</a>}
                            {speaker.websiteUrl && <a href={speaker.websiteUrl} target="_blank" rel="noreferrer"><Globe size={15} /> Website</a>}
                          </div>
                        )}
                        {showBio && speaker.bioHtml && <RichTextView html={speaker.bioHtml} />}
                        {speaker.sessions.length > 0 && (
                          <ul className="speaker-detail-sessions">
                            {speaker.sessions.map((session) => (
                              <li key={session.id}>
                                <Link href={`/e/${eventSlug}/agenda?session=${session.id}`}>
                                  <span>
                                    {formatInZone(session.startsAt, speakers.event.timezone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                    {session.room ? ` · ${session.room.name}` : ""}
                                  </span>
                                  <b>{session.title}</b>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {filtered.length === 0 && (
              <div className="public-empty">
                <Search size={24} />
                <h3>No speakers match that search</h3>
                <button type="button" onClick={() => setSearch("")}>Clear search</button>
              </div>
            )}
          </>
        )}
      </main>
    </PublicEventShell>
  );
}
