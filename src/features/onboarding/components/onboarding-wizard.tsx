"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Plus, Sparkles, Trash2, UserPlus } from "lucide-react";
import { z } from "zod";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { eventDtoSchema, trackDtoSchema, type EventDTO, type OrganizationId, type TrackDTO } from "@/shared/contracts";
import type { OnboardingStep } from "../progress-types";
import { EVENT_TYPES, type EventType } from "@/features/events/index.schemas";
import { formOpenState, type FormOpenReason } from "@/features/forms/index.availability";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";
import { endOfDayInTz, eventDayKey, formatInZone, timeZoneOptionLabel } from "@/shared/lib/time";

const DEFAULT_TZ = "America/Los_Angeles";
const CUSTOM_TRACK_COLOR = DEFAULT_BRAND_COLOR;
const SUGGESTED_TRACKS: Array<{ name: string; color: string }> = [
  { name: "Main Stage", color: "#00a878" },
  { name: "Workshops", color: "#2a6486" },
  { name: "Lightning Talks", color: "#8a5312" },
];
const STEPS = ["Event details", "Tracks", "First form", "Share"] as const;
const RENDERED_FIELDS = new Set(["name", "slug", "eventType", "timezone", "startsAt", "endsAt"]);
const deletedSchema = z.object({ deleted: z.boolean() });
const tracksListSchema = z.array(trackDtoSchema);
const FIELD_IDS: Record<string, string> = {
  name: "onboarding-event-name",
  slug: "onboarding-event-slug",
  eventType: "onboarding-event-type",
  timezone: "onboarding-event-timezone",
  startsAt: "onboarding-event-starts-at",
  endsAt: "onboarding-event-ends-at",
};

export function OnboardingStepHeading({ step, headingRef }: { step: 1 | 2 | 3 | 4; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return <h2 ref={headingRef} tabIndex={-1} className="sr-only">Step {step}: {STEPS[step - 1]}</h2>;
}

function browserTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return [DEFAULT_TZ, "America/New_York", "America/Chicago", "America/Denver", "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC"];
  }
}

export function preferredTimeZone(candidate: string | undefined, supported: readonly string[]): string {
  return candidate === "UTC" || (candidate && supported.includes(candidate)) ? candidate : DEFAULT_TZ;
}

// `BuilderForm` (features/forms/builder-types.ts) has no shared zod contract
// — the existing CFP builder pages (`forms-page.tsx`, `form-builder.tsx`)
// read its create/update responses with this same hand-rolled envelope
// reader rather than a schema, and this wizard follows that precedent
// instead of inventing a client-side validator for a type it does not own.
type BuilderFormLite = {
  id: string;
  status: string;
  updatedAt: string;
  internalName?: string;
  opensAt?: string | null;
  closesAt?: string | null;
};

type OnboardingFormAvailability = { open: boolean; reason: FormOpenReason };
type OnboardingEventFields = {
  name: string;
  slug: string | undefined;
  eventType: EventType;
  timezone: string;
  startsAt: string;
  endsAt: string;
};

export type CfpDeadlineChoice = "four_weeks" | "two_weeks" | "one_week" | "custom" | "none";

export function onboardingEventCreateOutcomeUnknown(error: unknown): boolean {
  return !isAppError(error) || error.code === "INTERNAL";
}

export function retainOnboardingEventCreateFields(
  retained: OnboardingEventFields | null,
  candidate: OnboardingEventFields,
): OnboardingEventFields {
  return retained ?? candidate;
}

const CFP_DEADLINE_PRESETS: ReadonlyArray<{ choice: Exclude<CfpDeadlineChoice, "custom" | "none">; weeks: number; label: string }> = [
  { choice: "four_weeks", weeks: 4, label: "4 weeks before the event" },
  { choice: "two_weeks", weeks: 2, label: "2 weeks before the event" },
  { choice: "one_week", weeks: 1, label: "1 week before the event" },
];

/**
 * Calendar-week presets stay anchored to the event's local calendar rather
 * than subtracting UTC hours. A daylight-saving boundary can make "28 days"
 * land at 10:59 PM or 12:59 AM locally; CFP deadlines should keep the much
 * simpler promise that the selected local day remains open through 11:59 PM.
 */
export function cfpDeadlineForWeeksBefore(eventStartsAt: string, timezone: string, weeks: number): string {
  const eventDay = eventDayKey(eventStartsAt, timezone);
  const calendar = new Date(`${eventDay}T12:00:00.000Z`);
  calendar.setUTCDate(calendar.getUTCDate() - weeks * 7);
  return endOfDayInTz(calendar.toISOString().slice(0, 10), timezone).toISOString();
}

export function resolveCfpDeadline(choice: CfpDeadlineChoice, customClosesAt: string | null, eventStartsAt: string, timezone: string): string | null {
  if (choice === "none") return null;
  if (choice === "custom") return customClosesAt;
  const preset = CFP_DEADLINE_PRESETS.find((candidate) => candidate.choice === choice);
  return preset ? cfpDeadlineForWeeksBefore(eventStartsAt, timezone, preset.weeks) : null;
}

/** Prefer the earliest useful preset; for a near-term event, fall back to the
 * previous local day. Only very short-notice or already-started events begin
 * with the organizer's explicit "No deadline" escape hatch selected. */
export function defaultCfpDeadline(eventStartsAt: string, timezone: string, nowIso: string): { choice: CfpDeadlineChoice; customClosesAt: string | null } {
  const now = Date.parse(nowIso);
  const eventStart = Date.parse(eventStartsAt);
  for (const preset of CFP_DEADLINE_PRESETS) {
    const closesAt = cfpDeadlineForWeeksBefore(eventStartsAt, timezone, preset.weeks);
    if (Date.parse(closesAt) > now && Date.parse(closesAt) < eventStart) {
      return { choice: preset.choice, customClosesAt: null };
    }
  }

  const eventDay = new Date(`${eventDayKey(eventStartsAt, timezone)}T12:00:00.000Z`);
  eventDay.setUTCDate(eventDay.getUTCDate() - 1);
  const previousDay = endOfDayInTz(eventDay.toISOString().slice(0, 10), timezone).toISOString();
  return Date.parse(previousDay) > now && Date.parse(previousDay) < eventStart
    ? { choice: "custom", customClosesAt: previousDay }
    : { choice: "none", customClosesAt: null };
}

function onboardingFormAvailability(form: BuilderFormLite, nowIso = new Date().toISOString()): OnboardingFormAvailability {
  if (form.status !== "open") return { open: false, reason: "closed_by_admin" };
  return formOpenState({
    status: "open",
    opensAt: form.opensAt ?? null,
    closesAt: form.closesAt ?? null,
  }, nowIso);
}

export type OnboardingResumeState = {
  step: OnboardingStep | "complete";
  event: EventDTO;
  tracks: TrackDTO[];
  formId: string | null;
  form: BuilderFormLite | null;
  publicFormUrl: string | null;
  formAvailability: OnboardingFormAvailability | null;
};

type OnboardingTrackCreate = { id: string; name: string; color: string };

export async function saveOnboardingEvent(input: {
  existing: EventDTO | null;
  create: () => Promise<EventDTO>;
  update: (eventId: EventDTO["id"], expectedRowVersion: number) => Promise<EventDTO>;
}): Promise<EventDTO> {
  return input.existing
    ? input.update(input.existing.id, input.existing.rowVersion)
    : input.create();
}

export async function createAndReconcileOnboardingTrack(input: {
  request: OnboardingTrackCreate;
  create: () => Promise<TrackDTO>;
  list: () => Promise<TrackDTO[]>;
}): Promise<
  | { status: "added"; track: TrackDTO }
  | { status: "refused"; error: unknown }
  | { status: "unconfirmed"; error: unknown }
> {
  try {
    return { status: "added", track: await input.create() };
  } catch (error) {
    if (isAppError(error) && error.code !== "INTERNAL") return { status: "refused", error };
    try {
      // The create endpoint treats this stable id as a correlation token, so
      // a replay either creates the row or returns the exact committed row.
      return { status: "added", track: await input.create() };
    } catch (retryError) {
      if (isAppError(retryError) && retryError.code !== "INTERNAL") {
        return { status: "refused", error: retryError };
      }
      try {
        const tracks = await input.list();
        const committed = tracks.find((track) => track.id === input.request.id);
        if (committed) return { status: "added", track: committed };
      } catch {
        // The caller keeps setup blocked behind another stable-id replay.
      }
      return { status: "unconfirmed", error };
    }
  }
}

export async function deleteAndReconcileOnboardingTrack(input: {
  trackId: string;
  remove: () => Promise<unknown>;
  list: () => Promise<TrackDTO[]>;
}): Promise<
  | { status: "removed"; tracks?: TrackDTO[] }
  | { status: "restored"; tracks: TrackDTO[]; error: unknown }
  | { status: "unconfirmed"; error: unknown }
> {
  try {
    await input.remove();
    return { status: "removed" };
  } catch (error) {
    // A structured non-INTERNAL response means the server completed the
    // request and refused it before the mutation. In that case a list read is
    // causally safe and can restore the authoritative row (or observe a
    // concurrent deletion by someone else).
    if (!isAppError(error) || error.code === "INTERNAL") {
      try {
        // DELETE is idempotent. Waiting for a successful replay establishes
        // completion even when the first request is still running after its
        // connection was interrupted; a GET alone could overtake that write.
        await input.remove();
        return { status: "removed" };
      } catch {
        // If both responses are ambiguous, absence is final but presence is
        // not: the original write may still remove a row returned by this GET.
        try {
          const tracks = await input.list();
          if (!tracks.some((track) => track.id === input.trackId)) return { status: "removed", tracks };
        } catch {
          // The caller blocks progress behind another idempotent retry.
        }
        return { status: "unconfirmed", error };
      }
    }
    try {
      const tracks = await input.list();
      return tracks.some((track) => track.id === input.trackId)
        ? { status: "restored", tracks, error }
        : { status: "removed", tracks };
    } catch {
      return { status: "unconfirmed", error };
    }
  }
}

export async function createOrPublishOnboardingForm(input: {
  existing: BuilderFormLite | null;
  publishNow: boolean;
  create: () => Promise<BuilderFormLite>;
  reconcile: (form: BuilderFormLite) => Promise<BuilderFormLite>;
  publish: (form: BuilderFormLite) => Promise<BuilderFormLite>;
  validatePublish?: (form: BuilderFormLite) => void;
  onReady: (form: BuilderFormLite) => void | Promise<void>;
}): Promise<BuilderFormLite> {
  let form = input.existing ?? await input.create();
  // A previous PATCH may have committed even if its response was lost. Always
  // reconcile an existing form before deciding whether to publish or continue
  // as a draft, so neither path trusts a stale status/updatedAt pair.
  if (input.existing) form = await input.reconcile(form);
  // Associate the exact form with the durable checkpoint before publication.
  // This is intentionally replayed for an existing form, so a lost checkpoint
  // response cannot make resume fall back to some unrelated CFP form.
  await input.onReady(form);

  if (!input.publishNow || form.status === "open") return form;
  input.validatePublish?.(form);
  try {
    return await input.publish(form);
  } catch (publishError) {
    // A transport failure cannot tell us whether the server committed. If the
    // form is now open, treat the operation as successful; otherwise retain the
    // original publication error. A failed GET remains retryable because the
    // next attempt reconciles before issuing another PATCH.
    try {
      const current = await input.reconcile(form);
      if (current.status === "open") return current;
    } catch {
      // Preserve the more useful mutation failure below.
    }
    throw publishError;
  }
}

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  // Calls routed through this helper are replay-safe onboarding operations:
  // reads, idempotent progress checkpoints, a stable-ID form create, or a
  // version-checked form update. Replay one transport/5xx failure so an edge
  // hiccup does not force a customer to reconstruct which setup step saved.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    let payload: { data?: T; error?: { message?: string } };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      if (attempt === 0 && (response.ok || response.status >= 500)) continue;
      throw new Error("That request failed");
    }
    if (response.ok && payload.data !== undefined) return payload.data;
    if (attempt === 0 && response.status >= 500) continue;
    throw new Error(payload.error?.message ?? "That request failed");
  }
  throw new Error("That request failed");
}

/**
 * M45 — the guided setup wizard: event basics, vocabulary, first form. Each
 * step's "save" is a call to an existing route from M11 (event create + vocab
 * create), M45's own composition route (organization-scoped event create),
 * or M12 (form create + the generic form PATCH that publishes it) — this
 * component owns no mutation of its own, only the sequencing and the
 * "under 15 minutes, no docs" framing (`docs/user-flows.md`).
 */
export function OnboardingWizard({
  organizationId,
  organizationName,
  hasExistingEvents,
  initialState = null,
  nowIso = new Date().toISOString(),
}: {
  organizationId: OrganizationId;
  organizationName: string;
  hasExistingEvents: boolean;
  initialState?: OnboardingResumeState | null;
  nowIso?: string;
}) {
  const { toast } = useToast();
  const timeZones = useMemo(browserTimeZones, []);
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => initialState?.step === "complete" ? 4 : initialState?.step === "form" ? 3 : initialState ? 2 : 1);

  // Step 1 — event basics
  const [name, setName] = useState(initialState?.event.name ?? "");
  const [slug, setSlug] = useState(initialState?.event.slug ?? "");
  const [eventType, setEventType] = useState<EventType>((initialState?.event.eventType as EventType | undefined) ?? "conference");
  const [timezone, setTimezone] = useState(initialState?.event.timezone ?? DEFAULT_TZ);
  const [startsAt, setStartsAt] = useState<string | null>(initialState?.event.startsAt ?? null);
  const [endsAt, setEndsAt] = useState<string | null>(initialState?.event.endsAt ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [eventCreateRecoveryRequired, setEventCreateRecoveryRequired] = useState(false);
  const [event, setEvent] = useState<EventDTO | null>(initialState?.event ?? null);
  const [eventCreateId] = useState(() => crypto.randomUUID());
  const eventCreateFieldsRef = useRef<OnboardingEventFields | null>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const slugDetailsRef = useRef<HTMLDetailsElement>(null);
  const formLinkRef = useRef<HTMLInputElement>(null);
  const previousStepRef = useRef(step);

  useEffect(() => {
    // Controlled fields are rendered on the server before React can attach
    // their handlers. Keep the event step read-only until hydration so a fast
    // first edit cannot be replaced by the initial client state.
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (initialState?.event) return;
    setTimezone(preferredTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone, timeZones));
  }, [initialState?.event, timeZones]);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    return focusOnNextFrame(stepHeadingRef);
  }, [step]);

  // Step 2 — vocabulary (tracks only — rooms/formats/tags are fine to leave
  // for the settings hub; tracks are the one that gates the form/routing UI).
  const [tracks, setTracks] = useState<TrackDTO[]>(initialState?.tracks ?? []);
  const [trackName, setTrackName] = useState("");
  const [addingTrack, setAddingTrack] = useState(false);
  const [trackCreateSyncError, setTrackCreateSyncError] = useState<OnboardingTrackCreate | null>(null);
  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  const [pendingTrackDelete, setPendingTrackDelete] = useState<TrackDTO | null>(null);
  const [trackSyncError, setTrackSyncError] = useState<TrackDTO | null>(null);
  const [advancing, setAdvancing] = useState(false);

  // Step 3 — first form
  const [formName, setFormName] = useState(initialState?.form?.internalName ?? "Call for Speakers");
  const [publishNow, setPublishNow] = useState(true);
  const [creatingForm, setCreatingForm] = useState(false);
  const [pendingFormPublication, setPendingFormPublication] = useState(false);
  const [formLink, setFormLink] = useState(initialState?.publicFormUrl ?? "");
  const [formStatus, setFormStatus] = useState(initialState?.form?.status ?? "draft");
  const [formAvailability, setFormAvailability] = useState<OnboardingFormAvailability>(
    initialState?.formAvailability ?? { open: false, reason: "closed_by_admin" },
  );
  const [createdForm, setCreatedForm] = useState<BuilderFormLite | null>(initialState?.form ?? null);
  const [formCreateId] = useState(() => initialState?.formId ?? crypto.randomUUID());
  const [deadlineChoice, setDeadlineChoice] = useState<CfpDeadlineChoice>(() => {
    if (initialState?.form?.closesAt) return "custom";
    if (initialState?.form?.status === "open") return "none";
    return initialState?.event
      ? defaultCfpDeadline(initialState.event.startsAt, initialState.event.timezone, nowIso).choice
      : "four_weeks";
  });
  const [customClosesAt, setCustomClosesAt] = useState<string | null>(() => {
    if (initialState?.form?.closesAt) return initialState.form.closesAt;
    if (!initialState?.event) return null;
    return defaultCfpDeadline(initialState.event.startsAt, initialState.event.timezone, nowIso).customClosesAt;
  });
  const [deadlineError, setDeadlineError] = useState("");

  function fail(summary: string, fields: Record<string, string> = {}) {
    const shownInline = Object.keys(fields).some((key) => RENDERED_FIELDS.has(key));
    setError(shownInline ? "" : summary);
    setFieldErrors(fields);
    if (!summary && Object.keys(fields).length === 0) return;
    const firstInvalid = Object.keys(fields).find((key) => RENDERED_FIELDS.has(key));
    if (firstInvalid === "slug" && slugDetailsRef.current) slugDetailsRef.current.open = true;
    requestAnimationFrame(() => {
      if (firstInvalid) document.getElementById(FIELD_IDS[firstInvalid] ?? "")?.focus();
      else summaryRef.current?.focus();
    });
  }

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function syncEventFields(saved: EventDTO) {
    setName(saved.name);
    setSlug(saved.slug);
    setEventType(saved.eventType as EventType);
    setTimezone(saved.timezone);
    setStartsAt(saved.startsAt);
    setEndsAt(saved.endsAt);
  }

  async function saveEventStep() {
    if (!name.trim()) return fail("Event name is required", { name: "Event name is required" });
    if (event && !slug.trim()) return fail("Event slug is required", { slug: "Event slug is required" });
    if (!startsAt || !endsAt) {
      return fail("Both start and end dates are required", {
        ...(startsAt ? {} : { startsAt: "Start date and time are required" }),
        ...(endsAt ? {} : { endsAt: "End date and time are required" }),
      });
    }
    setSaving(true);
    fail("");
    try {
      const candidateFields: OnboardingEventFields = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        eventType,
        timezone,
        startsAt,
        endsAt,
      };
      const fields = event
        ? candidateFields
        : retainOnboardingEventCreateFields(eventCreateFieldsRef.current, candidateFields);
      if (!event) eventCreateFieldsRef.current = fields;
      const saved = await saveOnboardingEvent({
        existing: event,
        create: () => api(`organizations/${organizationId}/onboarding/event`, eventDtoSchema, {
          method: "POST",
          body: { id: eventCreateId, ...fields },
        }),
        update: (eventId, expectedRowVersion) => api(`events/${eventId}`, eventDtoSchema, {
          method: "PATCH",
          body: { expectedRowVersion, patch: fields },
        }),
      });
      eventCreateFieldsRef.current = null;
      setEventCreateRecoveryRequired(false);
      setEvent(saved);
      syncEventFields(saved);
      if (!event) {
        const deadline = defaultCfpDeadline(saved.startsAt, saved.timezone, nowIso);
        setDeadlineChoice(deadline.choice);
        setCustomClosesAt(deadline.customClosesAt);
      }
      toast(event ? `${saved.name} updated` : `${saved.name} created`);
      setStep(2);
    } catch (caught) {
      const outcomeUnknown = !event && onboardingEventCreateOutcomeUnknown(caught);
      setEventCreateRecoveryRequired(outcomeUnknown);
      if (!outcomeUnknown) eventCreateFieldsRef.current = null;
      const fields = isAppError(caught) ? caught.fieldErrors : undefined;
      const summary = outcomeUnknown
        ? "Creation could not be confirmed."
        : caught instanceof Error ? caught.message : "That event did not save";
      fail(summary, outcomeUnknown ? {} : fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  async function addTrack(candidateName: string, color: string, requestId = crypto.randomUUID()) {
    const request = { id: requestId, name: candidateName.trim(), color };
    if (!event || !request.name || addingTrack || removingTrackId || trackSyncError) return;
    if (trackCreateSyncError && trackCreateSyncError.id !== request.id) return;
    if (tracks.some((track) => track.name.toLowerCase() === request.name.toLowerCase())) return;
    setAddingTrack(true);
    const result = await createAndReconcileOnboardingTrack({
      request,
      create: () => api(`events/${event.id}/vocab/tracks`, trackDtoSchema, {
        method: "POST",
        body: request,
      }),
      list: () => api(`events/${event.id}/vocab/tracks`, tracksListSchema),
    });
    if (result.status === "added") {
      setTracks((current) => current.some((track) => track.id === result.track.id) ? current : [...current, result.track]);
      setTrackName((current) => current.trim() === request.name ? "" : current);
      setTrackCreateSyncError(null);
      toast(`${result.track.name} added`);
    } else if (result.status === "refused") {
      setTrackCreateSyncError(null);
      toast(isAppError(result.error) ? result.error.message : "That track could not be added", { kind: "error" });
    } else {
      setTrackCreateSyncError(request);
      toast("We could not confirm whether that track was added", { kind: "error" });
    }
    setAddingTrack(false);
  }

  async function removeTrack(track: TrackDTO) {
    if (!event || addingTrack || trackCreateSyncError || removingTrackId) return;
    if (!tracks.some((candidate) => candidate.id === track.id) && trackSyncError?.id !== track.id) return;
    setRemovingTrackId(track.id);
    setTracks((current) => current.filter((candidate) => candidate.id !== track.id));
    const result = await deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove: () => api(`events/${event.id}/vocab/tracks/${track.id}`, deletedSchema, { method: "DELETE" }),
      list: () => api(`events/${event.id}/vocab/tracks`, tracksListSchema),
    });
    if (result.status === "removed") {
      if (result.tracks) setTracks(result.tracks);
      setTrackSyncError(null);
      toast(`${track.name} removed`);
    } else if (result.status === "restored") {
      setTracks(result.tracks);
      setTrackSyncError(null);
      toast(isAppError(result.error) ? result.error.message : "That track could not be removed", { kind: "error" });
    } else {
      // The delete and the reconciliation request both failed, so neither a
      // restored nor a removed row would be truthful. Keep progress blocked
      // until an idempotent delete retry establishes the server state.
      setTrackSyncError(track);
      toast("We could not confirm whether that track was removed", { kind: "error" });
    }
    setRemovingTrackId(null);
  }

  async function continueToForm() {
    if (!event || advancing || addingTrack || trackCreateSyncError || removingTrackId || trackSyncError) return;
    setAdvancing(true);
    try {
      await requestData(`/api/internal/organizations/${organizationId}/onboarding/event`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, step: "form" }),
      });
      setStep(3);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Setup progress could not be saved", { kind: "error" });
    } finally {
      setAdvancing(false);
    }
  }

  function validateDeadline(closesAt: string | null) {
    if (!event || !publishNow || deadlineChoice === "none") return true;
    const failDeadline = (message: string) => {
      setDeadlineError(message);
      requestAnimationFrame(() => document.getElementById(
        deadlineChoice === "custom" ? "onboarding-cfp-custom-deadline" : "onboarding-cfp-deadline",
      )?.focus());
    };
    if (!closesAt) {
      failDeadline("Choose a closing date or select No deadline");
      return false;
    }
    if (Date.parse(closesAt) <= Date.now()) {
      failDeadline("Choose a closing date in the future");
      return false;
    }
    if (Date.parse(closesAt) >= Date.parse(event.startsAt)) {
      failDeadline("Choose a closing date before the event starts");
      return false;
    }
    return true;
  }

  async function completeFormStep(finalForm: BuilderFormLite) {
    if (!event) return;
    const isPublished = finalForm.status === "open";
    setCreatedForm(finalForm);
    setFormStatus(finalForm.status);
    setFormAvailability(onboardingFormAvailability(finalForm));
    setFormLink(`${window.location.origin}/submit/${event.slug}/${finalForm.id}`);
    // Put the exact event in the address bar before completion. If the
    // mutation commits but its response is lost, a refresh can authorize
    // and restore this checkpoint instead of starting another event.
    window.history.replaceState(
      window.history.state,
      "",
      `/organizations/${organizationId}/onboarding?event=${event.id}`,
    );
    await requestData(`/api/internal/organizations/${organizationId}/onboarding/event`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: event.id, step: "complete", formId: finalForm.id }),
    });
    toast(isPublished ? "Your call for speakers is live" : "Form created as a draft");
    setPendingFormPublication(false);
    setStep(4);
  }

  async function createFormStep() {
    if (!event || creatingForm) return;
    const closesAt = resolveCfpDeadline(deadlineChoice, customClosesAt, event.startsAt, event.timezone);
    // A brand-new form can be rejected before creating anything. An existing
    // draft must first be reconciled below: a prior publish may have committed
    // even when both its response and the immediate read were lost.
    if (!createdForm && !validateDeadline(closesAt)) {
      setPendingFormPublication(false);
      return;
    }
    let hasCreatedForm = createdForm !== null;
    let deadlineValidationFailed = false;
    setDeadlineError("");
    setCreatingForm(true);
    try {
      // Reserve the stable client ID before the form INSERT. If the POST
      // commits but its response is lost, a refresh retries this exact ID
      // instead of orphaning the committed form and creating another.
      await requestData(`/api/internal/organizations/${organizationId}/onboarding/event`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, step: "form", formId: formCreateId }),
      });
      const finalForm = await createOrPublishOnboardingForm({
        existing: createdForm,
        publishNow,
        create: () => requestData<BuilderFormLite>(`/api/internal/forms?eventId=${event.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: formCreateId, internalName: formName.trim() || "Call for Speakers", kind: "abstract", collectParticipants: true }),
        }),
        reconcile: (form) => requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`),
        validatePublish: () => {
          if (validateDeadline(closesAt)) return;
          deadlineValidationFailed = true;
          throw new Error("CFP deadline needs attention");
        },
        publish: (form) => requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: form.updatedAt, patch: { status: "open", closesAt } }),
        }),
        onReady: async (form) => {
          hasCreatedForm = true;
          setCreatedForm(form);
          await requestData(`/api/internal/organizations/${organizationId}/onboarding/event`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ eventId: event.id, step: "form", formId: form.id }),
          });
        },
      });
      await completeFormStep(finalForm);
    } catch (caught) {
      if (deadlineValidationFailed) {
        setPendingFormPublication(false);
        return;
      }
      toast(hasCreatedForm
        ? `Your form is saved, but setup could not be finished: ${caught instanceof Error ? caught.message : "try again"}`
        : caught instanceof Error ? caught.message : "The form could not be created", { kind: "error" });
    } finally {
      setCreatingForm(false);
    }
  }

  async function reconcileOpenFormBeforeFinish(form: BuilderFormLite) {
    if (!event || creatingForm) return;
    setCreatingForm(true);
    try {
      const current = await requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`);
      setCreatedForm(current);
      setFormStatus(current.status);
      setFormAvailability(onboardingFormAvailability(current));
      if (current.status !== "open") {
        // The cached status was stale. Do not let the ordinary completion path
        // reconcile and silently republish it; require the same explicit
        // confirmation as every other draft/closed form.
        setPendingFormPublication(true);
        return;
      }
      // Replay the durable association before completing setup, matching the
      // existing create/publish recovery path without issuing a form mutation.
      await requestData(`/api/internal/organizations/${organizationId}/onboarding/event`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, step: "form", formId: current.id }),
      });
      await completeFormStep(current);
    } catch (caught) {
      toast(`Your form is saved, but setup could not be finished: ${caught instanceof Error ? caught.message : "try again"}`, { kind: "error" });
    } finally {
      setCreatingForm(false);
    }
  }

  function requestFormStep() {
    if (!event || creatingForm) return;
    if (!publishNow) {
      void createFormStep();
      return;
    }
    if (createdForm?.status === "open") {
      void reconcileOpenFormBeforeFinish(createdForm);
      return;
    }

    // A new form has no ambiguous server state, so refuse an invalid deadline
    // before showing the consequential-action dialog. An existing draft must
    // reconcile inside createFormStep first: an earlier publish may be live even
    // if both its mutation response and the immediate recovery read were lost.
    if (!createdForm) {
      const closesAt = resolveCfpDeadline(deadlineChoice, customClosesAt, event.startsAt, event.timezone);
      if (!validateDeadline(closesAt)) return;
    }
    setPendingFormPublication(true);
  }

  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(formLink);
      toast("Public form link copied");
      return;
    } catch {
      const input = formLinkRef.current;
      input?.focus();
      input?.select();
      let copied = false;
      try {
        copied = Boolean(input && document.execCommand("copy"));
      } catch {
        // Leave the full URL selected for a manual Cmd/Ctrl+C fallback.
      }
      toast(copied ? "Public form link copied" : "Link selected — press Cmd/Ctrl+C to copy", copied ? undefined : { kind: "error" });
    }
  }

  const remainingSuggestions = SUGGESTED_TRACKS.filter((suggestion) => !tracks.some((track) => track.name === suggestion.name));
  const published = formAvailability.open;
  const publicationFormName = (createdForm?.internalName ?? formName).trim() || "Call for Speakers";
  const publicationClosesAt = event
    ? resolveCfpDeadline(deadlineChoice, customClosesAt, event.startsAt, event.timezone)
    : null;
  const publicationOpensLater = Boolean(
    createdForm?.opensAt && Date.parse(createdForm.opensAt) > Date.parse(nowIso),
  );

  return (
    <div className="panel settings-section onboarding-wizard">
      <ol className="cfp-progress onboarding-progress" aria-label="Setup progress">
        {STEPS.map((label, index) => {
          const stepNumber = index + 1;
          const complete = stepNumber < step;
          const active = stepNumber === step;
          return <li
            key={label}
            className={active ? "active" : complete ? "complete" : undefined}
            aria-current={active ? "step" : undefined}
            aria-label={`${label}${complete ? ", completed" : active ? ", current step" : ""}`}
          >
            <span aria-hidden="true">{complete ? <Check size={12} /> : stepNumber}</span>
            <b>{label}</b>
          </li>;
        })}
      </ol>
      <OnboardingStepHeading step={step} headingRef={stepHeadingRef} />
      {step < 4 && <p className="onboarding-progress-note">
        <b>{initialState ? "Progress restored" : "Guided setup"}</b>
        <span>Step {step} of 4 · Completed steps are saved, so you can return anytime.</span>
      </p>}

      {step === 1 && (
        <form className="cfp-step form-stack" aria-busy={!hydrated || saving} noValidate onSubmit={(submitEvent) => { submitEvent.preventDefault(); void saveEventStep(); }}>
          <p className="onboarding-lede">
            {event
              ? "Correct the event details below, then continue setup where you left off."
              : hasExistingEvents
                ? `Set up another event for ${organizationName}.`
                : `Welcome to ${organizationName} — let's set up your first event.`}
          </p>
          <Field label="Event name" required error={fieldErrors.name} errorId="onboarding-event-name-error">
            <input id="onboarding-event-name" name="name" required disabled={!hydrated || saving || eventCreateRecoveryRequired} aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "onboarding-event-name-error" : undefined} value={name} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} placeholder="Community AI Summit" />
          </Field>
          <details ref={slugDetailsRef} className="onboarding-advanced" open={Boolean(event) || eventCreateRecoveryRequired}>
            <summary>{event ? "Public URL" : "Customize public URL"}</summary>
            <Field label="Event slug" required={Boolean(event)} hint={event ? "Used in your public URLs — changing it means existing CFP links will stop working" : "Optional — leave blank to generate it from the event name"} hintId="onboarding-event-slug-help" error={fieldErrors.slug} errorId="onboarding-event-slug-error">
              <input id="onboarding-event-slug" name="slug" required={Boolean(event)} disabled={!hydrated || saving || eventCreateRecoveryRequired} aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "onboarding-event-slug-error" : "onboarding-event-slug-help"} value={slug} onChange={(event) => { setSlug(event.target.value); clearFieldError("slug"); }} placeholder="your-event" />
            </Field>
          </details>
          <div className="form-grid">
            <Field label="Event type" error={fieldErrors.eventType} errorId="onboarding-event-type-error">
              <Select id="onboarding-event-type" name="eventType" disabled={!hydrated || saving || eventCreateRecoveryRequired} aria-invalid={Boolean(fieldErrors.eventType) || undefined} aria-describedby={fieldErrors.eventType ? "onboarding-event-type-error" : undefined} value={eventType} onChange={(event) => { setEventType(event.target.value as EventType); clearFieldError("eventType"); }}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Timezone" required error={fieldErrors.timezone} errorId="onboarding-event-timezone-error">
              <Select id="onboarding-event-timezone" name="timezone" required disabled={!hydrated || saving || eventCreateRecoveryRequired} aria-invalid={Boolean(fieldErrors.timezone) || undefined} aria-describedby={fieldErrors.timezone ? "onboarding-event-timezone-error" : undefined} value={timezone} onChange={(event) => { setTimezone(event.target.value); clearFieldError("timezone"); }}>
                {timeZones.map((zone) => <option key={zone} value={zone}>{timeZoneOptionLabel(zone)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Starts" required error={fieldErrors.startsAt} errorId="onboarding-event-starts-at-error">
              <DateTimePicker id="onboarding-event-starts-at" required disabled={!hydrated || saving || eventCreateRecoveryRequired} invalid={Boolean(fieldErrors.startsAt)} {...(fieldErrors.startsAt ? { ariaDescribedBy: "onboarding-event-starts-at-error" } : {})} value={startsAt} onChange={(value) => { setStartsAt(value); clearFieldError("startsAt"); }} tz={timezone} clearable={false} />
            </Field>
            <Field label="Ends" required error={fieldErrors.endsAt} errorId="onboarding-event-ends-at-error">
              <DateTimePicker id="onboarding-event-ends-at" required disabled={!hydrated || saving || eventCreateRecoveryRequired} invalid={Boolean(fieldErrors.endsAt)} {...(fieldErrors.endsAt ? { ariaDescribedBy: "onboarding-event-ends-at-error" } : {})} value={endsAt} onChange={(value) => { setEndsAt(value); clearFieldError("endsAt"); }} tz={timezone} clearable={false} />
            </Field>
          </div>
          {error && <p ref={summaryRef} tabIndex={-1} className="field-error" role="alert">{error}</p>}
          {eventCreateRecoveryRequired && <p className="portal-note" role="status">Your original details are locked so retrying can safely recover the same event.</p>}
          <footer className="cfp-actions">
            <Button type="submit" disabled={!hydrated || saving}>{saving ? eventCreateRecoveryRequired ? "Retrying…" : "Saving…" : eventCreateRecoveryRequired ? "Retry event creation" : event ? "Save and continue" : "Create event"} <ArrowRight size={16} /></Button>
          </footer>
        </form>
      )}

      {step === 2 && event && (
        <div className="cfp-step onboarding-tracks-step">
          <p className="onboarding-lede">Tracks help organize submissions, but they are optional. Add a suggestion, create your own, or skip this step and add them later.</p>
          {remainingSuggestions.length > 0 && (
            <div className="chip-picker">
              {remainingSuggestions.map((suggestion) => (
                <button key={suggestion.name} type="button" className="chip" disabled={addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)} onClick={() => void addTrack(suggestion.name, suggestion.color)}>
                  <Plus size={12} /> {suggestion.name}
                </button>
              ))}
            </div>
          )}
          {tracks.length > 0 && (
            <ul className="onboarding-track-list">
              {tracks.map((track) => <li key={track.id}>
                <span><i style={{ background: track.color }} />{track.name}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${track.name}`}
                  disabled={addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}
                  onClick={() => setPendingTrackDelete(track)}
                >
                  <Trash2 size={15} />
                </button>
              </li>)}
            </ul>
          )}
          {trackSyncError && (
            <div className="onboarding-track-sync" role="alert">
              <p>We could not confirm whether this track was removed. Retry the removal before continuing.</p>
              <Button size="sm" variant="secondary" disabled={Boolean(removingTrackId)} onClick={() => void removeTrack(trackSyncError)}>
                {removingTrackId ? "Retrying…" : "Retry removal"}
              </Button>
            </div>
          )}
          {trackCreateSyncError && (
            <div className="onboarding-track-sync" role="alert">
              <p>We could not confirm whether {trackCreateSyncError.name} was added. Retry before continuing.</p>
              <Button size="sm" variant="secondary" disabled={addingTrack} onClick={() => void addTrack(trackCreateSyncError.name, trackCreateSyncError.color, trackCreateSyncError.id)}>
                {addingTrack ? "Retrying…" : "Retry adding track"}
              </Button>
            </div>
          )}
          <Field label="Add a custom track" hint="Optional — press Enter or click Add">
            <input
              disabled={addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}
              value={trackName}
              onChange={(event) => setTrackName(event.target.value)}
              placeholder="Custom track name"
              onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter") { keyEvent.preventDefault(); void addTrack(trackName, CUSTOM_TRACK_COLOR); } }}
            />
          </Field>
          <footer className="cfp-actions">
            <Button variant="ghost" onClick={() => setStep(1)} disabled={advancing || addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}><ArrowLeft size={16} /> Edit event details</Button>
            <Button variant="secondary" onClick={() => void addTrack(trackName, CUSTOM_TRACK_COLOR)} disabled={!trackName.trim() || addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}><Plus size={16} /> Add track</Button>
            <Button onClick={() => void continueToForm()} disabled={advancing || addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}>{advancing ? "Saving…" : tracks.length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={16} /></Button>
          </footer>
          <ConfirmDialog
            open={pendingTrackDelete !== null}
            title={`Remove ${pendingTrackDelete?.name ?? "this track"}?`}
            body="Submissions assigned to this track will become unassigned. Routing rules that use it will be disabled until you update them."
            confirmLabel="Remove track"
            onConfirm={async () => {
              const track = pendingTrackDelete;
              if (!track) return;
              await removeTrack(track);
              setPendingTrackDelete(null);
            }}
            onCancel={() => setPendingTrackDelete(null)}
          />
        </div>
      )}

      {step === 3 && event && (
        <div className="cfp-step form-stack">
          <p className="onboarding-lede">This creates a ready-to-use call for speakers form with the standard submission and participant questions — edit anything later in the form builder.</p>
          <Field label="Form name">
            <input value={formName} disabled={createdForm !== null} onChange={(event) => setFormName(event.target.value)} />
          </Field>
          <label className="onboarding-toggle">
            <input type="checkbox" checked={publishNow} onChange={(event) => { setPublishNow(event.target.checked); setDeadlineError(""); }} />
            Publish immediately so the link is shareable right away
          </label>
          {publishNow && createdForm?.status !== "open" && <>
            <Field label="CFP deadline" required error={deadlineChoice === "custom" ? undefined : deadlineError} errorId="onboarding-cfp-deadline-error">
              <Select
                id="onboarding-cfp-deadline"
                required
                value={deadlineChoice}
                aria-invalid={Boolean(deadlineError) && deadlineChoice !== "custom" || undefined}
                aria-describedby={deadlineError && deadlineChoice !== "custom" ? "onboarding-cfp-deadline-error" : "onboarding-cfp-deadline-help"}
                onChange={(changeEvent) => { setDeadlineChoice(changeEvent.target.value as CfpDeadlineChoice); setDeadlineError(""); }}
              >
                {CFP_DEADLINE_PRESETS.map((preset) => {
                  const deadline = cfpDeadlineForWeeksBefore(event.startsAt, event.timezone, preset.weeks);
                  return <option key={preset.choice} value={preset.choice}>{preset.label} · {formatInZone(deadline, event.timezone, "date")}</option>;
                })}
                <option value="custom">Choose a date…</option>
                <option value="none">No deadline</option>
              </Select>
              {(!deadlineError || deadlineChoice === "custom") && <small id="onboarding-cfp-deadline-help">Speakers can create and update submissions until the end of this day.</small>}
            </Field>
            {deadlineChoice === "custom" && <Field label="Closing date" required error={deadlineError} errorId="onboarding-cfp-deadline-error">
              <DateTimePicker
                id="onboarding-cfp-custom-deadline"
                mode="date"
                clearable={false}
                required
                invalid={Boolean(deadlineError)}
                {...(deadlineError ? { ariaDescribedBy: "onboarding-cfp-deadline-error" } : {})}
                value={customClosesAt}
                onChange={(value) => { setCustomClosesAt(value); setDeadlineError(""); }}
                tz={event.timezone}
              />
            </Field>}
          </>}
          <footer className="cfp-actions">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={creatingForm}><ArrowLeft size={16} /> Back to tracks</Button>
            <Button onClick={requestFormStep} disabled={creatingForm}>{creatingForm ? "Saving…" : createdForm?.status === "open" ? "Finish setup" : createdForm && publishNow ? "Retry publishing" : createdForm ? "Continue with draft" : publishNow ? "Create and publish form" : "Create draft"} <ArrowRight size={16} /></Button>
          </footer>
          <ConfirmDialog
            open={pendingFormPublication}
            title={createdForm ? `Publish “${publicationFormName}” now?` : `Create and publish “${publicationFormName}” now?`}
            body={<>
              <p>{publicationOpensLater && createdForm?.opensAt
                ? <>This publishes the form now. The public link will start accepting speaker submissions on <b>{formatInZone(createdForm.opensAt, event.timezone, "long")}</b>.</>
                : "This makes the public link available immediately and starts accepting speaker submissions."}</p>
              <p>{publicationClosesAt
                ? <>Speakers can create and update submissions until <b>{formatInZone(publicationClosesAt, event.timezone, "long")}</b>.</>
                : "The form will stay open until you close it."}</p>
            </>}
            confirmLabel={createdForm ? "Retry publishing" : "Create and publish form"}
            variant="primary"
            onConfirm={createFormStep}
            onCancel={() => setPendingFormPublication(false)}
          />
        </div>
      )}

      {step === 4 && event && (
        <div className="cfp-step onboarding-done">
          <span className="metric-icon accent"><Check size={20} /></span>
          <h2>{event.name} is ready</h2>
          <p>{published
            ? "Your call for speakers is live. Share this link:"
            : formStatus === "open" && formAvailability.reason === "not_open_yet"
              ? "Your call for speakers is scheduled but not accepting submissions yet. Review its opening date in the form builder."
              : formStatus === "open" && formAvailability.reason === "closed_by_date"
                ? "Your call for speakers has reached its closing date. Update its availability in the form builder if you want to reopen it."
                : formStatus === "closed"
              ? "Your call for speakers is currently closed. Reopen it from the form builder when you're ready."
              : "Your call for speakers is saved as a draft. Review and publish it from the form builder when you're ready."}</p>
          {published && formLink && (
            <div className="onboarding-link-row">
              <label className="sr-only" htmlFor="onboarding-public-form-link">Public submission link</label>
              <input id="onboarding-public-form-link" ref={formLinkRef} readOnly value={formLink} onFocus={(event) => event.currentTarget.select()} />
              <Button variant="secondary" onClick={() => void copyLink()}><Copy size={16} /> Copy link</Button>
            </div>
          )}
          {published && <aside className="onboarding-team-prompt">
            <span className="metric-icon"><UserPlus size={16} /></span>
            <span><b>Bring in your team</b><small>Invite organizers or reviewers without leaving setup behind.</small></span>
            <Link href={`/organizations/${organizationId}/team`} className="button button-secondary">Invite teammates</Link>
          </aside>}
          <footer className="cfp-actions">
            {createdForm && <Link href={`/events/${event.id}/forms/${createdForm.id}`} className={`button ${published ? "button-secondary" : "button-primary"}`}>
              {published
                ? "Manage form"
                : formStatus === "open"
                  ? "Edit availability"
                  : formStatus === "closed"
                    ? "Edit and reopen form"
                    : "Edit and publish form"}
            </Link>}
            {published && createdForm && <Link href={`/events/${event.id}/forms/${createdForm.id}/preview`} target="_blank" rel="noreferrer" className="button button-secondary">Preview form <ExternalLink size={16} /></Link>}
            {published && formLink && <a href={formLink} target="_blank" rel="noreferrer" className="button button-secondary">Open live form <ExternalLink size={16} /></a>}
            <Link href={`/events/${event.id}/dashboard`} className={`button ${published ? "button-primary" : "button-secondary"}`}><Sparkles size={16} /> Open dashboard</Link>
          </footer>
        </div>
      )}
    </div>
  );
}
