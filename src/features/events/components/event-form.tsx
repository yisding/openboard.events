"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { eventDtoSchema } from "@/shared/contracts";
import { EVENT_TYPES, type EventType } from "../schemas";

const DEFAULT_TZ = "America/Los_Angeles";

/**
 * The request fields this form has a `Field` for — every key that can carry a
 * server message to somewhere the organizer will actually see it. Keep in step
 * with the `error={fieldErrors.…}` props below; a key missing from here only
 * costs a redundant summary, never a swallowed message.
 */
const RENDERED_FIELDS = new Set(["name", "slug", "eventType", "timezone", "websiteUrl", "location", "startsAt", "endsAt"]);

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
        body: {
          name: name.trim(),
          slug: slug.trim() || undefined,
          eventType,
          websiteUrl: websiteUrl.trim(),
          location: location.trim(),
          timezone,
          startsAt,
          endsAt,
        },
      });
      toast(`${created.name} created`);
      router.push(`/events/${created.id}/settings?tab=details`);
    } catch (caught) {
      const fields = isAppError(caught) ? caught.fieldErrors : undefined;
      const summary = caught instanceof Error ? caught.message : "That event did not save";
      fail(summary, fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-stack">
      <Field label="Event name" required error={fieldErrors.name}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI.Engineer Sandbox — NYC" />
      </Field>
      <Field label="Event slug" hint="Used in your public URLs: /submit/{slug}/… — leave blank to generate from the name" error={fieldErrors.slug}>
        <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="ai-engineer-sandbox" />
      </Field>
      <div className="form-grid">
        <Field label="Event type" error={fieldErrors.eventType}>
          <select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}>
            {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Timezone" required error={fieldErrors.timezone}>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Event website URL" error={fieldErrors.websiteUrl}>
          <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Event location" error={fieldErrors.location}>
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="New York, NY" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Starts At" required error={fieldErrors.startsAt}>
          <DateTimePicker value={startsAt} onChange={setStartsAt} tz={timezone} clearable={false} />
        </Field>
        <Field label="Ends At" required error={fieldErrors.endsAt}>
          <DateTimePicker value={endsAt} onChange={setEndsAt} tz={timezone} clearable={false} />
        </Field>
      </div>
      {error && <p className="field-error">{error}</p>}
      <footer>
        <Button onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create event"}</Button>
      </footer>
    </div>
  );
}
