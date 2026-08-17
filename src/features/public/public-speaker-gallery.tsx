"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Globe, Linkedin, Search, Twitter, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { formatInZone } from "@/shared/lib/time";
import type { PublishedSpeakerDTO, PublishedSpeakersDTO } from "@/shared/contracts";
import type { EmbedFilters } from "./embed-config-types";
import { PublicComingSoon } from "./public-coming-soon";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";
import { matchesPublicSpeakerSearch, publicSpeakerPlainText } from "./speaker-search";

// The gallery card's bio teaser is plain text, not rendered HTML — bioHtml can
// carry headings/lists that would break a fixed-height card, and `<small>` is
// a phrasing element that should never contain block markup. The full bio
// still renders through `<RichTextView>` on the speaker-detail panel below.
function SpeakerDetail({
  speaker, event, eventSlug, showBio, onBack, headingRef,
}: { speaker: PublishedSpeakerDTO; event: PublishedSpeakersDTO["event"]; eventSlug: string; showBio: boolean; onBack: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="speaker-detail">
      <button type="button" className="speaker-detail-back" onClick={onBack}><ArrowLeft size={14} /> Back to all speakers</button>
      <div className="speaker-detail-hero">
        <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="xl" />
        <div>
          <h2 ref={headingRef} tabIndex={-1}>{speaker.name}</h2>
          {(speaker.jobTitle || speaker.company) && <p>{[speaker.jobTitle, speaker.company].filter(Boolean).join(" · ")}</p>}
          {(speaker.linkedinUrl || speaker.twitterUrl || speaker.websiteUrl) && (
            <div className="speaker-detail-links">
              {speaker.linkedinUrl && <a href={speaker.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin size={15} /> LinkedIn</a>}
              {speaker.twitterUrl && <a href={speaker.twitterUrl} target="_blank" rel="noreferrer"><Twitter size={15} /> Twitter</a>}
              {speaker.websiteUrl && <a href={speaker.websiteUrl} target="_blank" rel="noreferrer"><Globe size={15} /> Website</a>}
            </div>
          )}
        </div>
      </div>
      {showBio && speaker.bioHtml && <RichTextView html={speaker.bioHtml} />}
      {speaker.sessions.length > 0 && (
        <>
          <h3>Their sessions</h3>
          <ul className="speaker-detail-sessions">
            {speaker.sessions.map((session) => (
              <li key={session.id}>
                <Link href={`/e/${eventSlug}/agenda?session=${session.id}`}>
                  <span>
                    {formatInZone(session.startsAt, event.timezone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {session.room ? ` · ${session.room.name}` : ""}
                  </span>
                  <b>{session.title}</b>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Speaker Gallery — the M53 photo-forward surface: a surname-sorted (the
 * server query's own `ORDER BY last_name`), searchable card grid with a
 * headshot-or-initials fallback per card, and a full profile panel that
 * carries each session's time and room. Field visibility (`showCompany`,
 * `showBio`) is the only embed-configurable knob here; ids-based filtering
 * belongs to the session-shaped surfaces, not speakers.
 */
export function PublicSpeakerGallery({
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
  /** See `PublicSpeakersList` — the empty state only links to a live agenda. */
  hasSessions?: boolean;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  filters?: EmbedFilters;
  initialSpeakerId?: string | null;
}) {
  const showCompany = filters.fields?.speakerCompany !== false;
  const showBio = filters.fields?.speakerBio !== false;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSpeakerId);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());

  // Same deep-link contract as every other public surface: read after
  // hydration so the route stays cacheable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const speakerParam = params.get("speaker");
    setSelectedId(speakerParam && speakers.speakers.some((item) => item.contactId === speakerParam) ? speakerParam : (initialSpeakerId ?? null));
  }, [initialSpeakerId, speakers.speakers]);

  useEffect(() => {
    if (!selectedId) return;
    const frame = window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  const filtered = useMemo(() => {
    return speakers.speakers.filter((speaker) => matchesPublicSpeakerSearch(speaker, search));
  }, [speakers.speakers, search]);

  function select(id: string | null) {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("speaker", id); else url.searchParams.delete("speaker");
      window.history.replaceState(null, "", url);
    }
  }

  function showGallery() {
    const returningTo = selectedId;
    select(null);
    if (returningTo) window.requestAnimationFrame(() => cardButtons.current.get(returningTo)?.focus());
  }

  const selected = selectedId ? speakers.speakers.find((item) => item.contactId === selectedId) : undefined;

  return (
    <PublicEventShell active="gallery" eventSlug={eventSlug} event={speakers.event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-speakers ${embed ? "embed-content" : "public-event-container"}`}>
        {selected ? (
          <SpeakerDetail speaker={selected} event={speakers.event} eventSlug={eventSlug} showBio={showBio} onBack={showGallery} headingRef={detailHeadingRef} />
        ) : (
          <>
            <header>
              <div>
                <span className="public-eyebrow">MEET THE SPEAKERS</span>
                <h2>People shaping<br />what comes next.</h2>
              </div>
              <p>Confirmed speakers for this event — search by name, company, or topic.</p>
            </header>
            {speakers.speakers.length === 0 ? (
              <PublicComingSoon
                icon={Search}
                title="Speakers coming soon"
                description={hasSessions
                  ? "Confirmed speakers will appear here as they’re announced — the agenda already has sessions to browse."
                  : "Confirmed speakers will appear here as they’re announced."}
                {...(hasSessions ? { linkHref: `/e/${eventSlug}/agenda`, linkLabel: "View the agenda" } : {})}
              />
            ) : (
              <>
                <label className="speaker-search">
                  <Search size={18} />
                  <input aria-label="Search speakers, companies, or topics" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, or topic" />
                  {search && <button type="button" aria-label="Clear speaker search" onClick={() => setSearch("")}><X size={15} /></button>}
                </label>
                <div className="speaker-gallery">
                  {filtered.map((speaker, index) => (
                    <article key={speaker.contactId} className={index === 0 && !embed ? "featured" : ""}>
                      <div className="speaker-portrait">
                        <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="xl" />
                      </div>
                      <div>
                        <button
                          ref={(node) => { if (node) cardButtons.current.set(speaker.contactId, node); else cardButtons.current.delete(speaker.contactId); }}
                          type="button"
                          aria-label={`View profile for ${speaker.name}`}
                          onClick={() => select(speaker.contactId)}
                          style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}
                        >
                          <h3>{speaker.name}</h3>
                          {(speaker.jobTitle || (showCompany && speaker.company)) && (
                            <p>{[speaker.jobTitle, showCompany ? speaker.company : null].filter(Boolean).join(" · ")}</p>
                          )}
                          {showBio && speaker.bioHtml && <small>{publicSpeakerPlainText(speaker.bioHtml)}</small>}
                        </button>
                        <footer>
                          <Link href={`/e/${eventSlug}/sessions?search=${encodeURIComponent(speaker.name)}`} onClick={(e) => e.stopPropagation()}>
                            View sessions <ArrowRight size={14} />
                          </Link>
                        </footer>
                      </div>
                    </article>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <div className="public-empty">
                    <Search size={24} />
                    <h3>No speakers match that search</h3>
                    <button type="button" onClick={() => setSearch("")}>Clear search</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </PublicEventShell>
  );
}
