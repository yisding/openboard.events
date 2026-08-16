import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminShell, type AdminShellCounts, type AdminShellEvent } from "@/features/shell/admin-shell";
import { getNavCounts, getReviewerQueueCount } from "@/features/shell/server/nav-counts";
import { shortEventName } from "@/shared/lib/event-label";
import { requireAdmin, requiredRoleForEventPath, type AdminSession } from "@/features/auth";
import { getEvent } from "@/features/events";
import { getDemoTourBootstrap } from "@/features/onboarding";
import { supportedTourSteps, TOUR_CHAPTERS, unavailableTourChapters } from "@/features/onboarding/tour/script";
import { getEventOrganization, listOrganizationsForUser, manageableOrganizations } from "@/features/organizations";
import { safeInternalPath } from "@/features/auth/safe-next";
import { eventIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import type { TourBootstrap, TourWorld } from "@/shared/ui/app/guided-tour";

/**
 * First Fair (design §8.1) — the server's world snapshot and the engine's are
 * the same numbers, but the engine's type is deliberately open (it knows
 * nothing about submissions or conflicts). Optional keys cannot cross into an
 * index signature under `exactOptionalPropertyTypes`, so absent facts are
 * dropped rather than carried as `undefined`.
 */
function toEngineWorld(values: Readonly<Record<string, number | string | boolean | null | undefined>>): TourWorld {
  const world: Record<string, number | string | boolean | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) world[key] = value;
  }
  return world;
}

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const requestedEventId = (await params).eventId;
  const parsedEventId = eventIdSchema.safeParse(requestedEventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"));
  let session: AdminSession | null = null;
  try {
    session = await requireAdmin(eventId, requiredRoleForEventPath(eventId, requestPath));
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    if (error.code === "FORBIDDEN") {
      return <main className="empty-state"><h1>Access denied</h1><p>You do not have access to this event surface.</p><Link className="button button-primary" href="/events">Choose another event</Link></main>;
    }
    throw error;
  }
  // The shell's own event data comes from this server read, so the chrome shows
  // the same event the guard above authorized. Read after the guard, so an
  // unauthorized caller never learns whether the event exists.
  //
  // First Fair (design §3.1, §8.2). One read answers two questions: "is this
  // the organization's demo event" and "where is its tutorial". It returns
  // `null` for a real event — that null *is* the marker, so there is no second
  // query and no second source of truth — and the join it does costs an index
  // lookup that finds nothing, which is what a real-event organizer pays.
  //
  // Reviewers never take the tour (design §3.8), and the tour's own API is
  // organizer-gated, so their shell never asks.
  const [record, organizationMemberships, demoTour, organizationId] = await Promise.all([
    getEvent(eventId),
    listOrganizationsForUser(session.userId),
    session.role === "reviewer" ? null : getDemoTourBootstrap(eventId, session.userId),
    // One indexed column, read in parallel with everything else: the demo
    // lives one level above any single event, so the palette's "Explore a demo
    // event" needs to know which organization this event belongs to.
    session.role === "reviewer" ? null : getEventOrganization(eventId),
  ]);
  if (!record) notFound();
  const shellEvent: AdminShellEvent = {
    id: record.id,
    slug: record.slug,
    name: record.name,
    shortName: shortEventName(record.name),
    isDemo: demoTour !== null,
    ...(organizationId ? { organizationId } : {}),
  };

  /**
   * The script reaches the shell as a prop, assembled here.
   *
   * This is the whole reason `architecture:check` still sees `shell -> shared`
   * and nothing else: `AdminShell` takes a *generic* `TourBootstrap` and has no
   * idea what a demo event is, while the ~8 KB of tutorial copy travels in this
   * route's RSC payload only when there is a tutorial to travel for.
   *
   * `provisionReady` gates it: a world that is still being built has nothing
   * for a step to point at, and the cursor's own writer refuses to go `active`
   * before the last phase lands.
   *
   * `isTourOwner` gates it too. `shellEvent.isDemo` above is deliberately
   * *not* gated on it — a co-organizer of the demo still gets the ribbon, the
   * badge and the demo-aware palette — but the cursor belongs to one
   * organizer, and mounting a second player on it would hand them a baseline
   * captured from somebody else's `reviewsByMe`.
   */
  const tour: TourBootstrap | null = demoTour && demoTour.provisionReady && demoTour.isTourOwner ? {
    scopeId: eventId,
    statePath: `events/${eventId}/tour`,
    stepsPath: `events/${eventId}/tour/steps`,
    chapters: TOUR_CHAPTERS,
    // Not the whole script: the two side quests whose payload comes from a
    // later phase than their chapter's, and any step whose route needs a
    // context id this world does not have, cannot run here. Chapter-level
    // availability stays below, where the engine can apologise for it.
    steps: supportedTourSteps(demoTour.skippedAtPhase, demoTour.context),
    // Design §2.8. "Continue without it" reaches `ready` without the phase
    // that would not take, so the chapters that phase (and everything after
    // it) was going to fill are dropped with an honest line rather than
    // pointing the player at an empty screen. Empty for every world that
    // built in full, which is nearly all of them.
    unavailableChapters: unavailableTourChapters(demoTour.skippedAtPhase),
    cursor: {
      chapter: demoTour.chapter,
      stepId: demoTour.stepId,
      status: demoTour.status,
      armedStepId: demoTour.armedStepId,
      armedBaseline: demoTour.armedBaseline ? toEngineWorld(demoTour.armedBaseline) : null,
    },
    completed: demoTour.completed,
    questsDone: demoTour.questsDone,
    world: toEngineWorld(demoTour.world),
    context: {
      eventId,
      eventSlug: demoTour.context.eventSlug,
      // Provisioning always writes the call for speakers, so this is only ever
      // empty on a demo whose forms phase was skipped — in which case
      // `unavailableChapters` above has already dropped the chapters that
      // would have routed into it.
      cfpFormId: demoTour.context.cfpFormId ?? "",
      // The one form the builder will still let an organizer restructure —
      // "the first form carrying no non-draft submission", which is a fact
      // about the *world*, not about provisioning: it goes null in ordinary
      // free play once every form has been answered. `supportedTourSteps`
      // above is what keeps that from becoming a navigation to `/forms/`.
      editableFormId: demoTour.context.editableFormId ?? "",
      organizationId: demoTour.context.organizationId,
    },
  } : null;
  // M56 — real, actionable sidebar counts. Reviewers only ever see the review
  // nav item, so they get their own outstanding-work count instead of the
  // organizer figures they are not allowed to read (M50's closed reviewer
  // surface list).
  let counts: AdminShellCounts | undefined;
  if (session) {
    if (session.role === "reviewer") {
      counts = { review: await getReviewerQueueCount(eventId, session.userId) };
    } else {
      const nav = await getNavCounts(eventId);
      counts = { abstracts: nav.abstractsPending, speakers: nav.speakersMissing, tasks: nav.tasksOverdue };
    }
  }
  return <AdminShell
    eventId={eventId}
    role={session?.role ?? "owner"}
    event={shellEvent}
    canCreateEvent={manageableOrganizations(organizationMemberships).length > 0}
    nowIso={new Date().toISOString()}
    {...(counts ? { counts } : {})}
    {...(tour ? { tour } : {})}
    {...(session ? { user: { name: session.name, email: session.email } } : {})}
  >{children}</AdminShell>;
}
