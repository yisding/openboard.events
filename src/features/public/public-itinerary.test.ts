import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SCHEDULE_FIXTURE } from "@/shared/fixtures/sessions";
import { myScheduleEmptyCopy, PublicItinerary } from "./public-itinerary";

Object.assign(globalThis, { React });

// `useEffect` (the localStorage read/reconcile) never runs under
// `renderToStaticMarkup` — the localStorage read/reconcile/persist logic
// itself is covered node-side, without a DOM, in `itinerary-storage.test.ts`.
// This file only proves the server-rendered shell: every session gets a star
// toggle, the My Schedule filter and export affordances are present, and the
// export starts disabled with nothing starred yet (pre-hydration state).
describe("PublicItinerary", () => {
  it("distinguishes no stars from stars hidden by embed filters", () => {
    expect(myScheduleEmptyCopy(0)).toMatchObject({
      title: "No starred sessions yet",
      hiddenByEmbed: false,
    });
    expect(myScheduleEmptyCopy(2)).toMatchObject({
      title: "Your starred sessions are outside this embed",
      hiddenByEmbed: true,
    });
  });

  it("renders every published session with a star toggle and the My Schedule control", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain("Agents");
    expect(html).toContain("My Schedule");
    expect(html).toContain("itinerary-star");
  });

  it("starts with the export disabled (nothing starred pre-hydration)", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain("Star sessions to export");
    expect(html).not.toContain("/schedule/ics?session=");
  });

  it("shows the coming-soon empty state when the event has no published sessions", () => {
    const empty = { ...PUBLISHED_SCHEDULE_FIXTURE, days: [], sessions: [] };
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, { eventSlug: "openboard-summit", schedule: empty }));

    expect(html).toContain("Schedule coming soon");
  });

  it("distinguishes configured filters with no matches from an unpublished schedule", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      filters: { trackIds: ["00000000-0000-4000-8000-000000000999"] },
    }));

    expect(html).toContain("No itinerary sessions match this embed");
    expect(html).not.toContain("Schedule coming soon");
  });
});
