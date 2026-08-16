import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { DashboardTabs } from "@/features/dashboard/index.client";
import { DashboardLoadError, type DashboardTab, type DashboardTourState } from "@/features/dashboard/components/DashboardTabs";
import { resolveDashboardTab } from "@/features/dashboard/lib/dashboard-tab";
import { computeEventPhase, defaultTabForPhase } from "@/features/dashboard/lib/phase";
import { getDemoProvisionState, getDemoTourBootstrap } from "@/features/onboarding";
import { getEventOrganization } from "@/features/organizations";
import { DemoRibbon } from "@/features/onboarding/components/demo-ribbon";
import { supportedTourSteps, TOUR_CHAPTERS, unavailableTourChapters } from "@/features/onboarding/tour/script";
import { tourHref, tourProgress } from "@/shared/ui/app/guided-tour/objectives";
import { eventIdSchema } from "@/shared/contracts";
import { captureError } from "@/shared/lib/error-tracking";
import { isDefinitiveWriteFailure } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const requestedEventId = (await params).eventId;
  const requestedTab = (await searchParams).tab;
  const parsedEventId = eventIdSchema.safeParse(requestedEventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  const session = await requireAdmin(eventId, "organizer");
  let overview;
  try {
    overview = await getOverview(eventId);
  } catch (error) {
    // This page swallows the failure to keep the shell usable, which also means
    // `instrumentation.ts`'s `onRequestError` never sees it. Capture explicitly
    // so a broken overview still reaches `operational_errors` and the health
    // endpoint instead of being visible only as a fallback card — but keep
    // `defineHandler`'s law that only unexpected failures are captured, so an
    // expected AppError does not trip the `errors.recentCount` alert.
    if (!isDefinitiveWriteFailure(error)) {
      const requestId = (await headers()).get("cf-ray") ?? crypto.randomUUID();
      captureError(error, { requestId, feature: "dashboard", code: "OVERVIEW_LOAD_FAILED", eventId });
    }
    return <DashboardLoadError />;
  }
  // M56 — the default tab follows the event's lifecycle phase (same law as
  // the widget reordering below it), not a bare "any accepted speaker" check.
  const defaultTab: DashboardTab = defaultTabForPhase(computeEventPhase(overview));
  const initialTab = resolveDashboardTab(requestedTab, defaultTab);
  const firstName = session.name.trim().split(/\s+/, 1)[0] || "Organizer";

  /**
   * First Fair (design §3.6, §3.9, §5.1) — the demo dashboard's own furniture.
   *
   * One read, and `null` from it *is* the "this is a real event" answer, so a
   * customer's own dashboard pays a single indexed lookup and renders exactly
   * what it rendered before. On a demo it earns three things: the ribbon that
   * names what this is and offers every way out of it, the resume card while
   * the tutorial is paused, and the suppression of the two nudges whose job is
   * activating a *real* event.
   */
  const demoTour = await getDemoTourBootstrap(eventId, session.userId);
  let tour: DashboardTourState | undefined;
  if (demoTour) {
    const context = {
      eventId,
      eventSlug: demoTour.context.eventSlug,
      cfpFormId: demoTour.context.cfpFormId ?? "",
      editableFormId: demoTour.context.editableFormId ?? "",
      organizationId: demoTour.context.organizationId,
    };
    /**
     * The same steps the engine will be given, for the same reasons — the card
     * offers to resume *into* the tour, so picking a target the tour itself
     * will not run is how the resume href and the coach end up disagreeing.
     * Chapter availability is applied here too, which the engine does for
     * itself on the other side of the bootstrap.
     */
    const unavailable = new Set(unavailableTourChapters(demoTour.skippedAtPhase));
    const runnable = supportedTourSteps(demoTour.skippedAtPhase, context)
      .filter((step) => !unavailable.has(step.chapter));
    const cursorStep = runnable.find((step) => step.id === demoTour.stepId) ?? null;
    /**
     * A cursor pointing at a step this build no longer has — renamed or
     * retired by a release, or belonging to a chapter that never got a world.
     * The engine has no card to draw for it, so an *active* tour would leave
     * the demo dashboard with no way back into itself; the card takes over and
     * offers the next objective the organizer has not finished instead.
     */
    const stranded = demoTour.status === "active" && cursorStep === null;
    const target = cursorStep
      ?? runnable.find((candidate) => candidate.optional !== true && !demoTour.completed.includes(candidate.id))
      ?? runnable[0]
      ?? null;
    const progress = tourProgress(TOUR_CHAPTERS, runnable, target?.id ?? demoTour.stepId);
    const resumeHref = target?.route ? tourHref(target.route, context) : `/events/${eventId}/dashboard`;
    tour = {
      isDemo: true,
      // The ribbon is the event's; the resume card is the cursor's owner's.
      // Offering a co-organizer "Pick the tour back up" would hand them
      // somebody else's playthrough — see `isTourOwner`.
      ...(demoTour.isTourOwner && target && (demoTour.status === "paused" || stranded) ? {
        resume: {
          chapter: target.chapter,
          stepId: target.id,
          chapterLabel: progress.chapterIndex > 0 && progress.chapter
            ? `Chapter ${progress.chapterIndex} of ${progress.chapterCount} — ${progress.chapter.name}`
            : "Guided tour",
          percent: progress.percent,
          resumeHref,
          ...(stranded ? { stranded: true as const } : {}),
        },
      } : {}),
    };
  } else {
    /**
     * First Fair (design §1.3, entrance 3) — the pull entrance for an
     * organizer who never met the fork, on the one screen they see every day.
     *
     * Gated on the organization having no demo yet, which is the same gate the
     * other three entrances use: offering to "explore a demo event" to
     * somebody who already has one is a dead end dressed up as a suggestion.
     * Two indexed single-row reads on a page that already runs the overview
     * aggregate, and `ActivationGuide` decides for itself whether the row is
     * worth showing.
     */
    const organizationId = await getEventOrganization(eventId);
    const existingDemo = organizationId ? await getDemoProvisionState(organizationId) : null;
    if (organizationId && !existingDemo) {
      tour = { isDemo: false, tourHref: `/organizations/${organizationId}/onboarding?mode=demo` };
    }
  }

  return <>
    {demoTour && <DemoRibbon
      eventId={eventId}
      eventName={demoTour.context.eventName}
      organizationId={demoTour.context.organizationId}
    />}
    <DashboardTabs
      eventId={eventId}
      serverOverview={overview}
      initialTab={initialTab}
      firstName={firstName}
      {...(tour ? { tour } : {})}
    />
  </>;
}
