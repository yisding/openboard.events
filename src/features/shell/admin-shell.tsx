"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, usePathname } from "next/navigation";
import { BarChart3, BookOpen, CalendarDays, ExternalLink, FileText, FolderOpen, Inbox, LayoutDashboard, ListChecks, Mail, Menu, PanelTop, Settings, Star, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/shared/ui/brand";
import { z } from "zod";
import { CommandPalette, type CommandPaletteAction } from "@/features/shell/components/command-palette";
import { EventSwitcher } from "@/features/events/index.client";
import { SignOutButton } from "@/features/auth/index.client";
import type { EventId, MemberRole } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { FirstRunHints, Hint, hintStorageKey } from "@/shared/ui/app/first-run-hints";
import type { TourBootstrap, TourStatus } from "@/shared/ui/app/guided-tour";
// The pure half of the engine only: `objectives.ts` has no React and no DOM,
// so the palette's two tour entries cost a few hundred bytes instead of
// pulling the whole tutorial into every admin route's first load.
import { tourHref, tourProgress } from "@/shared/ui/app/guided-tour/objectives";
// Same trade, same reason: dropping the engine's optimistic cursor mirror is
// one localStorage key, not a reason to load the engine.
import { forgetTourMirror } from "@/shared/ui/app/guided-tour/mirror";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { UnsavedWorkGuardProvider } from "@/shared/ui/app/unsaved-work-guard";

/**
 * Just enough of the tour's wire shape for the palette's *Resume* and
 * *Restart* to compare-and-set the cursor. The shell deliberately does not
 * import the onboarding feature's schemas: it would drag server code into a
 * client bundle and put a `shell -> onboarding` edge in a graph the design
 * keeps at `shell -> shared`.
 */
const tourCursorWireSchema = z.object({ chapter: z.string(), stepId: z.string(), status: z.string() }).loose();

/**
 * First Fair (design §3.1, D8) — the tutorial engine, loaded only when there
 * is a tutorial.
 *
 * The shell imports the *generic* engine from `shared/ui`, never the
 * onboarding feature, which is what keeps `architecture:check`'s baseline at
 * `shell -> shared` and keeps a real-event organizer's bundle free of every
 * byte of it: the component below is only rendered when the route module
 * supplies a `tour`, so the chunk is never requested otherwise.
 */
const GuidedTourMount = dynamic(
  () => import("@/shared/ui/app/guided-tour").then((module) => module.GuidedTourMount),
  { ssr: false },
);

type NavigationGroup = { label: string; items: Array<{ label: string; href: string; icon: LucideIcon }> };

/**
 * What the shell needs to draw itself. The event layout reads this from the
 * database on the server and hands it down.
 */
export type AdminShellEvent = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  /**
   * First Fair (design §5.1, §8.2). A local field, not one on `EventDTO`:
   * `eventDtoSchema` is CP1-frozen, and the shell learns this from the same
   * server read that hands it the tour. Labelling is not decoration — an
   * organizer who forgets which of their two tabs is the sandbox is exactly
   * the person the badge is for.
   */
  isDemo?: boolean;
  /**
   * The organization this event belongs to. Only the command palette's
   * *"Explore a demo event"* entrance needs it — the demo lives one level up
   * from any single event — and it is optional so a shell rendered from a
   * fixture stays constructible.
   */
  organizationId?: string;
};

/** `ids={[]}`, hoisted so the prop identity is stable across renders. */
const NO_HINT_IDS: readonly string[] = [];

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
  { label: "Program", items: [{ label: "Forms", href: "forms", icon: FileText }, { label: "Submissions", href: "abstracts", icon: Inbox }, { label: "Evaluation", href: "evaluation", icon: BarChart3 }, { label: "Agenda", href: "agenda", icon: CalendarDays }] },
  { label: "People", items: [{ label: "Speakers", href: "speakers", icon: Users }, { label: "Tasks", href: "tasks", icon: ListChecks }, { label: "Files", href: "files", icon: FolderOpen }] },
  { label: "Engage", items: [{ label: "Communications", href: "communications", icon: Mail }, { label: "Resources", href: "resources", icon: BookOpen }, { label: "Embeds", href: "embeds", icon: PanelTop }] },
];

const reviewerNavigation: NavigationGroup[] = [
  { label: "Review", items: [{ label: "Review queue", href: "review", icon: Star }] },
];

/**
 * The shell's first-run hints, in the order the beacons fade in (top of the
 * sidebar down, then the topbar). Each role gets the ids whose anchors its
 * shell actually renders — `Hint` degrades to a plain wrapper for the rest —
 * so a reviewer is welcomed by their queue rather than by organizer tips
 * about forms they cannot open. Each shows once per browser (localStorage,
 * `MilestoneBanner`'s convention), and "Skip all tips" in any card silences
 * the whole shared `shell` scope at once, for both roles.
 */
const SHELL_HINT_IDS: readonly string[] = ["shell:event-switcher", "shell:program-forms", "shell:public-preview", "shell:event-settings", "shell:command-palette"];
const REVIEWER_HINT_IDS: readonly string[] = ["shell:review-queue", "shell:reviewer-palette"];

/**
 * Which ambient beacons this shell offers.
 *
 * First Fair (design §3.9): a running tutorial gets the floor. `ids={[]}` is
 * the mute, not a scope swap — `Hint` draws a beacon only for an id the
 * provider knows, so an empty list silences every one of them without writing
 * a single storage key, and pausing the tour brings them all straight back. A
 * scope swap would leave the beacons rendering *and* discard a prior "Skip all
 * tips", which is strictly worse than doing nothing.
 */
export function shellHintIds(role: MemberRole, tourRunning: boolean): readonly string[] {
  if (role === "reviewer") return REVIEWER_HINT_IDS;
  return tourRunning ? NO_HINT_IDS : SHELL_HINT_IDS;
}

export function activeAdminSection(pathname: string, base: string): string | undefined {
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : undefined;
}

/**
 * Admin surfaces the sidebar's nav groups do not list, and therefore the only
 * ones the breadcrumb could not name. Event settings is reached from the
 * sidebar *footer* and API keys from inside settings, so both used to render
 * the same placeholder "Event" the topbar shows for a route it has never heard
 * of — a breadcrumb that told an organizer nothing about where they were.
 *
 * Keyed by the event-relative path, longest first, and read as a prefix so a
 * future child route inherits its parent's trail rather than the placeholder.
 */
const OFF_NAV_BREADCRUMBS: ReadonlyArray<{ path: string; trail: readonly string[] }> = [
  // "Event settings" is the sidebar link's own wording; the breadcrumb should
  // echo the door the organizer walked through, not invent a synonym.
  { path: "settings/api-keys", trail: ["Event settings", "API keys"] },
  { path: "settings", trail: ["Event settings"] },
  // Organizers can open the review queue even though only a reviewer's sidebar
  // links it, so its label cannot live in the nav data alone.
  { path: "review", trail: ["Review queue"] },
];

/**
 * The topbar breadcrumb after the event name: the sidebar's own label for a
 * nav surface, the map above for the rest, and only for a genuinely unknown
 * route the generic fallback.
 *
 * A trail rather than a single label so `/settings/api-keys` can say which
 * settings screen it is without dropping the section it belongs to.
 */
export function adminBreadcrumbTrail(pathname: string, base: string, role: MemberRole): readonly string[] {
  const groups = role === "reviewer" ? reviewerNavigation : navigation;
  const section = activeAdminSection(pathname, base);
  const navLabel = groups.flatMap((group) => group.items).find((item) => item.href === section)?.label;
  if (navLabel) return [navLabel];
  const relative = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : "";
  const known = OFF_NAV_BREADCRUMBS.find(({ path }) => relative === path || relative.startsWith(`${path}/`));
  return known?.trail ?? ["Event"];
}

/**
 * The width at which this shell becomes the mobile one. It must stay equal to
 * the `@media(max-width:768px)` blocks in globals.css that take `.admin-sidebar`
 * off-canvas and reveal `.mobile-menu`, because the two halves describe one
 * layout: the stylesheet decides what is on screen, and this query decides what
 * `adminMobileNavigationState` marks `inert`.
 *
 * It read 860px while the stylesheet read 768px, and every width in between got
 * the desktop stylesheet with the mobile inert state: a sidebar sitting in plain
 * view at full opacity, holding the event switcher and every nav link, that
 * answered no click and no keypress — with the hamburger still display:none, so
 * nothing on screen could revive it. iPad portrait (810–834px) lands inside that
 * band. Change one number here and the matching blocks in globals.css together.
 */
const MOBILE_SHELL_QUERY = "(max-width: 768px)";

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
 * event out of a client-side fixture, so every real event id — seeded or
 * freshly created — rendered an empty SSR body and then client-side
 * `notFound()`ed once hydrated.
 */
export function AdminShell({ eventId, role, event: serverEvent, counts, user, canCreateEvent, tour, nowIso = new Date().toISOString(), children }: {
  eventId: EventId;
  role: MemberRole;
  event?: AdminShellEvent;
  counts?: AdminShellCounts;
  user?: { name: string; email: string };
  canCreateEvent: boolean;
  /**
   * First Fair (design §3.1). Typed against the **shared** engine's contract,
   * so the shell can mount a tutorial without knowing that demo events exist.
   * Absent on every real event, and on every reviewer's shell.
   */
  tour?: TourBootstrap;
  nowIso?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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
    const media = window.matchMedia(MOBILE_SHELL_QUERY);
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
    // The nav is a plain overlay, not a <dialog>, so nothing blocks the document
    // from scrolling underneath it: a drag anywhere over the scrim moved the page
    // behind, and an organizer came back to a Submissions list scrolled somewhere
    // else. `inert` on .app-main stops hit-testing, not scrolling. The nav list's
    // own overscroll is contained in CSS; this is the page behind it.
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, isMobile, open]);

  /* --- the guided tour (First Fair, design §3.1, §3.6, §3.9) ------------- */

  // Reviewers never see a tutorial, and the tour's own API is organizer-gated,
  // so a reviewer's shell drops it here as well as at the route module.
  const activeTour = role === "reviewer" ? undefined : tour;
  /**
   * Seeded from the server render, then kept live by the engine.
   *
   * The status is client state inside the tour layer, and a soft navigation
   * reuses the event layout's render for the life of the session — so a
   * bootstrap-only reading of it never changes. Pausing on Chapter 4 would
   * then leave the palette still offering only "Restart the guided tour",
   * which is the one thing the player does not want, at exactly the moment
   * design §3.6 promises Resume.
   */
  const [liveTourStatus, setLiveTourStatus] = useState<TourStatus | undefined>(activeTour?.cursor.status);
  /**
   * And the cursor with it, for the same reason.
   *
   * A pause in Chapter 8 has to *say* Chapter 8. Offering "Resume the guided
   * tour · Chapter 1 — Cold open" because that is where the last full page
   * load found the row is not a resume, it is an invitation to lose seven
   * chapters — and the write behind it would do exactly that.
   */
  const [liveTourCursor, setLiveTourCursor] = useState<{ chapter: string; stepId: string } | null>(null);
  const handleTourStatusChange = useCallback((status: TourStatus, cursor: { chapter: string; stepId: string }) => {
    setLiveTourStatus(status);
    setLiveTourCursor({ chapter: cursor.chapter, stepId: cursor.stepId });
  }, []);
  const tourStatus = liveTourStatus ?? activeTour?.cursor.status;
  const tourRunning = activeTour !== undefined
    && (tourStatus === "active" || tourStatus === "not_started");

  const hintIds = shellHintIds(role, tourRunning);

  /**
   * The player has now been personally walked past the event switcher, the
   * forms nav and the palette. Beaconing them afterwards would be
   * condescending, so finishing the tour retires them for good.
   */
  const retireShellHints = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      for (const id of SHELL_HINT_IDS) window.localStorage.setItem(hintStorageKey(id), "1");
    } catch {
      // Storage disabled. The beacons stay; nothing else is affected.
    }
  }, []);

  /**
   * `to: "server"` is Resume, and it deliberately names no step of its own.
   * The bootstrap this shell was rendered with is as old as the last full
   * document load, so resuming *it* would drag a player who paused in Chapter
   * 8 back to wherever the row stood then — and write it. Resume means "carry
   * on from where the row actually is", which is a fact only the row has.
   */
  const moveTourCursor = useCallback((to: { chapter: string; stepId: string } | "server", destination: string) => {
    const bootstrap = activeTour;
    if (!bootstrap) return;
    void (async () => {
      let target = destination;
      try {
        // Read first: the compare-and-set needs the step the *server* is on,
        // which is not necessarily the one this page was rendered with.
        const current = await api(bootstrap.statePath, tourCursorWireSchema);
        const next = to === "server" ? { chapter: current.chapter, stepId: current.stepId } : to;
        if (to === "server") {
          const route = bootstrap.steps.find((step) => step.id === current.stepId)?.route;
          if (route) target = tourHref(route, bootstrap.context);
        }
        await api(bootstrap.statePath, tourCursorWireSchema, {
          method: "PATCH",
          body: { expectedStepId: current.stepId, chapter: next.chapter, stepId: next.stepId, status: "active" },
        });
      } catch {
        // A refused write leaves the cursor exactly where it was, and the
        // navigation below simply lands the organizer back on it.
      }
      // The engine prefers its localStorage mirror whenever that mirror is
      // ahead of the server, which is exactly what an explicit *Restart* is
      // asking it to stop doing. Left behind, the mirror would put the player
      // back on the step they had reached one load later — and the route this
      // navigates to would then disagree with the step being shown.
      forgetTourMirror(bootstrap.scopeId);
      // A full load rather than a push: the cursor is server state the layout
      // reads once, so the engine has to be handed a fresh bootstrap.
      window.location.assign(target);
    })();
  }, [activeTour]);

  const paletteActions = useMemo<CommandPaletteAction[]>(() => {
    const base = `/events/${serverEvent?.id ?? eventId}`;
    if (!activeTour) {
      const organizationId = serverEvent?.organizationId;
      if (role === "reviewer" || serverEvent?.isDemo || !organizationId) return [];
      // The palette entrance (design §1.3). It routes to the fork rather than
      // provisioning anything, which is what makes it honest whether or not
      // this organization already has a demo — the fork knows which it is and
      // says so.
      return [{
        id: "explore-demo",
        label: "Explore a demo event",
        hint: "Demo",
        destination: `/organizations/${organizationId}/onboarding?mode=demo`,
      }];
    }
    // The live cursor when the engine has reported one, the server render's
    // otherwise — never the stale one once a better answer exists.
    const cursor = liveTourCursor ?? activeTour.cursor;
    const progress = tourProgress(activeTour.chapters, activeTour.steps, cursor.stepId);
    const chapterLabel = progress.chapterIndex > 0 && progress.chapter
      ? ` · Chapter ${progress.chapterIndex} — ${progress.chapter.name}`
      : "";
    const currentRoute = activeTour.steps.find((step) => step.id === cursor.stepId)?.route;
    const currentHref = currentRoute ? tourHref(currentRoute, activeTour.context) : `${base}/dashboard`;
    const first = activeTour.steps[0];
    const actions: CommandPaletteAction[] = [];
    if (!tourRunning) {
      actions.push({
        id: "tour-resume",
        label: `Resume the guided tour${chapterLabel}`,
        hint: "Tour",
        destination: currentHref,
        // `moveTourCursor` PATCHes and then hard-loads, so the unsaved-work
        // guard has to be told this ends in a real unload — see
        // `CommandPaletteAction.hardUnload`.
        hardUnload: true,
        run: () => moveTourCursor("server", currentHref),
      });
    }
    if (first) {
      const firstHref = first.route ? tourHref(first.route, activeTour.context) : `${base}/dashboard`;
      actions.push({
        id: "tour-restart",
        label: "Restart the guided tour",
        hint: "Tour",
        destination: firstHref,
        hardUnload: true,
        run: () => moveTourCursor({ chapter: first.chapter, stepId: first.id }, firstHref),
      });
    }
    return actions;
  }, [activeTour, eventId, liveTourCursor, moveTourCursor, role, serverEvent?.id, serverEvent?.isDemo, serverEvent?.organizationId, tourRunning]);

  const event: AdminShellEvent | undefined = serverEvent;
  if (!event) notFound();
  const base = `/events/${event.id}`;
  const visibleNavigation = role === "reviewer" ? reviewerNavigation : navigation;
  const activeSection = activeAdminSection(pathname, base);
  const breadcrumbTrail = adminBreadcrumbTrail(pathname, base, role);
  const accountName = user?.name.trim() || user?.email || "Maya Lin";
  const accountInitials = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ML";
  const mobileNavigation = adminMobileNavigationState(isMobile, open);
  const shell = <FirstRunHints scope="shell" ids={hintIds}><div className="app-shell">
    <a className="admin-skip-link" href="#admin-content">Skip to main content</a>
    <button ref={menuButtonRef} type="button" className="mobile-menu" aria-label="Open navigation" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
    <aside ref={sidebarRef} id="admin-navigation" className={`admin-sidebar ${open ? "open" : ""}`} aria-hidden={mobileNavigation.sidebarHidden || undefined} inert={mobileNavigation.sidebarHidden || undefined}>
      <div className="sidebar-brand"><Brand /><button ref={closeButtonRef} type="button" className="mobile-close" aria-label="Close navigation" onClick={closeMenu}><X size={18} /></button></div>
      <Hint id="shell:event-switcher" title="Your events live here" body="Switch to another event — or jump back to the full list — without losing your place." placement="right" block className="hint-on-switcher"><EventSwitcher eventId={eventId} initialEvent={{ name: event.shortName, detail: `/${event.slug}` }} canCreateEvent={canCreateEvent} nowIso={nowIso} /></Hint>
      <nav className="sidebar-nav">{visibleNavigation.map((group) => <div className="nav-group" key={group.label}><span>{group.label}</span>{group.items.map((item) => { const Icon = item.icon; const active = item.href === activeSection; const countKey = COUNT_KEY_BY_HREF[item.href]; const count = countKey ? counts?.[countKey] : undefined; const link = <Link key={item.href} href={`${base}/${item.href}`} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={closeMenu}><Icon size={18} /><b>{item.label}</b>{!!count && <em>{count}</em>}</Link>; if (item.href === "forms") return <Hint key={item.href} id="shell:program-forms" title="Start in Forms" body="Your call for speakers begins as a form. Completed entries land in Submissions, ready to review." placement="right" block className="hint-on-nav">{link}</Hint>; if (item.href === "review") return <Hint key={item.href} id="shell:review-queue" title="Your queue lives here" body="Every submission waiting on your score sits in this one list. Work it top to bottom, or dip in whenever — nothing gets lost." placement="right" block className="hint-on-nav">{link}</Hint>; return link; })}</div>)}</nav>
      {/* `/agenda`, not `/schedule`: the latter is a redirect-only legacy
          route left over from the M53 split, so every "see what attendees see"
          used to cost a needless hop. */}
      <div className="sidebar-bottom"><Hint id="shell:public-preview" title="See what attendees see" body="Opens your public event page in a new tab — a quick gut check after any change." placement="right" block className="hint-on-nav"><Link href={`/e/${event.slug}/agenda`} target="_blank"><ExternalLink size={17} /> View public event</Link></Hint>{role !== "reviewer" && <Hint id="shell:event-settings" title="Make it yours" body="Branding, dates, and the words your event uses — tracks, stages, whatever fits — all live in Event settings." placement="right" block className="hint-on-nav"><Link href={`${base}/settings`}><Settings size={17} /> Event settings</Link></Hint>}<div className="sidebar-user"><span>{accountInitials}</span><div><b>{accountName}</b><small>{role === "reviewer" ? "Reviewer" : "Organizer"}</small></div>{user && <SignOutButton kind="admin" compact />}</div></div>
    </aside>
    {open && <button type="button" tabIndex={-1} aria-label="Close navigation" className="mobile-overlay" onClick={closeMenu} />}
    <main className="app-main" inert={mobileNavigation.backgroundInert || undefined} aria-hidden={mobileNavigation.backgroundInert || undefined}><header className="topbar"><div className="breadcrumbs"><span>{event.shortName}</span>{event.isDemo && <StatusBadge value="demo" />}{breadcrumbTrail.map((crumb, index) => <Fragment key={crumb}><i>/</i>{index === breadcrumbTrail.length - 1 ? <b>{crumb}</b> : <span>{crumb}</span>}</Fragment>)}</div><div className="topbar-actions"><Hint id={role === "reviewer" ? "shell:reviewer-palette" : "shell:command-palette"} title="Jump anywhere" body={role === "reviewer" ? "Press ⌘K from any page to jump straight back to your review queue." : "Press ⌘K to search speakers, submissions and sessions, or run quick actions like assigning reviewers."} placement="bottom-end"><CommandPalette eventId={event.id} base={base} role={role} actions={paletteActions} /></Hint></div></header><div id="admin-content" className="app-content" tabIndex={-1}>{children}</div></main>
  </div></FirstRunHints>;
  // The mount sits *inside* `UnsavedWorkGuardProvider`, which is mandatory:
  // the tour navigates through `useGuardedAction()`, and that context is null
  // above the provider.
  //
  // It is a **sibling** of the shell rather than a wrapper. `ssr: false`
  // means this component renders nothing on the server, so anything passed to
  // it as children would not server-render either — an entire admin shell
  // arriving blank until hydration, on demo events only, would be a strange
  // and expensive way to mount a tutorial.
  return <UnsavedWorkGuardProvider>
    {shell}
    {activeTour && <GuidedTourMount bootstrap={activeTour} onComplete={retireShellHints} onStatusChange={handleTourStatusChange} />}
  </UnsavedWorkGuardProvider>;
}
