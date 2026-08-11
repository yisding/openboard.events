"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { eventDtoSchema, LIMITS, plainTextLength, type EventDTO } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { RESERVED_SLUGS } from "@/shared/lib/slug";
import { EVENT_TYPES, type EventType } from "../schemas";
import { BrandingPanel } from "./branding-panel";

const EVENT_SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;

export function eventSlugValidationError(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return "Event slug is required";
  if (candidate.length > 200) return "Event slug must be 200 characters or fewer";
  if (!EVENT_SLUG_PATTERN.test(candidate)) return "Slug must be lowercase letters, numbers and single hyphens";
  if ((RESERVED_SLUGS as readonly string[]).includes(candidate)) return `“${candidate}” is a reserved word and cannot be used as a slug`;
  return null;
}

function browserTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [
      "America/Los_Angeles", "America/New_York", "America/Chicago", "America/Denver",
      "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC",
    ];
  }
}

export function DetailsTab({ event, onSaved }: { event: EventDTO; onSaved: (event: EventDTO) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const timeZones = useMemo(browserTimeZones, []);

  const [name, setName] = useState(event.name);
  const [slug, setSlug] = useState(event.slug);
  const [eventType, setEventType] = useState<EventType>(event.eventType as EventType);
  const [websiteUrl, setWebsiteUrl] = useState(event.websiteUrl ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [physicalAddress, setPhysicalAddress] = useState(event.physicalAddress ?? "");
  const [timezone, setTimezone] = useState(event.timezone);
  const [startsAt, setStartsAt] = useState<string | null>(event.startsAt);
  const [endsAt, setEndsAt] = useState<string | null>(event.endsAt);
  const [theme, setTheme] = useState(event.theme ?? "");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const themeCount = plainTextLength(theme);
  const themeOverLimit = themeCount > LIMITS.THEME;

  async function save() {
    if (!name.trim()) return setError("Event name is required");
    const slugError = eventSlugValidationError(slug);
    if (slugError) return setError(slugError);
    if (!startsAt || !endsAt) return setError("Starts At and Ends At are both required — clearing one is not a valid save");
    if (themeOverLimit) return setError(`Theme must be ${LIMITS.THEME} characters or fewer`);
    setSaving(true);
    setError("");
    setStale(false);
    try {
      const updated = await api(`events/${event.id}`, eventDtoSchema, {
        method: "PATCH",
        body: {
          expectedRowVersion: event.rowVersion,
          patch: {
            name: name.trim(),
            slug: slug.trim(),
            eventType,
            websiteUrl: websiteUrl.trim(),
            location: location.trim(),
            physicalAddress: physicalAddress.trim(),
            timezone,
            startsAt,
            endsAt,
            theme: theme.trim() || null,
          },
        },
      });
      onSaved(updated);
      toast("Event details saved");
    } catch (caught) {
      if (isAppError(caught) && caught.code === "STALE_WRITE") {
        setStale(true);
      } else {
        setError(caught instanceof Error ? caught.message : "That event did not save");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-section">
      <header>
        <h2>Event details</h2>
        <p>Core information shown across admin and public pages.</p>
      </header>
      {stale && (
        <div className="notify-bar">
          <div>
            <p><b>This event changed since you loaded it — refresh to see the latest.</b></p>
          </div>
          <Button variant="secondary" onClick={() => router.refresh()}>Refresh</Button>
        </div>
      )}
      <div className="form-stack">
        <Field label="Event name" required>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Event slug" required hint="Used in your public URLs: /submit/{slug}/… — renaming after a CFP link is shared means existing links 404">
          <input required value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Event type">
            <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
              {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Timezone" required>
            <select required value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Event website URL">
            <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Event location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Starts At" required>
            <DateTimePicker required value={startsAt} onChange={setStartsAt} tz={timezone} clearable={false} />
          </Field>
          <Field label="Ends At" required>
            <DateTimePicker required value={endsAt} onChange={setEndsAt} tz={timezone} clearable={false} />
          </Field>
        </div>
        <Field label="Theme" hint={`${themeCount} / ${LIMITS.THEME}`}>
          <textarea rows={4} value={theme} onChange={(e) => setTheme(e.target.value)} className={themeOverLimit ? "has-error" : ""} />
        </Field>
        <Field label="Physical mailing address" hint="Required by CAN-SPAM on every marketing email; shown in the footer of non-essential speaker emails.">
          <input value={physicalAddress} onChange={(e) => setPhysicalAddress(e.target.value)} placeholder="123 Main St, Suite 100, San Francisco, CA 94105" />
        </Field>
        {error && <p className="field-error">{error}</p>}
        <footer>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </footer>
      </div>
      <BrandingPanel event={event} onSaved={onSaved} />
    </section>
  );
}
