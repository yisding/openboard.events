"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { eventDtoSchema } from "@/shared/contracts";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { timeZoneOptionLabel } from "@/shared/lib/time";
import { EVENT_TYPES, type EventType } from "../schemas";

const DEFAULT_TZ = "America/Los_Angeles";

/**
 * The request fields this form has a `Field` for — every key that can carry a
 * server message to somewhere the organizer will actually see it. Keep in step
 * with the `error={fieldErrors.…}` props below; a key missing from here only
 * costs a redundant summary, never a swallowed message.
 */
const RENDERED_FIELDS = new Set(["name", "slug", "eventType", "timezone", "websiteUrl", "location", "startsAt", "endsAt"]);
const FIELD_IDS: Record<string, string> = {
  name: "event-name",
  slug: "event-slug",
  eventType: "event-type",
  timezone: "event-timezone",
  websiteUrl: "event-website-url",
  location: "event-location",
  startsAt: "event-starts-at",
  endsAt: "event-ends-at",
};

function browserTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [DEFAULT_TZ, "America/New_York", "America/Chicago", "America/Denver", "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC"];
  }
}

/**
 * The `/events/new` form. Plain `useState` + a submit-time server round trip
 * rather than react-hook-form — this codebase has no form library dependency
 * installed and every other admin form (the evaluation round editor, the
 * public CFP wizard) follows the same hand-rolled pattern, so this stays
 * consistent rather than introducing the only `react-hook-form` import in
 * the tree.
 */
export function EventForm() {
  const router = useRouter();
  const { toast } = useToast();
  const timeZones = useMemo(browserTimeZones, []);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [eventType, setEventType] = useState<EventType>("conference");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Server field messages, keyed by the request field they belong to. The API
  // envelope carries these next to the summary message; showing only the
  // summary is what turned a rejected slug or date range into a bare "Request
  // validation failed".
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const createRequestId = useRef(createStableCreateRequestId());

  /**
   * A failure is reported in exactly one place.
   *
   * `Field` renders its message as `<small className="field-error">` and the
   * summary is a `<p className="field-error">`, so setting both puts two
   * `.field-error` nodes on the page for one rejection: duplicated wording for
   * the organizer, and a strict-mode violation for `e2e/admin-setup.spec.ts`,
   * which addresses the message by that class. So when a message is going to
   * appear beside an input, the summary stays empty.
   *
   * The summary is not dropped on the strength of the map being non-empty,
   * though: a key this form has no `Field` for would then be shown nowhere at
   * all, which is worse than saying it twice. It is dropped only once something
   * is known to be visible.
   */
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

  async function submit() {
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
      const created = await api("events", eventDtoSchema, {
        method: "POST",
        body: createRequestId.current.payload(undefined, {
          name: name.trim(),
          slug: slug.trim() || undefined,
          eventType,
          websiteUrl: websiteUrl.trim(),
          location: location.trim(),
          timezone,
          startsAt,
          endsAt,
        }),
      });
      createRequestId.current.reset();
      setRecoveryRequired(false);
      toast(`${created.name} created`);
      router.push(`/events/${created.id}/settings?tab=details`);
    } catch (caught) {
      setRecoveryRequired(!isDefinitiveWriteFailure(caught));
      const fields = isAppError(caught) ? caught.fieldErrors : undefined;
      const summary = caught instanceof Error ? caught.message : "That event did not save";
      fail(summary, fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-stack" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Field label="Event name" required error={fieldErrors.name} errorId="event-name-error">
        <input id="event-name" name="name" required disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "event-name-error" : undefined} value={name} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} placeholder="AI.Engineer Sandbox — NYC" />
      </Field>
      <Field label="Event slug" hint="Used in your public URLs: /submit/{slug}/… — leave blank to generate from the name" hintId="event-slug-help" error={fieldErrors.slug} errorId="event-slug-error">
        <input id="event-slug" name="slug" disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "event-slug-error" : "event-slug-help"} value={slug} onChange={(event) => { setSlug(event.target.value); clearFieldError("slug"); }} placeholder="ai-engineer-sandbox" />
      </Field>
      <div className="form-grid">
        <Field label="Event type" error={fieldErrors.eventType} errorId="event-type-error">
          <Select id="event-type" name="eventType" disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.eventType) || undefined} aria-describedby={fieldErrors.eventType ? "event-type-error" : undefined} value={eventType} onChange={(event) => { setEventType(event.target.value as EventType); clearFieldError("eventType"); }}>
            {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Timezone" required error={fieldErrors.timezone} errorId="event-timezone-error">
          <Select id="event-timezone" name="timezone" required disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.timezone) || undefined} aria-describedby={fieldErrors.timezone ? "event-timezone-error" : undefined} value={timezone} onChange={(event) => { setTimezone(event.target.value); clearFieldError("timezone"); }}>
            {timeZones.map((zone) => <option key={zone} value={zone}>{timeZoneOptionLabel(zone)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Event website URL" error={fieldErrors.websiteUrl} errorId="event-website-url-error">
          <input id="event-website-url" name="websiteUrl" type="url" disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.websiteUrl) || undefined} aria-describedby={fieldErrors.websiteUrl ? "event-website-url-error" : undefined} value={websiteUrl} onChange={(event) => { setWebsiteUrl(event.target.value); clearFieldError("websiteUrl"); }} placeholder="https://…" />
        </Field>
        <Field label="Event location" error={fieldErrors.location} errorId="event-location-error">
          <input id="event-location" name="location" disabled={saving || recoveryRequired} aria-invalid={Boolean(fieldErrors.location) || undefined} aria-describedby={fieldErrors.location ? "event-location-error" : undefined} value={location} onChange={(event) => { setLocation(event.target.value); clearFieldError("location"); }} placeholder="New York, NY" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Starts At" required error={fieldErrors.startsAt} errorId="event-starts-at-error">
          <DateTimePicker id="event-starts-at" required disabled={saving || recoveryRequired} invalid={Boolean(fieldErrors.startsAt)} {...(fieldErrors.startsAt ? { ariaDescribedBy: "event-starts-at-error" } : {})} value={startsAt} onChange={(value) => { setStartsAt(value); clearFieldError("startsAt"); }} tz={timezone} clearable={false} />
        </Field>
        <Field label="Ends At" required error={fieldErrors.endsAt} errorId="event-ends-at-error">
          <DateTimePicker id="event-ends-at" required disabled={saving || recoveryRequired} invalid={Boolean(fieldErrors.endsAt)} {...(fieldErrors.endsAt ? { ariaDescribedBy: "event-ends-at-error" } : {})} value={endsAt} onChange={(value) => { setEndsAt(value); clearFieldError("endsAt"); }} tz={timezone} clearable={false} />
        </Field>
      </div>
      {error && <p ref={summaryRef} tabIndex={-1} className="field-error" role="alert">{error}</p>}
      {recoveryRequired && <p className="portal-note" role="status">Creation could not be confirmed. Retry with the same details before making changes.</p>}
      <footer>
        <Button type="submit" disabled={saving}>{saving ? "Creating…" : recoveryRequired ? "Retry event creation" : "Create event"}</Button>
      </footer>
    </form>
  );
}
