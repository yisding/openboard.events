"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Globe, Linkedin, Search, Twitter, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dash } from "@/shared/ui/app/dash";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { formatInZone } from "@/shared/lib/time";
import type { PublishedSpeakerDTO, PublishedSpeakersDTO } from "@/shared/contracts";
import { SpeakerAvatar } from "./speaker-avatar";
import { PublicEventShell, DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "./public-event-shell";

// The gallery card's bio teaser is plain text, not rendered HTML — bioHtml can
// carry headings/lists that would break a fixed-height card, and `<small>` is
// a phrasing element that should never contain block markup. The full bio
// still renders through `<RichTextView>` on the speaker-detail panel below.
function plainTextPreview(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function SpeakerDetail({ speaker, event, eventSlug, onBack }: { speaker: PublishedSpeakerDTO; event: PublishedSpeakersDTO["event"]; eventSlug: string; onBack: () => void }) {
  return (
    <div className="speaker-detail">
      <button type="button" className="speaker-detail-back" onClick={onBack}><ArrowLeft size={14} /> Back to all speakers</button>
      <div className="speaker-detail-hero">
        <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="xl" />
        <div>
          <h2>{speaker.name}</h2>
          <p>{speaker.jobTitle ?? <Dash />} {speaker.company ? `· ${speaker.company}` : ""}</p>
          <div className="speaker-detail-links">
            {speaker.linkedinUrl ? <a href={speaker.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin size={15} /> LinkedIn</a> : <span><Dash /></span>}
            {speaker.twitterUrl ? <a href={speaker.twitterUrl} target="_blank" rel="noreferrer"><Twitter size={15} /> Twitter</a> : <span><Dash /></span>}
            {speaker.websiteUrl ? <a href={speaker.websiteUrl} target="_blank" rel="noreferrer"><Globe size={15} /> Website</a> : <span><Dash /></span>}
          </div>
        </div>
      </div>
      {speaker.bioHtml ? <RichTextView html={speaker.bioHtml} /> : <p className="session-detail-empty"><Dash /> No bio yet.</p>}
      <h3>Their sessions</h3>
      {speaker.sessions.length === 0 ? <p className="session-detail-empty"><Dash /></p> : (
        <ul className="speaker-detail-sessions">
          {speaker.sessions.map((session) => (
            <li key={session.id}>
              <Link href={`/e/${eventSlug}/schedule?session=${session.id}`}>
                <span>{formatInZone(session.startsAt, event.timezone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <b>{session.title}</b>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PublicSpeakers({
  eventSlug,
  speakers,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
  initialSpeakerId = null,
}: {
  eventSlug: string;
  speakers: PublishedSpeakersDTO;
  embed?: boolean;
  embedOptions?: EmbedOptions;
  initialSpeakerId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSpeakerId);

  // Same deep-link contract as the schedule page: read after hydration so the
  // route stays cacheable (see public-schedule.tsx's comment on PR #71).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const speakerParam = params.get("speaker");
    setSelectedId(speakerParam && speakers.speakers.some((item) => item.contactId === speakerParam) ? speakerParam : (initialSpeakerId ?? null));
  }, [initialSpeakerId, speakers.speakers]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return speakers.speakers;
    return speakers.speakers.filter((speaker) => `${speaker.name} ${speaker.company ?? ""} ${speaker.jobTitle ?? ""}`.toLowerCase().includes(needle));
  }, [speakers.speakers, search]);

  function select(id: string | null) {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("speaker", id); else url.searchParams.delete("speaker");
      window.history.replaceState(null, "", url);
    }
  }

  const selected = selectedId ? speakers.speakers.find((item) => item.contactId === selectedId) : undefined;

  return (
    <PublicEventShell active="speakers" eventSlug={eventSlug} event={speakers.event} embed={embed} embedOptions={embedOptions}>
      <main className={`public-speakers ${embed ? "embed-content" : "public-event-container"}`}>
        {selected ? (
          <SpeakerDetail speaker={selected} event={speakers.event} eventSlug={eventSlug} onBack={() => select(null)} />
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
              <div className="public-empty">
                <Search size={24} />
                <h3>Speakers coming soon</h3>
                <p>Confirmed speakers will appear here as they&rsquo;re announced.</p>
              </div>
            ) : (
              <>
                <label className="speaker-search">
                  <Search size={18} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search speakers, companies, or topics" />
                  {search && <button type="button" onClick={() => setSearch("")}><X size={15} /></button>}
                </label>
                <div className="speaker-gallery">
                  {filtered.map((speaker, index) => (
                    <article key={speaker.contactId} className={index === 0 && !embed ? "featured" : ""} onClick={() => select(speaker.contactId)} role="button" tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(speaker.contactId)}>
                      <div className="speaker-portrait">
                        <SpeakerAvatar name={speaker.name} headshotUrl={speaker.headshotUrl} size="xl" />
                      </div>
                      <div>
                        <h3>{speaker.name}</h3>
                        <p>{speaker.jobTitle ?? <Dash />} {speaker.company ? `· ${speaker.company}` : ""}</p>
                        <small>{speaker.bioHtml ? plainTextPreview(speaker.bioHtml) : <Dash />}</small>
                        <footer>
                          <Link href={`/e/${eventSlug}/schedule?search=${encodeURIComponent(speaker.name)}`} onClick={(e) => e.stopPropagation()}>
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
