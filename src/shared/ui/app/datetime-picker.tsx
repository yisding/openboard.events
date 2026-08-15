"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { endOfDayInTz, eventDayKey, formatDayKeyInZone, formatInZone, hourMinuteInZone, wallTimeExistsInZone, zoneAbbreviation, zonedInputToUtc } from "@/shared/lib/time";
import { Button, Select } from "@/shared/ui/ui-kit";

type PickerMode = "datetime" | "date";
type CalendarCell = { dayKey: string; day: number; inMonth: boolean };
type DraftValue = { dayKey: string; hour: number; minute: number };
type PopoverPosition = { top: number; left: number; width: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A timezone-free calendar day follows the participant's own local clock. */
export function localCalendarDay(date: Pick<Date, "getFullYear" | "getMonth" | "getDate">): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayKeyParts(value: string): { year: number; month: number; day: number } {
  const match = DAY_KEY.exec(value);
  if (!match) throw new TypeError(`Invalid calendar day: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

/** Six stable weeks keep the popover from jumping as organizers page months. */
export function calendarCells(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    return { dayKey: dayKey(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
  });
}

export function localDateTimeExists(value: DraftValue, tz: string): boolean {
  // `wallTimeExistsInZone` is the same round-trip, shared with the agenda day
  // grid so the two paths cannot drift on which wall times they accept.
  return wallTimeExistsInZone(
    `${value.dayKey}T${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`,
    tz,
  );
}

export function draftZoneAbbreviation(value: DraftValue, tz: string): string {
  const local = `${value.dayKey}T${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  return zoneAbbreviation(zonedInputToUtc(local, tz), tz);
}

export function appliedDateTimeValue(
  currentValue: string | null,
  next: DraftValue,
  tz: string,
  mode: PickerMode,
): string {
  if (currentValue) {
    const currentTime = hourMinuteInZone(currentValue, tz);
    if (
      eventDayKey(currentValue, tz) === next.dayKey
      && currentTime.hour === next.hour
      && currentTime.minute === next.minute
    ) {
      // A wall clock repeats during the autumn DST fold. Both occurrences have
      // the same day/hour/minute, so rebuilding that wall time would silently
      // choose one offset and shift the other instant. An untouched draft is
      // exactly the original value, including its offset occurrence.
      return currentValue;
    }
  }
  if (mode === "date") return endOfDayInTz(next.dayKey, tz).toISOString();
  return zonedInputToUtc(`${next.dayKey}T${String(next.hour).padStart(2, "0")}:${String(next.minute).padStart(2, "0")}`, tz).toISOString();
}

export function pagedCalendarDay(fromDay: string, year: number, month: number, amount: number): string {
  const from = dayKeyParts(fromDay);
  const target = new Date(Date.UTC(year, month + amount, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return dayKey(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(from.day, lastDay))));
}

function monthLabel(year: number, month: number): string {
  // The grid is a calendar, not an instant: it is built in UTC throughout so
  // the same day never lands in two months for two viewers.
  return formatInZone(new Date(Date.UTC(year, month, 1)), "UTC", { month: "long", year: "numeric" });
}

/**
 * The one formatter that must *not* go through `formatInZone`: it appends a
 * zone abbreviation to any component format that renders a time, and this
 * control already shows the zone in its own `.datetime-zone` badge beside the
 * input. The zone is explicit and never the viewer's, so the `viewer-time`
 * invariant's concern does not apply — it allows this file's construction by
 * name.
 */
function displayInstant(value: string, tz: string, mode: PickerMode): string {
  return new Intl.DateTimeFormat("en-US", mode === "date"
    ? { timeZone: tz, month: "short", day: "numeric", year: "numeric" }
    : { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(value));
}

function positionPopover(anchor: DOMRect, popover: DOMRect): PopoverPosition {
  const gutter = 12;
  const gap = 8;
  const width = Math.min(328, window.innerWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - width - gutter));
  const below = window.innerHeight - anchor.bottom - gap;
  const above = anchor.top - gap;
  const top = below >= popover.height || below >= above
    ? Math.min(anchor.bottom + gap, window.innerHeight - popover.height - gutter)
    : Math.max(gutter, anchor.top - popover.height - gap);
  return { top: Math.max(gutter, top), left, width };
}

/** Keep a picker opened from a native modal in that dialog's top layer. */
export function datetimePopoverContainer(root: HTMLElement | null, body: HTMLElement): HTMLElement {
  return root?.closest<HTMLDialogElement>("dialog[open]") ?? body;
}

/** Return the control that should receive focus when Tab reaches a dialog edge. */
export function wrappedPopoverTabTarget<T>(
  focusable: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  if (focusable.length === 0) return null;
  if (shiftKey && active === focusable[0]) return focusable.at(-1) ?? null;
  if (!shiftKey && active === focusable.at(-1)) return focusable[0] ?? null;
  return null;
}

function ThemedDateControl({
  selectedDay,
  selectedHour,
  selectedMinute,
  onApply,
  onClear,
  tz,
  mode,
  todaySource,
  displayValue,
  zoneLabel,
  clearable,
  id,
  disabled,
  required,
  invalid,
  ariaDescribedBy,
}: {
  selectedDay: string | null;
  selectedHour: number;
  selectedMinute: number;
  onApply: (next: DraftValue) => void;
  onClear: () => void;
  tz: string;
  mode: PickerMode;
  todaySource: "event-zone" | "local";
  displayValue: string;
  zoneLabel?: string | undefined;
  clearable: boolean;
  id?: string | undefined;
  disabled: boolean;
  required: boolean;
  invalid: boolean;
  ariaDescribedBy?: string | undefined;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = `datetime-popover-${useId().replaceAll(":", "")}`;
  const monthHeadingId = `${popoverId}-month`;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [draft, setDraft] = useState<DraftValue>(() => ({
    dayKey: selectedDay ?? "1970-01-01",
    hour: selectedHour,
    minute: selectedMinute,
  }));
  const initialMonth = dayKeyParts(selectedDay ?? "1970-01-01");
  const [visibleMonth, setVisibleMonth] = useState({ year: initialMonth.year, month: initialMonth.month });
  const [rovingDay, setRovingDay] = useState(selectedDay ?? "1970-01-01");
  const currentDay = useCallback(
    (now: Date) => todaySource === "local" ? localCalendarDay(now) : eventDayKey(now, tz),
    [todaySource, tz],
  );
  const today = currentDay(new Date());
  const cells = useMemo(() => calendarCells(visibleMonth.year, visibleMonth.month), [visibleMonth]);
  const validLocalTime = mode === "date" || localDateTimeExists(draft, tz);
  const displayedZoneLabel = open && zoneLabel ? draftZoneAbbreviation(draft, tz) : zoneLabel;

  const closePicker = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  function openPicker() {
    if (disabled || open) return;
    const fallbackDay = currentDay(new Date());
    const fallbackTime = hourMinuteInZone(new Date(), tz);
    const next = {
      dayKey: selectedDay ?? fallbackDay,
      hour: selectedDay ? selectedHour : fallbackTime.hour,
      minute: selectedDay ? selectedMinute : fallbackTime.minute,
    };
    const parts = dayKeyParts(next.dayKey);
    setDraft(next);
    setRovingDay(next.dayKey);
    setVisibleMonth({ year: parts.year, month: parts.month });
    setOpen(true);
  }

  const placePopover = useCallback(() => {
    const anchor = rootRef.current?.getBoundingClientRect();
    const popover = popoverRef.current?.getBoundingClientRect();
    if (anchor && popover) setPosition(positionPopover(anchor, popover));
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      placePopover();
      const preferred = popoverRef.current?.querySelector<HTMLElement>("[data-roving='true'], [data-today='true'], .datetime-calendar-day:not(.is-outside)");
      preferred?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closePicker();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker(true);
    };
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePicker, open, placePopover]);

  useEffect(() => {
    if (disabled && open) closePicker();
  }, [closePicker, disabled, open]);

  function shiftMonth(amount: number) {
    const next = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + amount, 1));
    const nextDay = pagedCalendarDay(rovingDay, visibleMonth.year, visibleMonth.month, amount);
    setVisibleMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
    setRovingDay(nextDay);
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>(`[data-day='${nextDay}']`)?.focus());
  }

  function chooseDay(nextDay: string) {
    setDraft((current) => ({ ...current, dayKey: nextDay }));
    setRovingDay(nextDay);
    const parts = dayKeyParts(nextDay);
    if (parts.year !== visibleMonth.year || parts.month !== visibleMonth.month) {
      setVisibleMonth({ year: parts.year, month: parts.month });
    }
  }

  function moveDay(from: string, amount: number) {
    const parts = dayKeyParts(from);
    const next = new Date(Date.UTC(parts.year, parts.month, parts.day + amount));
    const nextDay = dayKey(next);
    chooseDay(nextDay);
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>(`[data-day='${nextDay}']`)?.focus());
  }

  function moveMonth(from: string, amount: number) {
    const parts = dayKeyParts(from);
    const lastDay = new Date(Date.UTC(parts.year, parts.month + amount + 1, 0)).getUTCDate();
    const nextDay = dayKey(new Date(Date.UTC(parts.year, parts.month + amount, Math.min(parts.day, lastDay))));
    chooseDay(nextDay);
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>(`[data-day='${nextDay}']`)?.focus());
  }

  function apply() {
    if (!validLocalTime) return;
    onApply(draft);
    closePicker(true);
  }

  function containPopoverTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const target = wrappedPopoverTabTarget(focusable, event.currentTarget.ownerDocument.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  const popover = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label={mode === "date" ? "Choose a date" : "Choose a date and time"}
      className="datetime-popover"
      style={position ? { ...position } : { visibility: "hidden", top: 0, left: 0, width: 328 }}
      onKeyDown={containPopoverTab}
    >
      <header className="datetime-popover-header">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button>
        <strong id={monthHeadingId}>{monthLabel(visibleMonth.year, visibleMonth.month)}</strong>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button>
      </header>
      <div className="datetime-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="datetime-calendar-grid" aria-labelledby={monthHeadingId}>
        {cells.map((cell) => {
          const selected = draft.dayKey === cell.dayKey;
          const isToday = today === cell.dayKey;
          return <button
            key={cell.dayKey}
            type="button"
            className={cn("datetime-calendar-day", !cell.inMonth && "is-outside", selected && "is-selected", isToday && "is-today")}
            aria-label={formatDayKeyInZone(cell.dayKey, tz, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            aria-pressed={selected}
            tabIndex={rovingDay === cell.dayKey ? 0 : -1}
            data-day={cell.dayKey}
            data-roving={rovingDay === cell.dayKey || undefined}
            data-selected={selected || undefined}
            data-today={isToday || undefined}
            onKeyDown={(event) => {
              const parts = dayKeyParts(cell.dayKey);
              const movement = event.key === "ArrowLeft" ? -1
                : event.key === "ArrowRight" ? 1
                  : event.key === "ArrowUp" ? -7
                    : event.key === "ArrowDown" ? 7
                      : event.key === "Home" ? -new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay()
                        : event.key === "End" ? 6 - new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay()
                          : null;
              if (movement !== null) {
                event.preventDefault();
                moveDay(cell.dayKey, movement);
                return;
              }
              if (event.key === "PageUp" || event.key === "PageDown") {
                event.preventDefault();
                moveMonth(cell.dayKey, event.key === "PageUp" ? -1 : 1);
              }
            }}
            onClick={() => chooseDay(cell.dayKey)}
          >{cell.day}</button>;
        })}
      </div>
      {mode === "datetime" && <div className="datetime-time-row">
        <span className="datetime-time-label"><Clock3 size={15} /> Time</span>
        <label><span className="sr-only">Hour</span><Select className="datetime-time-select" aria-label="Hour" value={draft.hour} onChange={(event) => setDraft((current) => ({ ...current, hour: Number(event.target.value) }))}>
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}</option>)}
        </Select></label>
        <b aria-hidden="true">:</b>
        <label><span className="sr-only">Minute</span><Select className="datetime-time-select" aria-label="Minute" value={draft.minute} onChange={(event) => setDraft((current) => ({ ...current, minute: Number(event.target.value) }))}>
          {Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{String(minute).padStart(2, "0")}</option>)}
        </Select></label>
      </div>}
      {!validLocalTime && <p className="datetime-picker-warning" role="alert">That local time does not exist because the clock changes on this date. Choose another time.</p>}
      <footer className="datetime-popover-actions">
        <Button size="sm" variant="ghost" onClick={() => chooseDay(currentDay(new Date()))}>Today</Button>
        <span />
        <Button size="sm" variant="secondary" onClick={() => closePicker(true)}>Cancel</Button>
        <Button size="sm" disabled={!validLocalTime} onClick={apply}>Apply</Button>
      </footer>
    </div>,
    datetimePopoverContainer(rootRef.current, document.body),
  ) : null;

  return <>
    <div ref={rootRef} className={cn("datetime-picker", open && "is-open", invalid && "is-invalid", disabled && "is-disabled")}>
      <input
        ref={inputRef}
        id={id}
        className="datetime-picker-input"
        type="text"
        role="combobox"
        readOnly
        value={displayValue}
        placeholder={mode === "date" ? "Select date" : "Select date and time"}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          openPicker();
        }}
      />
      <button
        type="button"
        className="datetime-picker-button"
        aria-label={mode === "date" ? "Open date picker" : "Open date and time picker"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        disabled={disabled}
        onClick={openPicker}
      >
        <CalendarDays size={15} />
      </button>
      {displayedZoneLabel && <span className="datetime-zone">{displayedZoneLabel}</span>}
      {clearable && selectedDay && !disabled && <button type="button" className="datetime-picker-clear" aria-label="Clear date" onClick={onClear}><X size={14} /></button>}
    </div>
    {popover}
  </>;
}

/**
 * Reads and writes in the event timezone and always shows its label. It emits
 * an ISO-8601 UTC instant; date-only mode emits the end of the selected day in
 * that zone. The calendar is application-owned so every browser gets the same
 * themed, keyboard-accessible interaction instead of an unstyleable OS popup.
 */
export function DateTimePicker({
  value,
  onChange,
  tz,
  mode = "datetime",
  clearable = true,
  id,
  disabled = false,
  required = false,
  invalid = false,
  ariaDescribedBy,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  tz: string;
  mode?: PickerMode;
  clearable?: boolean;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const selectedDay = value ? eventDayKey(value, tz) : null;
  const time = value ? hourMinuteInZone(value, tz) : { hour: 0, minute: 0 };
  return <ThemedDateControl
    selectedDay={selectedDay}
    selectedHour={time.hour}
    selectedMinute={time.minute}
    onApply={(next) => onChange(appliedDateTimeValue(value, next, tz, mode))}
    onClear={() => onChange(null)}
    tz={tz}
    mode={mode}
    todaySource="event-zone"
    displayValue={value ? displayInstant(value, tz, mode) : ""}
    zoneLabel={zoneAbbreviation(value ?? new Date(), tz)}
    clearable={clearable}
    id={id}
    disabled={disabled}
    required={required}
    invalid={invalid}
    ariaDescribedBy={ariaDescribedBy}
  />;
}

/** A timezone-free calendar day for participant-authored date questions. */
export function CalendarDatePicker({
  value,
  onChange,
  id,
  disabled = false,
  required = false,
  invalid = false,
  ariaDescribedBy,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  ariaDescribedBy?: string;
}) {
  return <ThemedDateControl
    selectedDay={value}
    selectedHour={0}
    selectedMinute={0}
    onApply={(next) => onChange(next.dayKey)}
    onClear={() => onChange(null)}
    tz="UTC"
    mode="date"
    todaySource="local"
    displayValue={value ? formatDayKeyInZone(value, "UTC", { month: "short", day: "numeric", year: "numeric" }) : ""}
    clearable
    id={id}
    disabled={disabled}
    required={required}
    invalid={invalid}
    ariaDescribedBy={ariaDescribedBy}
  />;
}
