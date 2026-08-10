"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useEffect } from "react";
import { formatInZone } from "@/shared/lib/time";

export type EmbedOptions = { theme: "light" | "dark"; header: boolean; accent: string };
export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { theme: "light", header: true, accent: "#6958d7" };

/** The event branding this shell needs — `PublishedScheduleDTO["event"]` and
 * `PublishedSpeakersDTO["event"]` both satisfy this shape verbatim. */
export type PublicEventInfo = { name: string; timezone: string; accentColor: string | null } & Partial<{ startsAt: string; endsAt: string }>;

// Posts the document height to the parent frame so /public/embed.js can size
// the iframe. Runs only when embedded.
function EmbedResizer() {
  useEffect(() => {
    if (window.parent === window) return;
    const post = () => window.parent.postMessage({ type: "openboard:embed-height", height: document.documentElement.scrollHeight }, "*");
    post();
    const observer = new ResizeObserver(post);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return null;
}

function dateRange(event: PublicEventInfo): string | null {
  if (!event.startsAt || !event.endsAt) return null;
  const start = formatInZone(event.startsAt, event.timezone, { month: "short", day: "numeric" });
  const end = formatInZone(event.endsAt, event.timezone, { month: "short", day: "numeric", year: "numeric" });
  return `${start} – ${end}`;
}

export function PublicEventShell({
  children,
  active,
  eventSlug,
  event,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
}: {
  children: React.ReactNode;
  active: "schedule" | "speakers";
  eventSlug: string;
  event: PublicEventInfo;
  embed?: boolean;
  embedOptions?: EmbedOptions;
}) {
  // The one accent CSS variable per event, light mode only — an organizer's
  // brand color overrides the product default for every descendant that reads
  // `var(--purple)`, and never touches dark mode.
  const accentStyle = { "--purple": embed ? embedOptions.accent : (event.accentColor ?? undefined) } as React.CSSProperties;
  const range = dateRange(event);

  if (embed) {
    return (
      <div className={`embed-shell ${embedOptions.theme === "dark" ? "embed-dark" : ""}`} style={accentStyle}>
        <EmbedResizer />
        {embedOptions.header && (
          <header className="embed-header">
            <b>{event.name}</b>
            {range && <span>{range}</span>}
          </header>
        )}
        {children}
        <footer>Powered by <b>openboard</b></footer>
      </div>
    );
  }

  return (
    <div className="public-event" style={accentStyle}>
      <header className="public-event-header">
        <div className="public-event-container">
          <span className="public-event-logo">{event.name}</span>
          <nav aria-label="Event navigation">
            <Link className={active === "schedule" ? "active" : ""} href={`/e/${eventSlug}/schedule`}>Schedule</Link>
            <Link className={active === "speakers" ? "active" : ""} href={`/e/${eventSlug}/speakers`}>Speakers</Link>
          </nav>
          <Link className="button public-cta" href={`/portal/${eventSlug}`}>Speaker portal</Link>
        </div>
      </header>
      <section className="public-event-hero">
        <div className="public-event-container">
          {range && <span className="public-eyebrow">{range.toUpperCase()}</span>}
          <h1>{event.name}</h1>
          <div>
            {range && <span><CalendarDays size={16} /> {range}</span>}
          </div>
        </div>
      </section>
      {children}
      <footer className="public-event-footer">
        <div className="public-event-container">
          <span className="public-event-logo">{event.name}</span>
          <p>Built and run on openboard — schedule updates automatically as the program changes.</p>
          <nav aria-label="Footer navigation"><span>Powered by Openboard</span></nav>
        </div>
      </footer>
    </div>
  );
}
