"use client";

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { useEffect } from "react";
import type { EventRecord } from "@/shared/demo/types";

export type EmbedOptions = { theme: "light" | "dark"; header: boolean; accent: string };
export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { theme: "light", header: true, accent: "#00a878" };

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

export function PublicEventShell({ children, active, event, embed = false, embedOptions = DEFAULT_EMBED_OPTIONS }: { children: React.ReactNode; active: "schedule" | "speakers"; event: EventRecord; embed?: boolean; embedOptions?: EmbedOptions }) {
  if (embed) return <div className={`embed-shell ${embedOptions.theme === "dark" ? "embed-dark" : ""}`} style={{ "--accent": embedOptions.accent, "--accent-dark": embedOptions.theme === "dark" ? embedOptions.accent : accentTextShade(embedOptions.accent) } as React.CSSProperties}><EmbedResizer />{embedOptions.header && <header className="embed-header"><b>{event.name}</b><span>Sep 15–16, 2026 · {event.city}</span></header>}{children}<footer>Powered by <b>openboard</b></footer></div>;
  return <div className="public-event">
    <header className="public-event-header"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><nav aria-label="Event navigation"><Link className={active === "schedule" ? "active" : ""} href={`/e/${event.slug}/schedule`}>Schedule</Link><Link className={active === "speakers" ? "active" : ""} href={`/e/${event.slug}/speakers`}>Speakers</Link><Link href={`/submit/${event.slug}/technical-talks`}>Call for speakers</Link></nav><Link className="button public-cta" href={`/portal/${event.slug}`}>Speaker portal</Link></div></header>
    <section className="public-event-hero"><div className="public-event-container"><span className="public-eyebrow">SEPTEMBER 15–16, 2026</span><h1>AI Engineer<br /><b>World’s Fair</b></h1><div><span><MapPin size={16} /> {event.venue} · {event.city}</span><span><CalendarDays size={16} /> Two days · 80+ speakers</span></div></div></section>
    {children}
    <footer className="public-event-footer"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><p>The global gathering for people building the future of AI engineering.</p><nav aria-label="Footer navigation"><a href="mailto:hello@ai.engineer">Contact</a><a href="#">Code of conduct</a><span>Powered by Openboard</span></nav></div></footer>
  </div>;
}
