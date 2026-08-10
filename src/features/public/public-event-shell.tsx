"use client";

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { useEffect } from "react";
import type { EventRecord } from "@/shared/demo/types";

export type EmbedOptions = { theme: "light" | "dark"; header: boolean; accent: string };
export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { theme: "light", header: true, accent: "#00a878" };

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
  if (embed) return <div className={`embed-shell ${embedOptions.theme === "dark" ? "embed-dark" : ""}`} style={{ "--accent": embedOptions.accent, "--accent-dark": embedOptions.accent } as React.CSSProperties}><EmbedResizer />{embedOptions.header && <header className="embed-header"><b>{event.name}</b><span>Sep 15–16, 2026 · {event.city}</span></header>}{children}<footer>Powered by <b>openboard</b></footer></div>;
  return <div className="public-event">
    <header className="public-event-header"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><nav aria-label="Event navigation"><Link className={active === "schedule" ? "active" : ""} href={`/e/${event.slug}/schedule`}>Schedule</Link><Link className={active === "speakers" ? "active" : ""} href={`/e/${event.slug}/speakers`}>Speakers</Link><Link href={`/submit/${event.slug}/technical-talks`}>Call for speakers</Link></nav><Link className="button public-cta" href={`/portal/${event.slug}`}>Speaker portal</Link></div></header>
    <section className="public-event-hero"><div className="public-event-container"><span className="public-eyebrow">SEPTEMBER 15–16, 2026</span><h1>AI Engineer<br /><b>World’s Fair</b></h1><div><span><MapPin size={16} /> {event.venue} · {event.city}</span><span><CalendarDays size={16} /> Two days · 80+ speakers</span></div></div></section>
    {children}
    <footer className="public-event-footer"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><p>The global gathering for people building the future of AI engineering.</p><nav aria-label="Footer navigation"><a href="mailto:hello@ai.engineer">Contact</a><a href="#">Code of conduct</a><span>Powered by Openboard</span></nav></div></footer>
  </div>;
}
