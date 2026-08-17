"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { TimeZoneSelect } from "@/shared/ui/app/time-zone-select";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { eventDtoSchema, LIMITS, plainTextLength, type EventDTO } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { RESERVED_SLUGS } from "@/shared/lib/slug";
import { EVENT_TYPES, type EventType } from "../schemas";
import { BrandingPanel } from "./branding-panel";

const EVENT_SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;

type DetailsField = "name" | "slug" | "startsAt" | "endsAt" | "theme";
export type EventDetailsValidationErrors = Partial<Record<DetailsField, string>>;

export type EventDetailsDraft = {
  name: string;
  slug: string;
  eventType: EventType;
  websiteUrl: string;
  location: string;
  physicalAddress: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  theme: string;
};

export function eventDetailsDraftFrom(event: EventDTO): EventDetailsDraft {
  return {
    name: event.name,
    slug: event.slug,
    eventType: event.eventType as EventType,
    websiteUrl: event.websiteUrl ?? "",
    location: event.location ?? "",
    physicalAddress: event.physicalAddress ?? "",
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    theme: event.theme ?? "",
  };
}

export function isEventDetailsDraftDirty(draft: EventDetailsDraft, baseline: EventDetailsDraft): boolean {
  return (Object.keys(baseline) as Array<keyof EventDetailsDraft>)
    .some((field) => draft[field] !== baseline[field]);
}

export function incomingEventDetailsAction({
  draft,
  baseline,
  incoming,
}: {
  draft: EventDetailsDraft;
  baseline: EventDetailsDraft;
  incoming: EventDetailsDraft;
}): "advance-version" | "replace-pristine" | "defer-dirty" {
  if (!isEventDetailsDraftDirty(incoming, baseline)) return "advance-version";
  return isEventDetailsDraftDirty(draft, baseline) ? "defer-dirty" : "replace-pristine";
}

export function eventSlugValidationError(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return "Event slug is required";
  if (candidate.length > 200) return "Event slug must be 200 characters or fewer";
  if (!EVENT_SLUG_PATTERN.test(candidate)) return "Slug must be lowercase letters, numbers and single hyphens";
  if ((RESERVED_SLUGS as readonly string[]).includes(candidate)) return `“${candidate}” is a reserved word and cannot be used as a slug`;
  return null;
}

export function eventDetailsValidationErrors({
  name,
  slug,
  startsAt,
  endsAt,
  theme,
}: {
  name: string;
  slug: string;
  startsAt: string | null;
  endsAt: string | null;
  theme: string;
}): EventDetailsValidationErrors {
  const errors: EventDetailsValidationErrors = {};
  if (!name.trim()) errors.name = "Event name is required";
  const slugError = eventSlugValidationError(slug);
  if (slugError) errors.slug = slugError;
  if (!startsAt) errors.startsAt = "Start date and time are required";
  if (!endsAt) errors.endsAt = "End date and time are required";
  if (plainTextLength(theme) > LIMITS.THEME) errors.theme = `Theme must be ${LIMITS.THEME} characters or fewer`;
  return errors;
}

export function focusDetailsError(
  container: { querySelector: (selector: string) => { focus: () => void } | null } | null,
  summary: { current: { focus: () => void } | null },
  schedule: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
) {
  schedule(() => (container?.querySelector('[aria-invalid="true"]') ?? summary.current)?.focus());
}

export const STALE_NOTICE_A11Y = { role: "alert", tabIndex: -1 } as const;

export function focusDetailsNotice(
  notice: { current: { focus: () => void } | null },
  schedule: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
) {
  schedule(() => notice.current?.focus());
}

export function DetailsTab({ event, onSaved }: { event: EventDTO; onSaved: (event: EventDTO) => void }) {
  const { toast } = useToast();
  const sectionRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const staleRef = useRef<HTMLDivElement>(null);

  const [sourceEvent, setSourceEvent] = useState(event);
  const [draft, setDraft] = useState<EventDetailsDraft>(() => eventDetailsDraftFrom(event));
  const [fieldErrors, setFieldErrors] = useState<EventDetailsValidationErrors>({});
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [confirmingLoadLatest, setConfirmingLoadLatest] = useState(false);

  const baseline = useMemo(() => eventDetailsDraftFrom(sourceEvent), [sourceEvent]);
  const dirty = isEventDetailsDraftDirty(draft, baseline);
  useUnsavedWorkGuard(dirty);

  // A branding upload also bumps the event version. If its details still match
  // our baseline, advance only the CAS version and leave an in-progress details
  // draft untouched. A genuinely newer details payload is adopted immediately
  // only while the organizer has nothing to lose.
  useEffect(() => {
    if (event.rowVersion <= sourceEvent.rowVersion) return;
    const incoming = eventDetailsDraftFrom(event);
    const action = incomingEventDetailsAction({ draft, baseline, incoming });
    if (action === "advance-version") {
      setSourceEvent(event);
      setStale(false);
      return;
    }
    if (action === "replace-pristine") {
      setDraft(incoming);
      setSourceEvent(event);
      setStale(false);
      return;
    }
    setStale(true);
  }, [baseline, draft, event, sourceEvent.rowVersion]);

  const themeCount = plainTextLength(draft.theme);
  const themeOverLimit = themeCount > LIMITS.THEME;

  function replaceWith(next: EventDTO) {
    setDraft(eventDetailsDraftFrom(next));
    setSourceEvent(next);
    setFieldErrors({});
    setError("");
    setStale(false);
    setConfirmingLoadLatest(false);
  }

  async function loadLatest() {
    setLoadingLatest(true);
    setError("");
    try {
      const latest = await api(`events/${event.id}`, eventDtoSchema);
      replaceWith(latest);
      onSaved(latest);
      toast("Latest event details loaded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the latest event details");
      focusDetailsError(null, errorRef);
    } finally {
      setLoadingLatest(false);
    }
  }

  function requestLoadLatest() {
    if (dirty) setConfirmingLoadLatest(true);
    else void loadLatest();
  }

  function clearFieldError(field: DetailsField) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function save() {
    const validationErrors = eventDetailsValidationErrors(draft);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setError("");
      focusDetailsError(sectionRef.current, errorRef);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    setError("");
    setStale(false);
    try {
      const updated = await api(`events/${event.id}`, eventDtoSchema, {
        method: "PATCH",
        body: {
          expectedRowVersion: sourceEvent.rowVersion,
          patch: {
            name: draft.name.trim(),
            slug: draft.slug.trim(),
            eventType: draft.eventType,
            websiteUrl: draft.websiteUrl.trim(),
            location: draft.location.trim(),
            physicalAddress: draft.physicalAddress.trim(),
            timezone: draft.timezone,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            theme: draft.theme.trim() || null,
          },
        },
      });
      replaceWith(updated);
      onSaved(updated);
      toast("Event details saved");
    } catch (caught) {
      if (isAppError(caught) && caught.code === "STALE_WRITE") {
        setStale(true);
        focusDetailsNotice(staleRef);
      } else {
        setError(caught instanceof Error ? caught.message : "That event did not save");
        focusDetailsError(null, errorRef);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section ref={sectionRef} className="panel settings-section">
      <header>
        <h2>Event details</h2>
        <p>Core information shown across admin and public pages.</p>
      </header>
      {stale && (
        <div ref={staleRef} className="notify-bar" {...STALE_NOTICE_A11Y}>
          <div>
            <p><b>This event changed since you loaded it.</b></p>
            <small>Your draft is still here. Load the latest version when you are ready to replace it.</small>
          </div>
          <Button variant="secondary" disabled={loadingLatest || saving} onClick={requestLoadLatest}>
            {loadingLatest ? "Loading…" : "Load latest"}
          </Button>
        </div>
      )}
      <div className="form-stack">
        <Field label="Event name" required error={fieldErrors.name} errorId="event-name-error">
          <input required aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "event-name-error" : undefined} value={draft.name} onChange={(e) => { setDraft((current) => ({ ...current, name: e.target.value })); clearFieldError("name"); }} />
        </Field>
        <Field label="Event slug" required hint="Used in your public URLs: /submit/{slug}/… — renaming after a CFP link is shared means existing links 404" error={fieldErrors.slug} errorId="event-slug-error">
          <input required aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "event-slug-error" : undefined} value={draft.slug} onChange={(e) => { setDraft((current) => ({ ...current, slug: e.target.value })); clearFieldError("slug"); }} />
        </Field>
        <div className="form-grid">
          <Field label="Event type">
            <Select value={draft.eventType} onChange={(e) => setDraft((current) => ({ ...current, eventType: e.target.value as EventType }))}>
              {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Timezone" required>
            <TimeZoneSelect required value={draft.timezone} onChange={(e) => setDraft((current) => ({ ...current, timezone: e.target.value }))} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Event website URL">
            <input value={draft.websiteUrl} onChange={(e) => setDraft((current) => ({ ...current, websiteUrl: e.target.value }))} placeholder="https://…" />
          </Field>
          <Field label="Event location">
            <input value={draft.location} onChange={(e) => setDraft((current) => ({ ...current, location: e.target.value }))} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Starts" required error={fieldErrors.startsAt} errorId="event-start-error">
            <DateTimePicker required value={draft.startsAt} onChange={(value) => { setDraft((current) => ({ ...current, startsAt: value })); clearFieldError("startsAt"); }} tz={draft.timezone} clearable={false} invalid={Boolean(fieldErrors.startsAt)} {...(fieldErrors.startsAt ? { ariaDescribedBy: "event-start-error" } : {})} />
          </Field>
          <Field label="Ends" required error={fieldErrors.endsAt} errorId="event-end-error">
            <DateTimePicker required value={draft.endsAt} onChange={(value) => { setDraft((current) => ({ ...current, endsAt: value })); clearFieldError("endsAt"); }} tz={draft.timezone} clearable={false} invalid={Boolean(fieldErrors.endsAt)} {...(fieldErrors.endsAt ? { ariaDescribedBy: "event-end-error" } : {})} />
          </Field>
        </div>
        <Field label="Theme" hint={`${themeCount} / ${LIMITS.THEME}`} error={fieldErrors.theme} errorId="event-theme-error">
          <textarea rows={4} aria-invalid={Boolean(fieldErrors.theme) || undefined} aria-describedby={fieldErrors.theme ? "event-theme-error" : undefined} value={draft.theme} onChange={(e) => { setDraft((current) => ({ ...current, theme: e.target.value })); clearFieldError("theme"); }} className={themeOverLimit ? "has-error" : ""} />
        </Field>
        <Field label="Physical mailing address" hint="Required by CAN-SPAM on every marketing email; shown in the footer of non-essential speaker emails.">
          <input value={draft.physicalAddress} onChange={(e) => setDraft((current) => ({ ...current, physicalAddress: e.target.value }))} placeholder="123 Main St, Suite 100, San Francisco, CA 94105" />
        </Field>
        {error && <p ref={errorRef} className="field-error" role="alert" tabIndex={-1}>{error}</p>}
        <footer>
          <Button onClick={save} disabled={saving || loadingLatest}>{saving ? "Saving…" : "Save changes"}</Button>
        </footer>
      </div>
      <BrandingPanel event={event} onSaved={onSaved} />
      <ConfirmDialog
        open={confirmingLoadLatest}
        title="Load the latest event details?"
        body="Your unsaved details will be replaced by the latest saved version. This cannot be undone."
        confirmLabel="Load latest"
        variant="stale"
        onConfirm={loadLatest}
        onCancel={() => setConfirmingLoadLatest(false)}
      />
    </section>
  );
}
