import { describe, expect, it } from "vitest";
import { addDuration, daysToEvent, endOfDayInTz, eventDayKey, formatDateRangeInZone, formatDayKeyInZone, formatInZone, formatTimeRangeInZone, timeZoneOptionLabel, shiftDayKey, startOfDayInTz, wallTimeExistsInZone, zonedInputToUtc } from "./time";

const LA = "America/Los_Angeles";

describe("event timezone API", () => {
  it("converts local input before and after spring DST", () => {
    expect(zonedInputToUtc("2026-03-08T01:30:00", LA).toISOString()).toBe("2026-03-08T09:30:00.000Z");
    expect(zonedInputToUtc("2026-03-08T03:30:00", LA).toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });

  it("uses the correct end-of-day instant across DST", () => {
    expect(endOfDayInTz("2026-03-08", LA).toISOString()).toBe("2026-03-09T06:59:59.999Z");
    expect(endOfDayInTz("2026-11-01", LA).toISOString()).toBe("2026-11-02T07:59:59.999Z");
  });

  it("bins UTC rollover instants into the event day", () => {
    expect(eventDayKey("2026-09-16T04:00:00.000Z", LA)).toBe("2026-09-15");
    expect(eventDayKey("2026-09-16T07:30:00.000Z", LA)).toBe("2026-09-16");
  });

  it.each(["Pacific/Auckland", "Pacific/Kiritimati"])("keeps a day key on the same calendar date in %s", (timeZone) => {
    const rendered = formatDayKeyInZone("2026-09-15", timeZone, { weekday: "short", month: "short", day: "numeric" });
    expect(rendered).toContain("Tue, Sep 15");
    expect(rendered).not.toMatch(/\b(?:PDT|PST|GMT|UTC)\b/);
    expect(rendered).not.toContain("Sep 16");
  });

  it("always appends the zone label", () => {
    expect(formatInZone("2026-10-15T19:00:00.000Z", LA, "dateTime")).toMatch(/PDT$/);
    expect(formatInZone("2026-12-15T20:00:00.000Z", LA, "dateTime")).toMatch(/PST$/);
  });

  it("presents canonical timezone values as readable selector labels", () => {
    expect(timeZoneOptionLabel(LA)).toMatch(/Los Angeles$/);
    expect(timeZoneOptionLabel(LA)).not.toContain("/");
    expect(timeZoneOptionLabel("Europe/London")).toMatch(/London$/);
    expect(timeZoneOptionLabel("Europe/London")).not.toContain("/");
    expect(timeZoneOptionLabel("UTC")).toBe("UTC");
    expect(timeZoneOptionLabel("Not_A_Real_Zone")).toBe("Not A Real Zone");
  });

  it("accepts Intl style shortcuts without mixing component options", () => {
    expect(formatInZone("2026-10-15T19:00:00.000Z", LA, { dateStyle: "medium" })).toBe("Oct 15, 2026");
    expect(formatInZone("2026-10-15T19:00:00.000Z", LA, { timeStyle: "short" })).toBe("12:00 PM");
  });

  it("keeps date-only component formats free of a dangling zone joiner", () => {
    expect(formatInZone("2026-08-12T19:00:00.000Z", LA, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })).toBe("Wednesday, August 12");
    expect(formatInZone("2026-08-12T19:00:00.000Z", LA, {
      month: "long",
      day: "numeric",
      timeZoneName: "short",
    })).toBe("August 12 at PDT");
  });

  it("formats event ranges compactly with one shared zone label", () => {
    expect(formatDateRangeInZone("2026-10-16T16:00:00.000Z", "2026-10-19T01:00:00.000Z", LA))
      .toBe("Oct 16 – 18, 2026 PDT");
    expect(formatDateRangeInZone("2026-09-30T19:00:00.000Z", "2026-10-03T01:00:00.000Z", LA))
      .toBe("Sep 30 – Oct 2, 2026 PDT");
  });

  it("keeps both zone labels when a range crosses a DST boundary", () => {
    expect(formatDateRangeInZone("2026-10-31T19:00:00.000Z", "2026-11-02T20:00:00.000Z", LA))
      .toBe("Oct 31, 2026 PDT – Nov 2, 2026 PST");
  });

  it("formats event-local time ranges without repeating shared labels", () => {
    expect(formatTimeRangeInZone("2026-10-15T16:00:00.000Z", "2026-10-15T16:45:00.000Z", LA))
      .toBe("9:00–9:45 AM PDT");
    expect(formatTimeRangeInZone("2026-10-15T18:30:00.000Z", "2026-10-15T19:15:00.000Z", LA))
      .toBe("11:30 AM–12:15 PM PDT");
  });

  it("keeps both zone labels when a time range crosses a DST boundary", () => {
    expect(formatTimeRangeInZone("2026-11-01T08:30:00.000Z", "2026-11-01T10:30:00.000Z", LA))
      .toBe("1:30 AM PDT–2:30 AM PST");
  });

  it("uses calendar-day differences across DST", () => {
    expect(daysToEvent(new Date("2026-01-10T20:00:00.000Z"), new Date("2026-03-16T19:00:00.000Z"), LA)).toBe(65);
  });

  it("adds supported ISO durations", () => {
    expect(addDuration(new Date("2026-03-08T09:00:00.000Z"), "P1D").toISOString()).toBe("2026-03-09T09:00:00.000Z");
    expect(addDuration(new Date("2026-03-08T09:00:00.000Z"), "PT1H30M").toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });

  it.each(["P", "PT", "P1DT"])("rejects incomplete ISO duration %s", (duration) => {
    expect(() => addDuration(new Date("2026-03-08T09:00:00.000Z"), duration)).toThrow(TypeError);
  });
});

describe("wallTimeExistsInZone", () => {
  const TZ = "America/New_York";

  it("rejects the hour a spring-forward date skips, and shows why the check is needed", () => {
    // 2026-03-08: the clock goes 01:59 -> 03:00, so 02:00-02:59 never happens.
    expect(wallTimeExistsInZone("2026-03-08T01:45:00", TZ)).toBe(true);
    expect(wallTimeExistsInZone("2026-03-08T02:00:00", TZ)).toBe(false);
    expect(wallTimeExistsInZone("2026-03-08T02:15:00", TZ)).toBe(false);
    expect(wallTimeExistsInZone("2026-03-08T03:00:00", TZ)).toBe(true);

    // `zonedInputToUtc` does not reject a skipped time — it resolves backwards
    // to the pre-transition offset, so the instant moves *down* as the
    // requested minute moves up. A caller deriving two edges from adjacent
    // minutes can therefore write an end before its start.
    const at0145 = zonedInputToUtc("2026-03-08T01:45:00", TZ);
    const at0200 = zonedInputToUtc("2026-03-08T02:00:00", TZ);
    expect(at0200.getTime()).toBeLessThan(at0145.getTime());
  });

  it("accepts both passes of an hour a fall-back date repeats", () => {
    // 2026-11-01 runs 01:00-01:59 twice. Both are real times; only one instant
    // is chosen, which is a documented ambiguity, not a nonexistent time.
    expect(wallTimeExistsInZone("2026-11-01T01:30:00", TZ)).toBe(true);
  });

  it("accepts every wall time in a zone that does not observe DST", () => {
    expect(wallTimeExistsInZone("2026-03-08T02:00:00", "UTC")).toBe(true);
    expect(wallTimeExistsInZone("2026-03-08T02:00:00", "Asia/Tokyo")).toBe(true);
  });
});

describe("startOfDayInTz", () => {
  it("finds the first instant that exists on a day whose midnight is skipped", () => {
    // Havana's clock jumps at midnight on 2026-03-08, so `T00:00:00` does not
    // exist. `fromZonedTime` resolves it *backwards* into the previous day —
    // which made a day window 25 hours long and overlapping its predecessor.
    const naive = zonedInputToUtc("2026-03-08T00:00:00", "America/Havana");
    expect(formatInZone(naive, "America/Havana", { dateStyle: "short", timeStyle: "short" })).toContain("3/7/26");

    const real = startOfDayInTz("2026-03-08", "America/Havana");
    expect(formatInZone(real, "America/Havana", { dateStyle: "short" })).toContain("3/8/26");
    // And it is genuinely the first instant of the day: one millisecond earlier
    // still belongs to the 7th.
    expect(formatInZone(new Date(real.getTime() - 1), "America/Havana", { dateStyle: "short" })).toContain("3/7/26");
  });

  it("is plain local midnight on an ordinary day", () => {
    const start = startOfDayInTz("2026-06-15", "America/New_York");
    expect(formatInZone(start, "America/New_York", { timeStyle: "short" })).toBe("12:00 AM");
  });

  it("holds for the other zones that skip midnight", () => {
    for (const [zone, day] of [["America/Santiago", "2026-09-06"], ["Asia/Beirut", "2026-03-29"]] as const) {
      const start = startOfDayInTz(day, zone);
      expect(formatInZone(start, zone, { dateStyle: "short" })).toContain(String(Number(day.slice(8))));
      expect(formatInZone(new Date(start.getTime() - 1), zone, { dateStyle: "short" }))
        .not.toContain(`/${Number(day.slice(8))}/`);
    }
  });
});

describe("shiftDayKey", () => {
  it("steps calendar days without touching an instant", () => {
    expect(shiftDayKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDayKey("2026-03-08", -1)).toBe("2026-03-07");
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDayKey("2026-06-15", 0)).toBe("2026-06-15");
  });
});
