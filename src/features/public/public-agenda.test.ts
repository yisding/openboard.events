import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publishedScheduleDtoSchema, sessionIdSchema } from "@/shared/contracts";
import { PUBLISHED_SCHEDULE_FIXTURE } from "@/shared/fixtures/sessions";
import { PublicAgenda } from "./public-agenda";

Object.assign(globalThis, { React });

describe("PublicAgenda", () => {
  it("renders the fetched schedule into server markup with day/time/room structure", () => {
    const html = renderToStaticMarkup(React.createElement(PublicAgenda, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain(PUBLISHED_SCHEDULE_FIXTURE.event.name);
    expect(html).toContain("Agents");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Main Hall");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(`src="${PUBLISHED_SCHEDULE_FIXTURE.event.logoUrl}"`);
    expect(html).toContain(`src="${PUBLISHED_SCHEDULE_FIXTURE.event.backgroundUrl}"`);
    expect(html).toContain('class="public-event-hero-image"');
  });

  it("keeps hosted-site branding out of embeddable agenda documents", () => {
    const html = renderToStaticMarkup(React.createElement(PublicAgenda, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      embed: true,
    }));

    expect(html).not.toContain(PUBLISHED_SCHEDULE_FIXTURE.event.logoUrl);
    expect(html).not.toContain(PUBLISHED_SCHEDULE_FIXTURE.event.backgroundUrl);
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

    const html = renderToStaticMarkup(React.createElement(PublicAgenda, {
      eventSlug: "openboard-summit",
      schedule: twoDaySchedule,
      initialExpandedSessionId: sessionIdSchema.parse(daySession.id),
    }));

    // The day-2 session's title must actually be in the rendered list (its
    // day tab must be selected), not just theoretically reachable.
    expect(html).toContain("Day Two Keynote");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("shows the coming-soon empty state when the event has no published days", () => {
    const empty = { ...PUBLISHED_SCHEDULE_FIXTURE, days: [], sessions: [] };
    const html = renderToStaticMarkup(React.createElement(PublicAgenda, { eventSlug: "openboard-summit", schedule: empty }));

    expect(html).toContain("Agenda coming soon");
  });

  it("applies an embed room filter, excluding a session in a different room", () => {
    const html = renderToStaticMarkup(React.createElement(PublicAgenda, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      filters: { roomIds: ["00000000-0000-4000-8000-000000000999"] },
    }));

    expect(html).not.toContain("<h3>Agents</h3>");
    expect(html).toContain("No agenda sessions match this embed");
    expect(html).not.toContain("Agenda coming soon");
  });
});
