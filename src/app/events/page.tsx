"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Check, MapPin, Plus, RotateCcw } from "lucide-react";
import { Brand } from "@/shared/ui/brand";
import { useDemo } from "@/shared/demo/demo-provider";
import { Button, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

export default function EventsPage() {
  const { state, reset } = useDemo();
  const { toast } = useToast();
  return <main className="events-index"><header className="events-index-header"><Brand dark /><div><span className="header-help">Help & docs</span><span className="header-avatar">ML</span></div></header><section className="events-index-content"><div className="events-title"><div><div className="page-eyebrow">Workspace</div><h1>Your events</h1><p>Choose an event to continue managing your program.</p></div><div className="page-actions"><Button variant="secondary" onClick={() => { reset(); toast("Demo data restored"); }}><RotateCcw size={16} /> Reset demo</Button><Button disabled title="Event creation ships with milestone M11"><Plus size={17} /> Create event</Button></div></div><div className="event-grid">{state.events.map((event) => <article className="event-card" key={event.id}><div className="event-cover"><div className="event-cover-grid" /><span className="event-logo">AI<span>.engineer</span></span><StatusBadge value="Live" /></div><div className="event-card-body"><div className="event-card-title"><h2>{event.name}</h2><span className="event-menu">•••</span></div><div className="event-meta"><span><CalendarDays size={16} /> Sep 15–16, 2026</span><span><MapPin size={16} /> {event.city}</span></div><div className="event-health"><span><Check size={14} /> CFP accepting submissions</span><small>247 received</small></div><Link href={`/events/${event.id}/dashboard`} className="button button-secondary event-open">Open event <ArrowRight size={16} /></Link></div></article>)}</div></section></main>;
}
