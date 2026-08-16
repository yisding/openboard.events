import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganization, listOrganizationEvents } from "@/features/organizations";
import { getEvent, listTracks } from "@/features/events";
import { formOpenState, getFormForBuilder } from "@/features/forms";
import { getActiveOrganizationOnboardingForUser, getDemoProvisionState, getOrganizationOnboardingForUserByEvent } from "@/features/onboarding";
import { OnboardingWizard, type OnboardingResumeState } from "@/features/onboarding/components/onboarding-wizard";
import { StartFork } from "@/features/onboarding/components/start-fork";
import { PageHeader } from "@/shared/ui/ui-kit";
import { eventIdSchema, organizationIdSchema, type UserId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Set up your event" };
export const dynamic = "force-dynamic";

async function getReservedOnboardingForm(eventId: Parameters<typeof getFormForBuilder>[0], formId: Parameters<typeof getFormForBuilder>[1]) {
  try {
    return await getFormForBuilder(eventId, formId, "cfp");
  } catch (error) {
    // The checkpoint reserves its stable ID before POST. A refresh between
    // those operations should retry creation with that ID, not fail the page.
    if (isAppError(error) && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/**
 * M45 — the guided setup wizard's page shell. This is the replacement for
 * the "manual provisioning runbook" the roadmap names: a signed-up
 * organization reaches this from `/organizations` (first event) or its
 * organization home's "Create event" button (subsequent events) and leaves
 * with a scoped event, a couple of tracks, and a shareable CFP link — the
 * `docs/user-flows.md` "under 15 minutes, no documentation" bar.
 */
export default async function Page({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ event?: string; mode?: string }>;
}) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;
  const query = await searchParams;
  const nowIso = new Date().toISOString();
  const requestedEvent = query.event ? eventIdSchema.safeParse(query.event) : null;
  if (requestedEvent && !requestedEvent.success) notFound();

  let actorUserId: UserId | null = null;
  try {
    const session = await requireOrganizationAdmin(organizationId, "organizer");
    actorUserId = session.userId;
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }
  if (!actorUserId) notFound();

  const [organization, eventRows, progress, demo] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationEvents(organizationId),
    requestedEvent?.success
      ? getOrganizationOnboardingForUserByEvent(organizationId, actorUserId, requestedEvent.data)
      : getActiveOrganizationOnboardingForUser(organizationId, actorUserId),
    getDemoProvisionState(organizationId),
  ]);
  if (!organization) notFound();
  if (requestedEvent?.success && !progress) notFound();

  /**
   * First Fair (design §1.1) — the fork, above the wizard and in the wizard's
   * own route, so `ORGANIZER_ONLY_PAGES` needs no new entry and every existing
   * entrance reaches it unchanged.
   *
   * The order of these four questions is the whole product decision:
   *   1. An explicit `?mode=create` always wins. Somebody who pressed a button
   *      called "Create event" has answered this question already.
   *   2. An open checkpoint outranks a tutorial — a half-built real event is
   *      real work (Trap C).
   *   3. An organization that already runs events is never interrupted, unless
   *      it asked for the demo by name with `?mode=demo`.
   *   4. Otherwise: the choice, in whichever of its two shapes fits.
   */
  const wantsCreate = query.mode === "create";
  const wantsDemo = query.mode === "demo";
  // Trap B, the same one the organization home's redirect matrix names: the
  // moment the demo exists, an unfiltered `eventRows.length === 0` goes false
  // and question 3 below starts treating a tutorial as "an organization that
  // already runs events". An organization holding nothing but its demo, coming
  // in on a bare `/onboarding` (a bookmark, a docs link, the post-signup
  // landing), would drop straight into the create-event wizard rather than the
  // "Your demo conference is waiting" fork this very block renders for it.
  const realEventCount = eventRows.filter((row) => row.id !== demo?.eventId).length;
  const showFork = !wantsCreate && !progress && (realEventCount === 0 || wantsDemo);
  if (showFork) {
    return <>
      <PageHeader
        eyebrow="ORGANIZATION"
        title={demo ? "Your demo conference is waiting" : `Welcome to ${organization.name}`}
        description={demo
          ? "Pick it back up, or set up your own event — the demo stays where it is either way."
          // Names both doors and what each one costs. "One of them takes ten
          // minutes and cannot break anything" described the demo without
          // saying it was the demo, so the sentence read as a riddle and its
          // reassurance — nothing here is load-bearing — landed as a warning
          // that something might be.
          : "Explore a finished conference in about ten minutes, or start setting up your own."}
      />
      <StartFork organizationId={organizationId} demo={demo} />
    </>;
  }

  let initialState: OnboardingResumeState | null = null;
  if (progress) {
    const [event, tracks, form] = await Promise.all([
      getEvent(progress.eventId),
      listTracks(progress.eventId),
      progress.formId ? getReservedOnboardingForm(progress.eventId, progress.formId) : null,
    ]);
    if (event) {
      if (progress.step === "complete" && !form) notFound();
      initialState = {
        event,
        tracks,
        step: progress.step === "complete" ? "complete" : form ? "form" : progress.step,
        formId: progress.formId,
        form: form ? {
          id: form.id,
          status: form.status,
          updatedAt: form.updatedAt,
          internalName: form.internalName,
          opensAt: form.opensAt,
          closesAt: form.closesAt,
        } : null,
        publicFormUrl: progress.step === "complete" && form
          ? `${getEnv().APP_BASE_URL}/submit/${event.slug}/${form.id}`
          : null,
        formAvailability: progress.step === "complete" && form
          ? formOpenState({ status: form.status, opensAt: form.opensAt, closesAt: form.closesAt }, nowIso)
          : null,
      };
    }
  }
  return <>
    <PageHeader
      eyebrow="ORGANIZATION"
      title={initialState?.step === "complete" ? "Setup complete" : initialState ? `Finish setting up ${initialState.event.name}` : "Set up your event"}
      description={initialState?.step === "complete"
        ? "Your setup is complete. Keep sharing the public form or continue into your event workspace."
        : initialState
          ? "Your progress was saved. Continue where you left off."
        : "Add the essentials, organize submissions with optional tracks, then publish your call for speakers."}
    />
    <OnboardingWizard
      organizationId={organizationId}
      organizationName={organization.name}
      hasExistingEvents={eventRows.length > 0}
      hasDemoEvent={demo !== null && demo.done}
      initialState={initialState}
      nowIso={nowIso}
    />
  </>;
}
