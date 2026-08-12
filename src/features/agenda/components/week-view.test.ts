import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  roomIdSchema,
  scheduledSessionDtoSchema,
  trackIdSchema,
  type AcceptedForSchedulingRow,
  type RoomDTO,
  type ScheduledSessionDTO,
  type TrackDTO,
} from "@/shared/contracts";
import WeekView, { bucketByDay, weekDayKeys } from "./week-view";

Object.assign(globalThis, { React });

const id = (suffix: string) => `d5000000-0000-4000-8000-0000000000${suffix}`;
const trackA = trackIdSchema.parse(id("20"));
const roomA = roomIdSchema.parse(id("10"));
const tz = "America/Los_Angeles";

function session(overrides: Omit<Partial<ScheduledSessionDTO>, "id"> & { id: string }): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    title: overrides.title ?? "A talk",
    slug: overrides.slug ?? "a-talk",
    descriptionHtml: "",
    startsAt: overrides.startsAt ?? "2026-08-11T17:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-08-11T17:30:00.000Z",
    trackId: overrides.trackId ?? null,
    roomId: overrides.roomId ?? null,
    formatId: null,
    status: "published",
    scheduleRevision: 1,
    rowVersion: 1,
    speakerIds: [],
    ...overrides,
  });
}

describe("weekDayKeys", () => {
  it("walks every event day exactly once, in order, over a DST-crossing window", () => {
    // The seeded fall-back happens the first Sunday of November in the US; a
    // naive 24h*ms loop keyed on the wrong instant would drop or double a day.
    const keys = weekDayKeys("2026-11-01T02:00:00.000Z", "2026-11-03T02:00:00.000Z", "America/Los_Angeles");
    expect(keys).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("never loops past the last day even given a same-instant start and end", () => {
    const keys = weekDayKeys("2026-08-11T17:00:00.000Z", "2026-08-11T18:00:00.000Z", tz);
    expect(keys).toEqual(["2026-08-11"]);
  });

  it("omits an empty ending date when the event closes at local midnight", () => {
    expect(weekDayKeys(
      "2026-09-15T16:00:00.000Z",
      "2026-09-17T07:00:00.000Z",
      "America/Los_Angeles",
    )).toEqual(["2026-09-15", "2026-09-16"]);
  });
});

describe("bucketByDay", () => {
  it("buckets each session under its event-tz day key, chronological within a day", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("02"), startsAt: "2026-08-11T18:00:00.000Z", endsAt: "2026-08-11T18:30:00.000Z" }),
      session({ id: id("01"), startsAt: "2026-08-11T17:00:00.000Z", endsAt: "2026-08-11T17:30:00.000Z" }),
      // 11pm Pacific on Aug 11 is already Aug 12 UTC — this is the case the
      // guardrail calls out: it must still land on the Aug-11 event-tz column.
      session({ id: id("03"), startsAt: "2026-08-12T06:30:00.000Z", endsAt: "2026-08-12T07:00:00.000Z" }),
    ];
    const byDay = bucketByDay(sessions, tz);
    expect(byDay.get("2026-08-11")?.map((s) => s.id)).toEqual([id("01"), id("02"), id("03")]);
    expect(byDay.has("2026-08-12")).toBe(false);
  });

  it("never buckets an unscheduled session", () => {
    const sessions: ScheduledSessionDTO[] = [session({ id: id("01"), startsAt: null, endsAt: null })];
    const byDay = bucketByDay(sessions, tz);
    expect([...byDay.values()].flat()).toHaveLength(0);
  });
});

describe("<WeekView>", () => {
  const baseProps = {
    eventId: eventIdSchema.parse(id("40")),
    event: { timezone: tz, startsAt: "2026-08-11T16:00:00.000Z", endsAt: "2026-08-12T23:00:00.000Z" },
    rooms: [{ id: roomA, name: "Main Stage", capacity: 200, sortOrder: 0 } satisfies RoomDTO],
    tracks: [{ id: trackA, name: "Agents", color: "#6958d7", description: null, sortOrder: 0 } satisfies TrackDTO],
    formats: [],
    speakers: [],
    conflicts: [],
    accepted: [] as AcceptedForSchedulingRow[],
  };

  it("shows a day with zero scheduled sessions as a note, not an empty void, and excludes unscheduled rows", () => {
    const html = renderToStaticMarkup(React.createElement(WeekView, {
      ...baseProps,
      sessions: [
        session({ id: id("01"), startsAt: "2026-08-11T17:00:00.000Z", endsAt: "2026-08-11T17:30:00.000Z", trackId: trackA, roomId: roomA }),
        session({ id: id("02"), startsAt: null, endsAt: null }),
      ],
    }));
    expect(html).toContain("Nothing scheduled");
    expect(html).toContain("A talk");
    expect(html).toContain("Main Stage");
  });
});
