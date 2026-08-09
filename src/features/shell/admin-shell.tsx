"use client";

import Link from "next/link";
import { notFound, usePathname } from "next/navigation";
import { BarChart3, Bell, BookOpen, CalendarDays, ChevronDown, ClipboardCheck, ExternalLink, FileText, HelpCircle, LayoutDashboard, Mail, Menu, PanelTop, Search, Settings, Sparkles, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Brand } from "@/shared/ui/brand";
import { useDemo } from "@/shared/demo/demo-provider";
import type { MemberRole } from "@/shared/contracts";

type NavigationGroup = { label: string; items: Array<{ label: string; href: string; icon: LucideIcon; count?: number }> };

const navigation: NavigationGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "dashboard", icon: LayoutDashboard }] },
  { label: "Program", items: [{ label: "Forms", href: "forms", icon: FileText }, { label: "Abstracts", href: "abstracts", icon: ClipboardCheck, count: 12 }, { label: "Evaluation", href: "evaluation", icon: BarChart3 }, { label: "Agenda", href: "agenda", icon: CalendarDays }] },
  { label: "People", items: [{ label: "Speakers", href: "speakers", icon: Users }, { label: "Tasks", href: "tasks", icon: ClipboardCheck }] },
  { label: "Engage", items: [{ label: "Communications", href: "communications", icon: Mail }, { label: "Resources", href: "resources", icon: BookOpen }, { label: "Embeds", href: "embeds", icon: PanelTop }] },
];

const reviewerNavigation: NavigationGroup[] = [
  { label: "Review", items: [{ label: "Review queue", href: "review", icon: ClipboardCheck }] },
];

export function AdminShell({ eventId, role, children }: { eventId: string; role: MemberRole; children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, hydrated } = useDemo();
  const [open, setOpen] = useState(false);
  const event = state.events.find((item) => item.id === eventId);
  if (!event) {
    if (!hydrated) return null;
    notFound();
  }
  const base = `/events/${event.id}`;
  const visibleNavigation = role === "reviewer" ? reviewerNavigation : navigation;
  const current = visibleNavigation.flatMap((group) => group.items).find((item) => pathname.includes(`/${item.href}`))?.label ?? "Event";
  return <div className="app-shell">
    <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
    <aside className={`admin-sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><Brand /><button type="button" className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <button type="button" className="event-switcher"><span className="event-switcher-mark">AI</span><span><b>{event.shortName}</b><small>World&apos;s Fair 2026</small></span><ChevronDown size={16} /></button>
      <nav className="sidebar-nav">{visibleNavigation.map((group) => <div className="nav-group" key={group.label}><span>{group.label}</span>{group.items.map((item) => { const Icon = item.icon; const active = pathname.includes(`/${item.href}`); return <Link key={item.href} href={`${base}/${item.href}`} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} /><b>{item.label}</b>{item.count && <em>{item.count}</em>}</Link>; })}</div>)}</nav>
      <div className="sidebar-bottom"><Link href={`/e/${event.slug}/schedule`} target="_blank"><ExternalLink size={17} /> View public event</Link>{role !== "reviewer" && <Link href={`${base}/settings`}><Settings size={17} /> Event settings</Link>}<div className="sidebar-user"><span>ML</span><div><b>Maya Lin</b><small>{role === "reviewer" ? "Reviewer" : "Organizer"}</small></div><button type="button" aria-label="Account menu"><ChevronDown size={15} /></button></div></div>
    </aside>
    {open && <button type="button" aria-label="Close navigation" className="mobile-overlay" onClick={() => setOpen(false)} />}
    <section className="app-main"><header className="topbar"><div className="breadcrumbs"><span>{event.shortName}</span><i>/</i><b>{current}</b></div><div className="topbar-actions"><button type="button" className="search-trigger"><Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd></button><button type="button" className="icon-button" aria-label="Help & docs"><HelpCircle size={19} /></button><button type="button" className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><i /></button><span className="save-indicator"><Sparkles size={14} /> Demo workspace</span></div></header><div className="app-content">{children}</div></section>
  </div>;
}
