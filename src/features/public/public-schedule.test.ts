import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publishedScheduleDtoSchema, sessionIdSchema } from "@/shared/contracts";
import { PUBLISHED_SCHEDULE_FIXTURE } from "@/shared/fixtures/sessions";
import { PublicSchedule } from "./public-schedule";

Object.assign(globalThis, { React });

describe("PublicSchedule", () => {
  it("renders the fetched schedule into server markup", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSchedule, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain(PUBLISHED_SCHEDULE_FIXTURE.event.name);
    expect(html).toContain("Agents");
    expect(html).toContain("Ada Lovelace");
  });

  it("uses initialSearch for the markup sent before hydration, matching the PR #71 cache contract", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSchedule, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      initialSearch: "no-such-session",
    }));

    expect(html).not.toContain("<h3>Agents</h3>");
    expect(html).toContain("No sessions match those filters");
  });

  it("jumps the active day tab to a deep-linked session on a later day (?session=<id>)", () => {
    const daySession = {
      ...PUBLISHED_SCHEDULE_FIXTURE.sessions[0],
      id: "00000000-0000-4000-8000-000000000602",
      slug: "day-two-session",
      title: "Day Two Keynote",
      startsAt: "2026-09-16T16:00:00.000Z",
      endsAt: "2026-09-16T16:30:00.000Z",
      dayKey: "2026-09-16",
    };
    const twoDaySchedule = publishedScheduleDtoSchema.parse({
      ...PUBLISHED_SCHEDULE_FIXTURE,
      days: ["2026-09-15", "2026-09-16"],
      sessions: [...PUBLISHED_SCHEDULE_FIXTURE.sessions, daySession],
    });

    const html = renderToStaticMarkup(React.createElement(PublicSchedule, {
      eventSlug: "openboard-summit",
      schedule: twoDaySchedule,
      initialExpandedSessionId: sessionIdSchema.parse(daySession.id),
    }));

    // The day-2 session's title must actually be in the rendered list (its
    // day tab must be selected), not just theoretically reachable.
    expect(html).toContain("Day Two Keynote");
  });

  it("shows the coming-soon empty state when the event has no published days", () => {
    const empty = { ...PUBLISHED_SCHEDULE_FIXTURE, days: [], sessions: [] };
    const html = renderToStaticMarkup(React.createElement(PublicSchedule, { eventSlug: "openboard-summit", schedule: empty }));

    expect(html).toContain("Schedule coming soon");
  });
});
