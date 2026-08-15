"use client";

import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { Field } from "@/shared/ui/ui-kit";
import type { BuilderEvent, BuilderForm, FormPatch } from "../../builder-types";

const captionStyle = { color: "var(--muted)", fontSize: "var(--text-xs)", margin: "-12px 0 16px" } as const;
const helpStyle = { color: "var(--muted)", fontSize: "var(--text-xs)", lineHeight: 1.5, margin: "12px 0 0" } as const;

/**
 * "Deadlines" — when the form stops accepting new and updated submissions.
 *
 * Both fields go through `<DateTimePicker tz>`, which is what actually
 * implements the date-only → end-of-day rule (`endOfDayInTz`) and the
 * always-visible zone label — the single most likely off-by-hours bug in the
 * product lives in that widget, not here. Clearing a datetime with the picker's
 * `×` emits `null`, which `saveSettingsStep` writes as "no deadline" (legal
 * here, unlike event start/end).
 */
export function CloseDateCard({ event, form, onChange }: {
  event: BuilderEvent;
  form: BuilderForm;
  onChange: (patch: FormPatch) => void;
}) {
  return (
    <div className="builder-card">
      <h3>Deadlines</h3>
      <p style={captionStyle}>When the form stops accepting new and updated submissions.</p>
      <div className="form-grid">
        <Field label="Opens at">
          <DateTimePicker tz={event.timezone} value={form.opensAt} onChange={(opensAt) => onChange({ opensAt })} />
        </Field>
        <Field label="Closes at">
          <DateTimePicker tz={event.timezone} value={form.closesAt} onChange={(closesAt) => onChange({ closesAt })} />
        </Field>
      </div>
      <p style={helpStyle}>If set, the form and its submissions close after this instant. Times are in the event timezone.</p>
    </div>
  );
}
