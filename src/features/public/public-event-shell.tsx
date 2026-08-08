import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";

export function PublicEventShell({ children, active, embed = false }: { children: React.ReactNode; active: "schedule" | "speakers"; embed?: boolean }) {
  if (embed) return <div className="embed-shell">{children}<footer>Powered by <b>openboard</b></footer></div>;
  return <div className="public-event">
    <header className="public-event-header"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><nav><Link className={active === "schedule" ? "active" : ""} href="/e/ai-engineer/schedule">Schedule</Link><Link className={active === "speakers" ? "active" : ""} href="/e/ai-engineer/speakers">Speakers</Link><Link href="/submit/ai-engineer/technical-talks">Call for speakers</Link></nav><Link className="button public-cta" href="/portal/ai-engineer">Speaker portal</Link></div></header>
    <section className="public-event-hero"><div className="public-event-container"><span className="public-eyebrow">SEPTEMBER 15–16, 2026</span><h1>AI Engineer<br /><b>World’s Fair</b></h1><div><span><MapPin size={16} /> Fort Mason Center · San Francisco</span><span><CalendarDays size={16} /> Two days · 80+ speakers</span></div></div></section>
    {children}
    <footer className="public-event-footer"><div className="public-event-container"><span className="public-event-logo">AI<span>.engineer</span></span><p>The global gathering for people building the future of AI engineering.</p><nav><a href="mailto:hello@ai.engineer">Contact</a><a href="#">Code of conduct</a><span>Powered by Openboard</span></nav></div></footer>
  </div>;
}
