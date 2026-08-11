"use client";

import Link from "next/link";
import { notFound, usePathname } from "next/navigation";
import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, ExternalLink, FileText, FolderOpen, LayoutDashboard, Mail, Menu, PanelTop, Settings, Sparkles, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/shared/ui/brand";
import { useDemo } from "@/shared/demo/demo-provider";
import { CommandPalette } from "@/features/shell/components/command-palette";
import { EventSwitcher } from "@/features/events/components/event-switcher";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import type { EventId, MemberRole } from "@/shared/contracts";

type NavigationGroup = { label: string; items: Array<{ label: string; href: string; icon: LucideIcon }> };

/**
 * What the shell needs to draw itself. The event layout reads this from the
 * database on the server and hands it down; the browser demo fixture supplies
 * the same shape when the credential-free demo is running.
 */
export type AdminShellEvent = { id: string; slug: string; name: string; shortName: string };

/**
 * M56 — real, *actionable* sidebar counts (replacing the previous permanent
 * hardcode). Every key maps to one nav href; a missing or zero value renders
 * no badge at all, so the sidebar stays quiet when there is nothing to do.
 * `abstracts`/`speakers`/`tasks` are organizer/owner badges; `review` is the
 * reviewer's own outstanding-work count and only that nav renders it.
 */
export type AdminShellCounts = { abstracts?: number; speakers?: number; tasks?: number; review?: number };

const COUNT_KEY_BY_HREF: Record<string, keyof AdminShellCounts> = {
  abstracts: "abstracts",
  speakers: "speakers",
  tasks: "tasks",
  review: "review",
};

const navigation: NavigationGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "dashboard", icon: LayoutDashboard }] },
  { label: "Program", items: [{ label: "Forms", href: "forms", icon: FileText }, { label: "Abstracts", href: "abstracts", icon: ClipboardCheck }, { label: "Evaluation", href: "evaluation", icon: BarChart3 }, { label: "Agenda", href: "agenda", icon: CalendarDays }] },
  { label: "People", items: [{ label: "Speakers", href: "speakers", icon: Users }, { label: "Tasks", href: "tasks", icon: ClipboardCheck }, { label: "Files", href: "files", icon: FolderOpen }] },
  { label: "Engage", items: [{ label: "Communications", href: "communications", icon: Mail }, { label: "Resources", href: "resources", icon: BookOpen }, { label: "Embeds", href: "embeds", icon: PanelTop }] },
];

const reviewerNavigation: NavigationGroup[] = [
  { label: "Review", items: [{ label: "Review queue", href: "review", icon: ClipboardCheck }] },
];

export function activeAdminSection(pathname: string, base: string): string | undefined {
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : undefined;
}

export function adminMobileNavigationState(isMobile: boolean, open: boolean) {
  return {
    sidebarHidden: isMobile && !open,
    backgroundInert: isMobile && open,
  };
}

/**
 * The admin event shell.
 *
 * `event` is the server's read of the row, passed down by
 * `app/events/[eventId]/layout.tsx`. It is what makes this shell render on the
 * server as well as in the browser: before it existed the shell resolved the
 * event out of the browser demo fixture, so every real event id — seeded or
 * freshly created — rendered an empty SSR body and then client-side
 * `notFound()`ed once hydrated. The demo lookup survives only as the fallback
 * for the credential-free local demo, which has no database to read.
 */
export function AdminShell({ eventId, role, event: serverEvent, counts, user, children }: { eventId: EventId; role: MemberRole; event?: AdminShellEvent; counts?: AdminShellCounts; user?: { name: string; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, hydrated } = useDemo();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    function syncMobileState() {
      setIsMobile(media.matches);
      if (!media.matches) setOpen(false);
    }
    syncMobileState();
    media.addEventListener("change", syncMobileState);
    return () => media.removeEventListener("change", syncMobileState);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeMenu, isMobile, open]);
  const demoEvent = state.events.find((item) => item.id === eventId);
  const event: AdminShellEvent | undefined = serverEvent
    ?? (demoEvent ? { id: demoEvent.id, slug: demoEvent.slug, name: demoEvent.name, shortName: demoEvent.shortName } : undefined);
  if (!event) {
    if (!hydrated) return null;
    notFound();
  }
  const base = `/events/${event.id}`;
  const visibleNavigation = role === "reviewer" ? reviewerNavigation : navigation;
  const activeSection = activeAdminSection(pathname, base);
  const current = visibleNavigation.flatMap((group) => group.items).find((item) => item.href === activeSection)?.label ?? "Event";
  const accountName = user?.name.trim() || user?.email || "Maya Lin";
  const accountInitials = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ML";
  const mobileNavigation = adminMobileNavigationState(isMobile, open);
  return <div className="app-shell">
    <button ref={menuButtonRef} type="button" className="mobile-menu" aria-label="Open navigation" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
    <aside ref={sidebarRef} id="admin-navigation" className={`admin-sidebar ${open ? "open" : ""}`} aria-hidden={mobileNavigation.sidebarHidden || undefined} inert={mobileNavigation.sidebarHidden || undefined}>
      <div className="sidebar-brand"><Brand /><button ref={closeButtonRef} type="button" className="mobile-close" aria-label="Close navigation" onClick={closeMenu}><X size={18} /></button></div>
      <EventSwitcher
        eventId={eventId}
        initialEvent={{ name: event.shortName, detail: `/${event.slug}` }}
        {...(!serverEvent ? { demoEvents: state.events } : {})}
      />
      <nav className="sidebar-nav">{visibleNavigation.map((group) => <div className="nav-group" key={group.label}><span>{group.label}</span>{group.items.map((item) => { const Icon = item.icon; const active = item.href === activeSection; const countKey = COUNT_KEY_BY_HREF[item.href]; const count = countKey ? counts?.[countKey] : undefined; return <Link key={item.href} href={`${base}/${item.href}`} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={18} /><b>{item.label}</b>{!!count && <em>{count}</em>}</Link>; })}</div>)}</nav>
      <div className="sidebar-bottom"><Link href={`/e/${event.slug}/schedule`} target="_blank"><ExternalLink size={17} /> View public event</Link>{role !== "reviewer" && <Link href={`${base}/settings`}><Settings size={17} /> Event settings</Link>}<div className="sidebar-user"><span>{accountInitials}</span><div><b>{accountName}</b><small>{role === "reviewer" ? "Reviewer" : "Organizer"}</small></div>{user && <SignOutButton kind="admin" compact />}</div></div>
    </aside>
    {open && <button type="button" tabIndex={-1} aria-label="Close navigation" className="mobile-overlay" onClick={closeMenu} />}
    <section className="app-main" inert={mobileNavigation.backgroundInert || undefined} aria-hidden={mobileNavigation.backgroundInert || undefined}><header className="topbar"><div className="breadcrumbs"><span>{event.shortName}</span><i>/</i><b>{current}</b></div><div className="topbar-actions"><CommandPalette eventId={event.id} base={base} role={role} />{!serverEvent && <span className="save-indicator"><Sparkles size={14} /> Demo workspace</span>}</div></header><div className="app-content">{children}</div></section>
  </div>;
}
