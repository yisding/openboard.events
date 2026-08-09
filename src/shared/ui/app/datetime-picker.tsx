"use client";

import { X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { endOfDayInTz, eventDayKey, hourMinuteInZone, zoneAbbreviation, zonedInputToUtc } from "@/shared/lib/time";

/**
 * Reads and writes in the **event's** timezone and always shows its label, so an
 * organizer in another zone cannot set a deadline an hour off without noticing.
 *
 * It emits an ISO-8601 UTC instant, never a naive local string. `mode="date"`
 * emits end of day in the event zone — a date-only due date means "before that
 * day is over there", and converting it once here is what stops six callers
 * doing it differently.
 */
export function DateTimePicker({
  value,
  onChange,
  tz,
  mode = "datetime",
  clearable = true,
  id,
  disabled = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  tz: string;
  mode?: "datetime" | "date";
  clearable?: boolean;
  id?: string;
  disabled?: boolean;
}) {
  const dateISO = value ? eventDayKey(value, tz) : "";
  const { hour, minute } = value ? hourMinuteInZone(value, tz) : { hour: 0, minute: 0 };
  const localValue = value
    ? mode === "date"
      ? dateISO
      : `${dateISO}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : "";

  function emit(next: string) {
    if (!next) {
      onChange(null);
      return;
    }
    onChange(mode === "date" ? endOfDayInTz(next, tz).toISOString() : zonedInputToUtc(next, tz).toISOString());
  }

  return (
    <div className={cn("datetime-picker", disabled && "is-disabled")}>
      <input
        id={id}
        type={mode === "date" ? "date" : "datetime-local"}
        value={localValue}
        disabled={disabled}
        onChange={(event) => emit(event.target.value)}
      />
      {/* The zone label is not decoration: without it the field is ambiguous. */}
      <span className="datetime-zone">{zoneAbbreviation(value ?? new Date(), tz)}</span>
      {clearable && value && !disabled && (
        <button type="button" className="icon-button" aria-label="Clear date" onClick={() => onChange(null)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
