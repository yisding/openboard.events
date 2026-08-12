"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, ExternalLink, Plus, Sparkles } from "lucide-react";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { eventDtoSchema, trackDtoSchema, type EventDTO, type OrganizationId, type TrackDTO } from "@/shared/contracts";
import type { OnboardingStep } from "../progress-types";
import { EVENT_TYPES, type EventType } from "@/features/events/schemas";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

const DEFAULT_TZ = "America/Los_Angeles";
const CUSTOM_TRACK_COLOR = DEFAULT_BRAND_COLOR;
const SUGGESTED_TRACKS: Array<{ name: string; color: string }> = [
  { name: "Main Stage", color: "#00a878" },
  { name: "Workshops", color: "#2a6486" },
  { name: "Lightning Talks", color: "#8a5312" },
];
const STEPS = ["Event details", "Tracks", "First form", "Share"] as const;
const RENDERED_FIELDS = new Set(["name", "slug", "eventType", "timezone", "startsAt", "endsAt"]);
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
type BuilderFormLite = { id: string; status: string; updatedAt: string; internalName?: string };

export type OnboardingResumeState = {
  step: OnboardingStep | "complete";
  event: EventDTO;
  tracks: TrackDTO[];
  formId: string | null;
  form: BuilderFormLite | null;
  publicFormUrl: string | null;
};

export async function createOrPublishOnboardingForm(input: {
  existing: BuilderFormLite | null;
  publishNow: boolean;
  create: () => Promise<BuilderFormLite>;
  reconcile: (form: BuilderFormLite) => Promise<BuilderFormLite>;
  publish: (form: BuilderFormLite) => Promise<BuilderFormLite>;
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
  const response = await fetch(path, init);
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? "That request failed");
  return payload.data;
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
}: {
  organizationId: OrganizationId;
  organizationName: string;
  hasExistingEvents: boolean;
  initialState?: OnboardingResumeState | null;
}) {
  const { toast } = useToast();
  const timeZones = useMemo(browserTimeZones, []);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => initialState?.step === "complete" ? 4 : initialState?.step === "form" ? 3 : initialState ? 2 : 1);

  // Step 1 — event basics
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [eventType, setEventType] = useState<EventType>("conference");
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [event, setEvent] = useState<EventDTO | null>(initialState?.event ?? null);
  const [eventCreateId] = useState(() => crypto.randomUUID());
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const slugDetailsRef = useRef<HTMLDetailsElement>(null);
  const formLinkRef = useRef<HTMLInputElement>(null);
  const previousStepRef = useRef(step);

  useEffect(() => {
    setTimezone(preferredTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone, timeZones));
  }, [timeZones]);

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
  const [advancing, setAdvancing] = useState(false);

  // Step 3 — first form
  const [formName, setFormName] = useState(initialState?.form?.internalName ?? "Call for Speakers");
  const [publishNow, setPublishNow] = useState(true);
  const [creatingForm, setCreatingForm] = useState(false);
  const [formLink, setFormLink] = useState(initialState?.publicFormUrl ?? "");
  const [formStatus, setFormStatus] = useState(initialState?.form?.status ?? "draft");
  const [createdForm, setCreatedForm] = useState<BuilderFormLite | null>(initialState?.form ?? null);
  const [formCreateId] = useState(() => initialState?.formId ?? crypto.randomUUID());

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

  async function createEventStep() {
    if (!name.trim()) return fail("Event name is required", { name: "Event name is required" });
    if (!startsAt || !endsAt) {
      return fail("Both start and end dates are required", {
        ...(startsAt ? {} : { startsAt: "Start date and time are required" }),
        ...(endsAt ? {} : { endsAt: "End date and time are required" }),
      });
    }
    setSaving(true);
    fail("");
    try {
      const created = await api(`organizations/${organizationId}/onboarding/event`, eventDtoSchema, {
        method: "POST",
        body: { id: eventCreateId, name: name.trim(), slug: slug.trim() || undefined, eventType, timezone, startsAt, endsAt },
      });
      setEvent(created);
      toast(`${created.name} created`);
      setStep(2);
    } catch (caught) {
      const fields = isAppError(caught) ? caught.fieldErrors : undefined;
      const summary = caught instanceof Error ? caught.message : "That event did not save";
      fail(summary, fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  async function addTrack(candidateName: string, color: string) {
    if (!event || !candidateName.trim() || addingTrack) return;
    if (tracks.some((track) => track.name.toLowerCase() === candidateName.trim().toLowerCase())) return;
    setAddingTrack(true);
    try {
      const track = await api(`events/${event.id}/vocab/tracks`, trackDtoSchema, {
        method: "POST",
        body: { name: candidateName.trim(), color },
      });
      setTracks((current) => [...current, track]);
      setTrackName("");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That track could not be added", { kind: "error" });
    } finally {
      setAddingTrack(false);
    }
  }

  async function continueToForm() {
    if (!event || advancing) return;
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

  async function createFormStep() {
    if (!event || creatingForm) return;
    let hasCreatedForm = createdForm !== null;
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
        publish: (form) => requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: form.updatedAt, patch: { status: "open" } }),
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
      const isPublished = finalForm.status === "open";
      setCreatedForm(finalForm);
      setFormStatus(finalForm.status);
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
      setStep(4);
    } catch (caught) {
      toast(hasCreatedForm
        ? `Your form is saved, but setup could not be finished: ${caught instanceof Error ? caught.message : "try again"}`
        : caught instanceof Error ? caught.message : "The form could not be created", { kind: "error" });
    } finally {
      setCreatingForm(false);
    }
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
  const published = formStatus === "open";

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

      {step === 1 && (
        <form className="cfp-step form-stack" noValidate onSubmit={(submitEvent) => { submitEvent.preventDefault(); void createEventStep(); }}>
          <p className="onboarding-lede">
            {hasExistingEvents ? `Set up another event for ${organizationName}.` : `Welcome to ${organizationName} — let's set up your first event.`}
          </p>
          <Field label="Event name" required error={fieldErrors.name} errorId="onboarding-event-name-error">
            <input id="onboarding-event-name" name="name" required aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "onboarding-event-name-error" : undefined} value={name} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} placeholder="Community AI Summit" />
          </Field>
          <details ref={slugDetailsRef} className="onboarding-advanced">
            <summary>Customize public URL</summary>
            <Field label="Event slug" hint="Optional — leave blank to generate it from the event name" hintId="onboarding-event-slug-help" error={fieldErrors.slug} errorId="onboarding-event-slug-error">
              <input id="onboarding-event-slug" name="slug" aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "onboarding-event-slug-error" : "onboarding-event-slug-help"} value={slug} onChange={(event) => { setSlug(event.target.value); clearFieldError("slug"); }} placeholder="your-event" />
            </Field>
          </details>
          <div className="form-grid">
            <Field label="Event type" error={fieldErrors.eventType} errorId="onboarding-event-type-error">
              <Select id="onboarding-event-type" name="eventType" aria-invalid={Boolean(fieldErrors.eventType) || undefined} aria-describedby={fieldErrors.eventType ? "onboarding-event-type-error" : undefined} value={eventType} onChange={(event) => { setEventType(event.target.value as EventType); clearFieldError("eventType"); }}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Timezone" required error={fieldErrors.timezone} errorId="onboarding-event-timezone-error">
              <Select id="onboarding-event-timezone" name="timezone" required aria-invalid={Boolean(fieldErrors.timezone) || undefined} aria-describedby={fieldErrors.timezone ? "onboarding-event-timezone-error" : undefined} value={timezone} onChange={(event) => { setTimezone(event.target.value); clearFieldError("timezone"); }}>
                {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </Select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Starts" required error={fieldErrors.startsAt} errorId="onboarding-event-starts-at-error">
              <DateTimePicker id="onboarding-event-starts-at" required invalid={Boolean(fieldErrors.startsAt)} {...(fieldErrors.startsAt ? { ariaDescribedBy: "onboarding-event-starts-at-error" } : {})} value={startsAt} onChange={(value) => { setStartsAt(value); clearFieldError("startsAt"); }} tz={timezone} clearable={false} />
            </Field>
            <Field label="Ends" required error={fieldErrors.endsAt} errorId="onboarding-event-ends-at-error">
              <DateTimePicker id="onboarding-event-ends-at" required invalid={Boolean(fieldErrors.endsAt)} {...(fieldErrors.endsAt ? { ariaDescribedBy: "onboarding-event-ends-at-error" } : {})} value={endsAt} onChange={(value) => { setEndsAt(value); clearFieldError("endsAt"); }} tz={timezone} clearable={false} />
            </Field>
          </div>
          {error && <p ref={summaryRef} tabIndex={-1} className="field-error" role="alert">{error}</p>}
          <footer className="cfp-actions">
            <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create event"} <ArrowRight size={16} /></Button>
          </footer>
        </form>
      )}

      {step === 2 && event && (
        <div className="cfp-step onboarding-tracks-step">
          <p className="onboarding-lede">Tracks help organize submissions, but they are optional. Add a suggestion, create your own, or skip this step and add them later.</p>
          {remainingSuggestions.length > 0 && (
            <div className="chip-picker">
              {remainingSuggestions.map((suggestion) => (
                <button key={suggestion.name} type="button" className="chip" disabled={addingTrack} onClick={() => void addTrack(suggestion.name, suggestion.color)}>
                  <Plus size={12} /> {suggestion.name}
                </button>
              ))}
            </div>
          )}
          {tracks.length > 0 && (
            <ul className="onboarding-track-list">
              {tracks.map((track) => <li key={track.id}><i style={{ background: track.color }} />{track.name}</li>)}
            </ul>
          )}
          <Field label="Add a custom track" hint="Optional — press Enter or click Add">
            <input
              value={trackName}
              onChange={(event) => setTrackName(event.target.value)}
              placeholder="Custom track name"
              onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter") { keyEvent.preventDefault(); void addTrack(trackName, CUSTOM_TRACK_COLOR); } }}
            />
          </Field>
          <footer className="cfp-actions">
            <Button variant="secondary" onClick={() => void addTrack(trackName, CUSTOM_TRACK_COLOR)} disabled={!trackName.trim() || addingTrack}><Plus size={16} /> Add track</Button>
            <Button onClick={() => void continueToForm()} disabled={advancing || addingTrack}>{advancing ? "Saving…" : tracks.length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={16} /></Button>
          </footer>
        </div>
      )}

      {step === 3 && event && (
        <div className="cfp-step form-stack">
          <p className="onboarding-lede">This creates a ready-to-use call for speakers form with the standard submission and participant questions — edit anything later in the form builder.</p>
          <Field label="Form name">
            <input value={formName} disabled={createdForm !== null} onChange={(event) => setFormName(event.target.value)} />
          </Field>
          <label className="onboarding-toggle">
            <input type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} />
            Publish immediately so the link is shareable right away
          </label>
          <footer className="cfp-actions">
            <Button onClick={() => void createFormStep()} disabled={creatingForm}>{creatingForm ? "Saving…" : createdForm?.status === "open" ? "Finish setup" : createdForm && publishNow ? "Retry publishing" : createdForm ? "Continue with draft" : "Create form"} <ArrowRight size={16} /></Button>
          </footer>
        </div>
      )}

      {step === 4 && event && (
        <div className="cfp-step onboarding-done">
          <span className="metric-icon accent"><Check size={20} /></span>
          <h2>{event.name} is ready</h2>
          <p>{published
            ? "Your call for speakers is live. Share this link:"
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
          <footer className="cfp-actions">
            {createdForm && <Link href={`/events/${event.id}/forms/${createdForm.id}`} className={`button ${published ? "button-secondary" : "button-primary"}`}>
              {published ? "Manage form" : formStatus === "closed" ? "Edit and reopen form" : "Edit and publish form"}
            </Link>}
            {published && formLink && <Link href={formLink} target="_blank" rel="noreferrer" className="button button-secondary">Preview form <ExternalLink size={16} /></Link>}
            <Link href={`/events/${event.id}/dashboard`} className={`button ${published ? "button-primary" : "button-secondary"}`}><Sparkles size={16} /> Open dashboard</Link>
          </footer>
        </div>
      )}
    </div>
  );
}
