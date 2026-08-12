import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganization, listOrganizationEvents } from "@/features/organizations";
import { getEvent, listTracks } from "@/features/events";
import { getFormForBuilder } from "@/features/forms";
import { getActiveOrganizationOnboardingForUser, getOrganizationOnboardingForUserByEvent } from "@/features/onboarding";
import { OnboardingWizard, type OnboardingResumeState } from "@/features/onboarding/components/onboarding-wizard";
import { PageHeader } from "@/shared/ui/ui-kit";
import { eventIdSchema, organizationIdSchema, type UserId } from "@/shared/contracts";
import { getEnv, isCredentialFreeLocalDemo } from "@/shared/lib/env";
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
  searchParams: Promise<{ event?: string }>;
}) {
  if (isCredentialFreeLocalDemo()) {
    return <PageHeader eyebrow="ORGANIZATION" title="Set up your event" description="Guided setup is unavailable in the credential-free demo." />;
  }
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;
  const query = await searchParams;
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

  const [organization, eventRows, progress] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationEvents(organizationId),
    requestedEvent?.success
      ? getOrganizationOnboardingForUserByEvent(organizationId, actorUserId, requestedEvent.data)
      : getActiveOrganizationOnboardingForUser(organizationId, actorUserId),
  ]);
  if (!organization) notFound();
  if (requestedEvent?.success && !progress) notFound();

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
        form: form ? { id: form.id, status: form.status, updatedAt: form.updatedAt, internalName: form.internalName } : null,
        publicFormUrl: progress.step === "complete" && form
          ? `${getEnv().APP_BASE_URL}/submit/${event.slug}/${form.id}`
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
      initialState={initialState}
    />
  </>;
}
