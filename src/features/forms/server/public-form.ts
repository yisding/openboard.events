import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events, forms } from "@/db/schema";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
import { type FormId, type FormSnapshot, type OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { participantRoleSettingsSchema, type ParticipantRoleSetting } from "../participant-roles";
import { getCurrentSnapshotIn } from "./snapshots";

/**
 * Everything the public CFP page needs, in one read: the event's branding, the
 * form's copy, the snapshot to render, and whether it is open.
 *
 * Openness is computed here rather than left to the client, and it comes back
 * with a *reason*. "Closed" and "not open yet" are different pages to a speaker —
 * one is an apology, the other is a date to come back on — and a boolean cannot
 * tell them apart.
 */
export type PublicFormOpenState = {
  open: boolean;
  reason: "ok" | "not_open_yet" | "closed_by_date" | "closed_by_admin";
};

export type PublicForm = {
  // The id is here because the submit and draft endpoints are event-scoped and
  // the wizard has to name the event it is submitting to. It is not a secret —
  // it is in every admin URL — but it is also not guessable, so it travels with
  // the payload rather than being derived client-side from the slug.
  event: { id: string; name: string; slug: string; timezone: string; logoUrl: string | null; backgroundUrl: string | null };
  form: {
    id: FormId;
    externalTitle: string;
    pageHeading: string;
    showWelcome: boolean;
    welcomeHtml: string | null;
    collectParticipants: boolean;
    participantRoles: Array<Pick<ParticipantRoleSetting, "role" | "enabled">>;
    successHtml: string | null;
    autoRedirectToPortal: boolean;
    /** Present so a not-open-yet page can name the date rather than say "soon". */
    opensAt: string | null;
    closesAt: string | null;
    effectiveLimit: number;
  };
  snapshot: FormSnapshot;
  openState: PublicFormOpenState;
};

/**
 * Mirrors `is_form_open`, which is the authority: `opens_at <= now` and
 * `closes_at > now`. The closing instant is closed, so a submit landing exactly
 * on the deadline is refused by the page and by the server transaction alike —
 * a page that says open while the write says FORM_CLOSED is worse than either.
 */
export function decideOpenState(
  form: { status: string; opensAt: Date | null; closesAt: Date | null },
  now: Date,
): PublicFormOpenState {
  // An admin closing a form outranks its dates: they may have closed it early,
  // and telling a speaker to "come back on the 12th" would be a lie.
  if (form.status !== "open") return { open: false, reason: "closed_by_admin" };
  if (form.opensAt && now < form.opensAt) return { open: false, reason: "not_open_yet" };
  if (form.closesAt && now >= form.closesAt) return { open: false, reason: "closed_by_date" };
  return { open: true, reason: "ok" };
}

export async function getPublicFormIn(dbOrTx: DbOrTx, eventSlug: string, formId: FormId): Promise<PublicForm> {
  const [event] = await dbOrTx
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      timezone: events.timezone,
      logoFileId: events.logoFileId,
      backgroundFileId: events.backgroundFileId,
      submissionCapPerUser: events.submissionCapPerUser,
      organizationId: events.organizationId,
    })
    .from(events)
    .where(eq(events.slug, eventSlug))
    .limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  // Scoped by the event we just resolved, so a form id from another event does
  // not render under this event's branding.
  const [form] = await dbOrTx
    .select({
      id: forms.id,
      context: forms.context,
      status: forms.status,
      externalTitle: forms.externalTitle,
      pageHeading: forms.pageHeading,
      showWelcome: forms.showWelcome,
      welcomeHtml: forms.welcomeHtml,
      collectParticipants: forms.collectParticipants,
      participantRoles: forms.participantRoles,
      successHtml: forms.successHtml,
      autoRedirectToPortal: forms.autoRedirectToPortal,
      opensAt: forms.opensAt,
      closesAt: forms.closesAt,
      submissionLimit: forms.submissionLimit,
    })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, event.id)))
    .limit(1);
  if (!form) throw new AppError("NOT_FOUND", "Form not found");
  // A portal form is not a public CFP; serving one here would expose an
  // authenticated surface to anyone with the link.
  if (form.context !== "cfp") throw new AppError("NOT_FOUND", "Form not found");

  const storedSnapshot = await getCurrentSnapshotIn(dbOrTx, event.id as Parameters<typeof getCurrentSnapshotIn>[1], formId);
  // Locked identity fields remain in every immutable authoring snapshot so the
  // builder can safely turn participant collection back on before submissions.
  // The public runtime, however, must render the collection mode stored on the
  // form rather than exposing a participant step whose fields happen to exist.
  const snapshot = form.collectParticipants
    ? storedSnapshot
    : { ...storedSnapshot, sections: storedSnapshot.sections.filter((section) => section.key !== "participant") };
  const participantRoles = participantRoleSettingsSchema.parse(form.participantRoles)
    .map(({ role, enabled }) => ({ role, enabled }));
  const openState = decideOpenState(form, new Date());
  // Unconditional on purpose: the write is first-occurrence-only via
  // onConflictDoNothing and swallows its own failures, so a pre-read to skip
  // it buys nothing — and joining the milestones table into the event lookup
  // above turned a missing product-signals table into a 500 for every
  // submitter, the exact failure tryRecord… exists to prevent.
  if (openState.open) {
    await tryRecordOrganizationOnboardingMilestoneIn(
      dbOrTx,
      event.organizationId as OrganizationId,
      "public_form_visited",
    );
  }

  return {
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      timezone: event.timezone,
      // Files are immutable, so these URLs are safe to cache for as long as the
      // page is.
      logoUrl: event.logoFileId ? `/f/${event.logoFileId}` : null,
      backgroundUrl: event.backgroundFileId ? `/f/${event.backgroundFileId}` : null,
    },
    form: {
      id: form.id as FormId,
      externalTitle: form.externalTitle,
      pageHeading: form.pageHeading,
      showWelcome: form.showWelcome,
      welcomeHtml: form.welcomeHtml,
      collectParticipants: form.collectParticipants,
      participantRoles,
      successHtml: form.successHtml,
      autoRedirectToPortal: form.autoRedirectToPortal,
      opensAt: form.opensAt ? form.opensAt.toISOString() : null,
      closesAt: form.closesAt ? form.closesAt.toISOString() : null,
      // The form's own limit wins; the event cap is the default it falls back to.
      effectiveLimit: form.submissionLimit ?? event.submissionCapPerUser,
    },
    snapshot,
    openState,
  };
}

export function getPublicForm(eventSlug: string, formId: FormId): Promise<PublicForm> {
  return getPublicFormIn(db, eventSlug, formId);
}
