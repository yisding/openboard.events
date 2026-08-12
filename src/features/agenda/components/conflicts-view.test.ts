import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  roomIdSchema,
  scheduledSessionDtoSchema,
  sessionIdSchema,
  type AcceptedForSchedulingRow,
  type ConflictDTO,
  type ScheduledSessionDTO,
} from "@/shared/contracts";
import ConflictsView, { sortConflicts } from "./conflicts-view";
import { conflictsTouchingSessions } from "../store";

Object.assign(globalThis, { React });

const id = (suffix: string) => `d5000000-0000-4000-8000-0000000000${suffix}`;
const sessionId = (suffix: string) => sessionIdSchema.parse(id(suffix));
const roomA = roomIdSchema.parse(id("10"));
const tz = "America/Los_Angeles";
const eventId = eventIdSchema.parse(id("40"));

function session(overrides: Omit<Partial<ScheduledSessionDTO>, "id"> & { id: string; title: string }): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    slug: "a-talk",
    descriptionHtml: "",
    startsAt: "2026-08-11T18:00:00.000Z",
    endsAt: "2026-08-11T18:45:00.000Z",
    trackId: null,
    roomId: roomA,
    formatId: null,
    status: "published",
    scheduleRevision: 1,
    rowVersion: 1,
    speakerIds: [],
    ...overrides,
  });
}

function conflict(overrides: Partial<ConflictDTO>): ConflictDTO {
  return {
    kind: "room",
    severity: "error",
    a: sessionId("01"),
    b: sessionId("02"),
    subjectId: String(roomA),
    overlapStartMs: Date.parse("2026-08-11T18:00:00.000Z"),
    overlapEndMs: Date.parse("2026-08-11T18:30:00.000Z"),
    ...overrides,
  };
}

describe("sortConflicts", () => {
  it("puts every error ahead of every warning, then sorts by overlap start within a severity", () => {
    const late = conflict({ severity: "warning", overlapStartMs: 300, kind: "track" });
    const early = conflict({ severity: "warning", overlapStartMs: 100, kind: "track" });
    const blocker = conflict({ severity: "error", overlapStartMs: 500, kind: "room" });
    expect(sortConflicts([late, early, blocker])).toEqual([blocker, early, late]);
  });

  it("does not mutate the array it was given", () => {
    const input = [conflict({ overlapStartMs: 2 }), conflict({ overlapStartMs: 1 })];
    const original = [...input];
    sortConflicts(input);
    expect(input).toEqual(original);
  });
});

describe("conflictsTouchingSessions", () => {
  const sessions = [
    session({ id: id("01"), title: "Alpha" }),
    session({ id: id("02"), title: "Beta" }),
    session({ id: id("03"), title: "Gamma" }),
    session({ id: id("04"), title: "Delta" }),
  ];
  const conflicts = [
    conflict({ a: sessionId("01"), b: sessionId("02") }),
    conflict({ a: sessionId("03"), b: sessionId("04"), subjectId: "second" }),
  ];

  it("matches a relationship when either endpoint session is visible", () => {
    expect(conflictsTouchingSessions(conflicts, sessions.slice(0, 1))).toEqual([conflicts[0]]);
    expect(conflictsTouchingSessions(conflicts, sessions.slice(1, 2))).toEqual([conflicts[0]]);
    expect(conflictsTouchingSessions(conflicts, [])).toEqual([]);
  });

  it("does not mutate the server conflict or session arrays", () => {
    const originalConflicts = [...conflicts];
    const originalSessions = [...sessions];
    conflictsTouchingSessions(conflicts, sessions.slice(0, 1));
    expect(conflicts).toEqual(originalConflicts);
    expect(sessions).toEqual(originalSessions);
  });

  it("wires filtered rows to the full session-title lookup", () => {
    const source = readFileSync(new URL("./agenda-page.tsx", import.meta.url), "utf8");
    expect(source).toContain("conflicts={visibleConflicts}");
    expect(source).toContain("sessions={sessions}");
    expect(source).toContain("searchActive={needle.length > 0}");
  });
});

describe("<ConflictsView>", () => {
  const baseProps = {
    eventId,
    event: { timezone: tz, startsAt: "2026-08-11T16:00:00.000Z", endsAt: "2026-08-12T23:00:00.000Z" },
    rooms: [],
    tracks: [],
    formats: [],
    speakers: [],
    accepted: [] as AcceptedForSchedulingRow[],
  };

  it("shows the calm empty state when there are no conflicts", () => {
    const html = renderToStaticMarkup(React.createElement(ConflictsView, { ...baseProps, sessions: [], conflicts: [] }));
    expect(html).toContain("No conflicts — nice work");
  });

  it("distinguishes an empty search result from a conflict-free schedule", () => {
    const html = renderToStaticMarkup(React.createElement(ConflictsView, {
      ...baseProps,
      sessions: [],
      conflicts: [],
      searchActive: true,
    }));
    expect(html).toContain("No conflicts match your search");
    expect(html).not.toContain("No conflicts — nice work");
  });

  it("renders the two seeded conflict pairs with their kind label and a Jump to Day link to the right day", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("01"), title: "⚠ Demo conflict A — Platform deep dive" }),
      session({ id: id("02"), title: "⚠ Demo conflict A — Vector search at scale" }),
      session({ id: id("03"), title: "⚠ Demo conflict B — Agent evals live" }),
      session({ id: id("04"), title: "⚠ Demo conflict B — Guardrails that do not annoy anyone" }),
    ];
    const conflicts: ConflictDTO[] = [
      conflict({ kind: "room", severity: "error", a: sessionId("01"), b: sessionId("02"), overlapStartMs: Date.parse("2026-08-11T18:30:00.000Z") }),
      conflict({ kind: "speaker", severity: "error", a: sessionId("03"), b: sessionId("04"), overlapStartMs: Date.parse("2026-08-11T22:15:00.000Z") }),
    ];
    const html = renderToStaticMarkup(React.createElement(ConflictsView, { ...baseProps, sessions, conflicts }));

    expect(html).toContain("Room conflict");
    expect(html).toContain("Speaker conflict");
    expect(html).toContain("Platform deep dive");
    expect(html).toContain("Vector search at scale");
    expect(html).toContain("Agent evals live");
    expect((html.match(/Jump to Day/g) ?? []).length).toBe(2);
    // The overlap lands on Aug 11 in the event's own zone — the jump link must
    // carry that day key, not whatever day the viewer happens to be in.
    expect(html).toContain(`/events/${eventId}/agenda?view=day&amp;day=2026-08-11`);
  });

  it("falls back only when the full session lookup genuinely lacks an endpoint", () => {
    const conflicts: ConflictDTO[] = [conflict({})];
    const sessions = [session({ id: id("01"), title: "Still here" })];
    const html = renderToStaticMarkup(React.createElement(ConflictsView, { ...baseProps, sessions, conflicts }));
    expect(html).toContain("Still here");
    expect(html).toContain("Removed session");
  });
});
