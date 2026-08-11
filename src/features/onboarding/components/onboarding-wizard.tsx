"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Plus, Sparkles } from "lucide-react";
import { Button, Field } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { eventDtoSchema, trackDtoSchema, type EventDTO, type OrganizationId, type TrackDTO } from "@/shared/contracts";
import { EVENT_TYPES, type EventType } from "@/features/events/schemas";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";

const DEFAULT_TZ = "America/Los_Angeles";
const CUSTOM_TRACK_COLOR = "#00a878";
const SUGGESTED_TRACKS: Array<{ name: string; color: string }> = [
  { name: "Main Stage", color: "#00a878" },
  { name: "Workshops", color: "#2a6486" },
  { name: "Lightning Talks", color: "#8a5312" },
];
const STEPS = ["Event basics", "Vocabulary", "First form", "Done"] as const;
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
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [DEFAULT_TZ, "America/New_York", "America/Chicago", "America/Denver", "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC"];
  }
}

// `BuilderForm` (features/forms/builder-types.ts) has no shared zod contract
// — the existing CFP builder pages (`forms-page.tsx`, `form-builder.tsx`)
// read its create/update responses with this same hand-rolled envelope
// reader rather than a schema, and this wizard follows that precedent
// instead of inventing a client-side validator for a type it does not own.
type BuilderFormLite = { id: string; status: string; updatedAt: string };

export async function createOrPublishOnboardingForm(input: {
  existing: BuilderFormLite | null;
  publishNow: boolean;
  create: () => Promise<BuilderFormLite>;
  reconcile: (form: BuilderFormLite) => Promise<BuilderFormLite>;
  publish: (form: BuilderFormLite) => Promise<BuilderFormLite>;
  onCreated: (form: BuilderFormLite) => void;
}): Promise<BuilderFormLite> {
  let form = input.existing ?? await input.create();
  if (!input.existing) input.onCreated(form);
  // A previous PATCH may have committed even if its response was lost. Always
  // reconcile an existing form before deciding whether to publish or continue
  // as a draft, so neither path trusts a stale status/updatedAt pair.
  else form = await input.reconcile(form);

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
}: {
  organizationId: OrganizationId;
  organizationName: string;
  hasExistingEvents: boolean;
}) {
  const { toast } = useToast();
  const timeZones = useMemo(browserTimeZones, []);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

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
  const [event, setEvent] = useState<EventDTO | null>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    return focusOnNextFrame(stepHeadingRef);
  }, [step]);

  // Step 2 — vocabulary (tracks only — rooms/formats/tags are fine to leave
  // for the settings hub; tracks are the one that gates the form/routing UI).
  const [tracks, setTracks] = useState<TrackDTO[]>([]);
  const [trackName, setTrackName] = useState("");
  const [addingTrack, setAddingTrack] = useState(false);

  // Step 3 — first form
  const [formName, setFormName] = useState("Call for Speakers");
  const [publishNow, setPublishNow] = useState(true);
  const [creatingForm, setCreatingForm] = useState(false);
  const [formLink, setFormLink] = useState("");
  const [published, setPublished] = useState(false);
  const [createdForm, setCreatedForm] = useState<BuilderFormLite | null>(null);

  function fail(summary: string, fields: Record<string, string> = {}) {
    const shownInline = Object.keys(fields).some((key) => RENDERED_FIELDS.has(key));
    setError(shownInline ? "" : summary);
    setFieldErrors(fields);
    if (!summary && Object.keys(fields).length === 0) return;
    const firstInvalid = Object.keys(fields).find((key) => RENDERED_FIELDS.has(key));
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
      return fail("Starts At and Ends At are both required", {
        ...(startsAt ? {} : { startsAt: "Starts At is required" }),
        ...(endsAt ? {} : { endsAt: "Ends At is required" }),
      });
    }
    setSaving(true);
    fail("");
    try {
      const created = await api(`organizations/${organizationId}/onboarding/event`, eventDtoSchema, {
        method: "POST",
        body: { name: name.trim(), slug: slug.trim() || undefined, eventType, timezone, startsAt, endsAt },
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

  async function createFormStep() {
    if (!event || creatingForm) return;
    let hasCreatedForm = createdForm !== null;
    setCreatingForm(true);
    try {
      const finalForm = await createOrPublishOnboardingForm({
        existing: createdForm,
        publishNow,
        create: () => requestData<BuilderFormLite>(`/api/internal/forms?eventId=${event.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ internalName: formName.trim() || "Call for Speakers", kind: "abstract", collectParticipants: true }),
        }),
        reconcile: (form) => requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`),
        publish: (form) => requestData<BuilderFormLite>(`/api/internal/forms/${form.id}?eventId=${event.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: form.updatedAt, patch: { status: "open" } }),
        }),
        onCreated: (form) => {
          hasCreatedForm = true;
          setCreatedForm(form);
        },
      });
      const isPublished = finalForm.status === "open";
      setCreatedForm(finalForm);
      setPublished(isPublished);
      setFormLink(`${window.location.origin}/submit/${event.slug}/${finalForm.id}`);
      toast(isPublished ? "Your call for speakers is live" : "Form created as a draft");
      setStep(4);
    } catch (caught) {
      toast(hasCreatedForm
        ? `The form is saved, but publication could not be confirmed: ${caught instanceof Error ? caught.message : "try again"}`
        : caught instanceof Error ? caught.message : "The form could not be created", { kind: "error" });
    } finally {
      setCreatingForm(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(formLink);
    toast("Public form link copied");
  }

  const remainingSuggestions = SUGGESTED_TRACKS.filter((suggestion) => !tracks.some((track) => track.name === suggestion.name));

  return (
    <div className="panel settings-section onboarding-wizard">
      <ol className="cfp-progress">
        {STEPS.map((label, index) => <li key={label} className={step === index + 1 ? "active" : undefined} aria-current={step === index + 1 ? "step" : undefined}>{index + 1}. {label}</li>)}
      </ol>
      <OnboardingStepHeading step={step} headingRef={stepHeadingRef} />

      {step === 1 && (
        <form className="cfp-step form-stack" noValidate onSubmit={(submitEvent) => { submitEvent.preventDefault(); void createEventStep(); }}>
          <p className="onboarding-lede">
            {hasExistingEvents ? `Set up another event for ${organizationName}.` : `Welcome to ${organizationName} — let's set up your first event.`}
          </p>
          <Field label="Event name" required error={fieldErrors.name} errorId="onboarding-event-name-error">
            <input id="onboarding-event-name" name="name" required aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "onboarding-event-name-error" : undefined} value={name} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} placeholder="AI.Engineer Sandbox — NYC" />
          </Field>
          <Field label="Event slug" hint="Used in your public URLs — leave blank to generate from the name" hintId="onboarding-event-slug-help" error={fieldErrors.slug} errorId="onboarding-event-slug-error">
            <input id="onboarding-event-slug" name="slug" aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "onboarding-event-slug-error" : "onboarding-event-slug-help"} value={slug} onChange={(event) => { setSlug(event.target.value); clearFieldError("slug"); }} placeholder="ai-engineer-sandbox" />
          </Field>
          <div className="form-grid">
            <Field label="Event type" error={fieldErrors.eventType} errorId="onboarding-event-type-error">
              <select id="onboarding-event-type" name="eventType" aria-invalid={Boolean(fieldErrors.eventType) || undefined} aria-describedby={fieldErrors.eventType ? "onboarding-event-type-error" : undefined} value={eventType} onChange={(event) => { setEventType(event.target.value as EventType); clearFieldError("eventType"); }}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Timezone" required error={fieldErrors.timezone} errorId="onboarding-event-timezone-error">
              <select id="onboarding-event-timezone" name="timezone" required aria-invalid={Boolean(fieldErrors.timezone) || undefined} aria-describedby={fieldErrors.timezone ? "onboarding-event-timezone-error" : undefined} value={timezone} onChange={(event) => { setTimezone(event.target.value); clearFieldError("timezone"); }}>
                {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Starts At" required error={fieldErrors.startsAt} errorId="onboarding-event-starts-at-error">
              <DateTimePicker id="onboarding-event-starts-at" required invalid={Boolean(fieldErrors.startsAt)} {...(fieldErrors.startsAt ? { ariaDescribedBy: "onboarding-event-starts-at-error" } : {})} value={startsAt} onChange={(value) => { setStartsAt(value); clearFieldError("startsAt"); }} tz={timezone} clearable={false} />
            </Field>
            <Field label="Ends At" required error={fieldErrors.endsAt} errorId="onboarding-event-ends-at-error">
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
        <div className="cfp-step">
          <p className="onboarding-lede">Add a few tracks — the CFP form and routing rules use these to sort submissions. You can add more later from Settings.</p>
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
            <Button onClick={() => setStep(3)}>Continue <ArrowRight size={16} /></Button>
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
            <Button onClick={() => void createFormStep()} disabled={creatingForm}>{creatingForm ? "Saving…" : createdForm && publishNow ? "Retry publishing" : createdForm ? "Continue with draft" : "Create form"} <ArrowRight size={16} /></Button>
          </footer>
        </div>
      )}

      {step === 4 && event && (
        <div className="cfp-step onboarding-done">
          <span className="metric-icon accent"><Check size={20} /></span>
          <h2>{event.name} is ready</h2>
          <p>{published ? "Your call for speakers is live. Share this link:" : "Your call for speakers is saved as a draft. Publish it from the form builder when you're ready."}</p>
          {published && formLink && (
            <div className="onboarding-link-row">
              <input readOnly value={formLink} onFocus={(event) => event.currentTarget.select()} />
              <Button variant="secondary" onClick={() => void copyLink()}><Copy size={16} /> Copy link</Button>
            </div>
          )}
          <footer className="cfp-actions">
            <Link href={`/events/${event.id}/settings?tab=details`} className="button button-secondary">Event settings</Link>
            <Link href={`/events/${event.id}/dashboard`} className="button button-primary"><Sparkles size={16} /> Go to your event</Link>
          </footer>
        </div>
      )}
    </div>
  );
}
