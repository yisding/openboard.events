"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { formatDateRangeInZone } from "@/shared/lib/time";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

export type EmbedOptions = { theme: "light" | "dark"; header: boolean; accent: string };
export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { theme: "light", header: true, accent: DEFAULT_BRAND_COLOR };

// Embed styles use --accent for fills and --accent-dark for small text, so a
// custom accent that is too luminous for text (the default jade included, at
// 3.06:1 on white) must be darkened before it lands in --accent-dark.
function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function accentTextShade(accent: string): string {
  // Accept everything the embed query parser does: #RGB, #RGBA, #RRGGBB and
  // #RRGGBBAA. Alpha channels are composited over the white embed ground so
  // the contrast check sees the colour as rendered.
  const match = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(accent.trim());
  if (!match?.[1]) return accent;
  const short = match[1].length <= 4;
  const digits = short ? [...match[1]].map((d) => d + d).join("") : match[1];
  let r = parseInt(digits.slice(0, 2), 16);
  let g = parseInt(digits.slice(2, 4), 16);
  let b = parseInt(digits.slice(4, 6), 16);
  if (digits.length === 8) {
    const alpha = parseInt(digits.slice(6, 8), 16) / 255;
    r = Math.round(r * alpha + 255 * (1 - alpha));
    g = Math.round(g * alpha + 255 * (1 - alpha));
    b = Math.round(b * alpha + 255 * (1 - alpha));
  }
  const contrastOnWhite = () => 1.05 / (0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b) + 0.05);
  for (let step = 0; step < 24 && contrastOnWhite() < 4.5; step += 1) {
    r = Math.floor(r * 0.92); g = Math.floor(g * 0.92); b = Math.floor(b * 0.92);
  }
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The event branding this shell needs — `PublishedScheduleDTO["event"]` and
 * `PublishedSpeakersDTO["event"]` both satisfy this shape verbatim. */
export type PublicEventInfo = {
  name: string;
  timezone: string;
  accentColor: string | null;
  logoUrl?: string | null;
  backgroundUrl?: string | null;
  /** First Fair (design §5.1, §6.3). Optional — the embed's disabled-notice
   * branch builds this object by hand from a row that predates the demo
   * concept, so it simply omits the field rather than claiming `false`. */
  isDemo?: boolean;
} & Partial<{ startsAt: string; endsAt: string }>;

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
  // No zone abbreviation. This is one event, on whole days, with no time
  // beside it — "Oct 19 – 21, 2026 PDT" qualifies nothing an attendee is
  // reading, and it is the entire content of the band it sits in.
  return formatDateRangeInZone(event.startsAt, event.endsAt, event.timezone, { showZone: false });
}

export type PublicSurface = "sessions" | "agenda" | "itinerary" | "speakers" | "gallery";

const NAV_ITEMS: Array<{ key: PublicSurface; label: string }> = [
  { key: "sessions", label: "Sessions" },
  { key: "agenda", label: "Agenda" },
  { key: "itinerary", label: "Schedule" },
  { key: "speakers", label: "Speakers" },
  { key: "gallery", label: "Gallery" },
];

export function PublicEventShell({
  children,
  heroControls,
  active,
  eventSlug,
  event,
  embed = false,
  embedOptions = DEFAULT_EMBED_OPTIONS,
}: {
  children: React.ReactNode;
  heroControls?: React.ReactNode;
  active: PublicSurface;
  eventSlug: string;
  event: PublicEventInfo;
  embed?: boolean;
  embedOptions?: EmbedOptions;
}) {
  // The accent CSS variable pair per event, light mode only — an organizer's
  // brand color overrides the product jade for every descendant that reads
  // `var(--accent)`, with `--accent-dark` darkened until it is legal as text
  // (accentTextShade), and never touches dark mode.
  const accent = embed ? embedOptions.accent : event.accentColor;
  const accentStyle = {
    "--accent": accent ?? undefined,
    "--accent-dark": accent
      ? (embed && embedOptions.theme === "dark" ? accent : accentTextShade(accent))
      : undefined,
  } as React.CSSProperties;
  const range = dateRange(event);
  // First Fair (design §5.1, §6.3). A slim, unmistakable label rather than a
  // hidden one — the safety story here is "fabricated speakers never enter a
  // search index", and a ribbon a visitor can actually see is part of that
  // story, not decoration on top of it.
  const demoRibbon = event.isDemo && (
    <div role="note" className="public-demo-ribbon">
      Sample event · built with Openboard
    </div>
  );

  if (embed) {
    return (
      <div className={`embed-shell ${embedOptions.theme === "dark" ? "embed-dark" : ""}`} style={accentStyle}>
        <EmbedResizer />
        {demoRibbon}
        {/* An embed is its own document inside the host's iframe, so it needs
         * its own <h1> or a screen reader lands in a page with no outline —
         * the content's <h2> is hidden by `.embed-shell>.embed-content>header`
         * and the shell used to name the event with a plain <b>. `.embed-header
         * h1` keeps the compact heading typography (`font: inherit` plus the
         * shared emphasis weight, margins zeroed) so `.embed-header` keeps its
         * small flex/baseline row, and the header-off variant is the shared
         * `.sr-only` rather than another hand-rolled visually-hidden recipe. */}
        {embedOptions.header ? (
          <header className="embed-header">
            <h1>{event.name}</h1>
            {range && <span>{range}</span>}
          </header>
        ) : (
          <h1 className="sr-only">{event.name}</h1>
        )}
        {children}
        <footer>Powered by <b>Openboard</b></footer>
      </div>
    );
  }

  return (
    <div className="public-event" style={accentStyle}>
      {demoRibbon}
      <header className="public-event-header">
        <div className="public-event-container">
          <Link className="public-event-logo" href={`/e/${eventSlug}/agenda`} aria-label={`${event.name} agenda`}>
            {event.logoUrl && <Image src={event.logoUrl} alt="" aria-hidden="true" width={36} height={36} unoptimized />}
            <span className="public-event-name">{event.name}</span>
          </Link>
          <nav aria-label="Event navigation">
            {NAV_ITEMS.map((item) => (
              <Link key={item.key} className={active === item.key ? "active" : ""} aria-current={active === item.key ? "page" : undefined} href={`/e/${eventSlug}/${item.key}`}>{item.label}</Link>
            ))}
          </nav>
          <Link className="button public-cta" href={`/portal/${eventSlug}`}>Speaker portal</Link>
        </div>
      </header>
      <section className="public-event-hero">
        {event.backgroundUrl && (
          <Image
            src={event.backgroundUrl}
            alt=""
            aria-hidden="true"
            className="public-event-hero-image"
            fill
            priority
            unoptimized
            sizes="100vw"
          />
        )}
        <div className="public-event-container">
          {range && <span className="public-eyebrow">{range.toUpperCase()}</span>}
          <h1 className="public-event-hero-title">{event.name}</h1>
        </div>
      </section>
      {heroControls && (
        <div className="public-event-hero-controls">
          <div className="public-event-container">{heroControls}</div>
        </div>
      )}
      {children}
      <footer className="public-event-footer">
        <div className="public-event-container">
          <span className="public-event-logo">{event.name}</span>
          <p>Built and run on Openboard — schedule updates automatically as the program changes.</p>
          <nav aria-label="Footer navigation"><span>Powered by Openboard</span></nav>
        </div>
      </footer>
    </div>
  );
}
