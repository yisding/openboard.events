"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/shared/ui/ui-kit";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { eventDtoSchema } from "@/shared/contracts";
import { EVENT_TYPES, type EventType } from "../schemas";

const DEFAULT_TZ = "America/Los_Angeles";

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
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return setError("Event name is required");
    if (!startsAt || !endsAt) return setError("Starts At and Ends At are both required");
    setSaving(true);
    setError("");
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
      setError(caught instanceof Error ? caught.message : "That event did not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-stack">
      <Field label="Event name" required>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI.Engineer Sandbox — NYC" />
      </Field>
      <Field label="Event slug" hint="Used in your public URLs: /submit/{slug}/… — leave blank to generate from the name">
        <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="ai-engineer-sandbox" />
      </Field>
      <div className="form-grid">
        <Field label="Event type">
          <select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}>
            {EVENT_TYPES.map((type) => <option key={type} value={type}>{type[0]?.toUpperCase()}{type.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Timezone" required>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Event website URL">
          <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Event location">
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="New York, NY" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Starts At" required>
          <DateTimePicker value={startsAt} onChange={setStartsAt} tz={timezone} clearable={false} />
        </Field>
        <Field label="Ends At" required>
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
