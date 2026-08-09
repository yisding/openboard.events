import { describe, expect, it } from "vitest";
import { addDuration, daysToEvent, endOfDayInTz, eventDayKey, formatInZone, zonedInputToUtc } from "./time";

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

  it("always appends the zone label", () => {
    expect(formatInZone("2026-10-15T19:00:00.000Z", LA, "dateTime")).toMatch(/PDT$/);
    expect(formatInZone("2026-12-15T20:00:00.000Z", LA, "dateTime")).toMatch(/PST$/);
  });

  it("uses calendar-day differences across DST", () => {
    expect(daysToEvent(new Date("2026-01-10T20:00:00.000Z"), new Date("2026-03-16T19:00:00.000Z"), LA)).toBe(65);
  });

  it("adds supported ISO durations", () => {
    expect(addDuration(new Date("2026-03-08T09:00:00.000Z"), "P1D").toISOString()).toBe("2026-03-09T09:00:00.000Z");
    expect(addDuration(new Date("2026-03-08T09:00:00.000Z"), "PT1H30M").toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });
});
