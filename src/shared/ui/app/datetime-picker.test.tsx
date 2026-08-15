import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CalendarDatePicker,
  DateTimePicker,
  appliedDateTimeValue,
  calendarCells,
  datetimePopoverContainer,
  draftZoneAbbreviation,
  localCalendarDay,
  localDateTimeExists,
  pagedCalendarDay,
  wrappedPopoverTabTarget,
} from "./datetime-picker";

Object.assign(globalThis, { React });

describe("DateTimePicker", () => {
  it("mounts inside an enclosing native dialog instead of behind its top layer", () => {
    const dialog = {} as HTMLDialogElement;
    const body = {} as HTMLBodyElement;
    const insideDialog = { closest: () => dialog } as unknown as HTMLElement;
    const outsideDialog = { closest: () => null } as unknown as HTMLElement;

    expect(datetimePopoverContainer(insideDialog, body)).toBe(dialog);
    expect(datetimePopoverContainer(outsideDialog, body)).toBe(body);
    expect(datetimePopoverContainer(null, body)).toBe(body);
  });

  it("uses a themed dialog trigger instead of the operating system date-time popup", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {
      value: "2026-09-15T16:30:00.000Z",
      onChange: () => undefined,
      tz: "America/Los_Angeles",
      invalid: true,
      ariaDescribedBy: "event-end-error",
    }));

    expect(html).toContain('class="datetime-picker is-invalid"');
    expect(html).toContain('type="text"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('value="Sep 15, 2026, 9:30 AM"');
    expect(html).not.toContain('datetime-local');
    expect(html).toContain('aria-describedby="event-end-error"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Open date and time picker"');
    expect(html).toContain('class="datetime-picker-button"');
    expect(html).toContain('class="datetime-zone"');
  });

  it("names the date-only action and disables it with its input", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {
      value: null,
      onChange: () => undefined,
      tz: "UTC",
      mode: "date",
      disabled: true,
    }));

    expect(html).toContain('class="datetime-picker is-disabled"');
    expect(html).toContain('aria-label="Open date picker"');
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("gives participant calendar-day questions the same themed control without a timezone badge", () => {
    const html = renderToStaticMarkup(React.createElement(CalendarDatePicker, {
      value: "2026-09-15",
      onChange: () => undefined,
      required: true,
    }));

    expect(html).toContain('value="Sep 15, 2026"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-label="Open date picker"');
    expect(html).not.toContain(`type=${JSON.stringify("date")}`);
    expect(html).not.toContain('class="datetime-zone"');
  });

  it("derives timezone-free Today from local calendar fields", () => {
    const localClock = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 4,
    };

    expect(localCalendarDay(localClock)).toBe("2026-07-04");
  });

  it("builds stable six-week calendars including adjacent-month navigation targets", () => {
    const cells = calendarCells(2026, 8);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ dayKey: "2026-08-30", day: 30, inMonth: false });
    expect(cells[2]).toEqual({ dayKey: "2026-09-01", day: 1, inMonth: true });
    expect(cells.at(-1)).toEqual({ dayKey: "2026-10-10", day: 10, inMonth: false });
  });

  it("refuses a local time skipped by daylight saving while retaining nearby valid times", () => {
    expect(localDateTimeExists({ dayKey: "2026-03-08", hour: 2, minute: 30 }, "America/Los_Angeles")).toBe(false);
    expect(localDateTimeExists({ dayKey: "2026-03-08", hour: 1, minute: 30 }, "America/Los_Angeles")).toBe(true);
  });

  it("does not refuse an hour that only the US skips on that date", () => {
    // 2026-03-08 is a US transition, and only a US one. An event in UTC, Tokyo,
    // or London has an ordinary 02:00 that day — London's own change is three
    // weeks later. The check read the clock back through `formatInTimeZone`,
    // which renders that instant an hour late even in a zone with no DST at
    // all, so Apply was disabled with "That local time does not exist" for
    // every organizer outside the US.
    for (const tz of ["UTC", "Asia/Tokyo", "Europe/London"]) {
      expect(localDateTimeExists({ dayKey: "2026-03-08", hour: 2, minute: 0 }, tz)).toBe(true);
    }
  });

  it("labels a draft with the abbreviation for its selected date", () => {
    expect(draftZoneAbbreviation({ dayKey: "2026-01-15", hour: 9, minute: 0 }, "America/Los_Angeles")).toBe("PST");
    expect(draftZoneAbbreviation({ dayKey: "2026-07-15", hour: 9, minute: 0 }, "America/Los_Angeles")).toBe("PDT");
  });

  it("preserves either occurrence of an unchanged wall time during a daylight-saving fold", () => {
    const draft = { dayKey: "2026-11-01", hour: 1, minute: 30 };
    const firstOccurrence = "2026-11-01T08:30:00.000Z";
    const secondOccurrence = "2026-11-01T09:30:00.000Z";

    expect(appliedDateTimeValue(firstOccurrence, draft, "America/Los_Angeles", "datetime")).toBe(firstOccurrence);
    expect(appliedDateTimeValue(secondOccurrence, draft, "America/Los_Angeles", "datetime")).toBe(secondOccurrence);
  });

  it("keeps a clamped day target in the tab order when paging months", () => {
    expect(pagedCalendarDay("2026-01-31", 2026, 0, 1)).toBe("2026-02-28");
    expect(pagedCalendarDay("2026-02-28", 2026, 1, 1)).toBe("2026-03-28");
  });

  it("wraps keyboard focus at both edges of the popover", () => {
    const previous = { id: "previous" };
    const selectedDay = { id: "selected-day" };
    const apply = { id: "apply" };
    const focusable = [previous, selectedDay, apply];

    expect(wrappedPopoverTabTarget(focusable, apply, false)).toBe(previous);
    expect(wrappedPopoverTabTarget(focusable, previous, true)).toBe(apply);
    expect(wrappedPopoverTabTarget(focusable, selectedDay, false)).toBeNull();
    expect(wrappedPopoverTabTarget([], null, false)).toBeNull();
  });
});
