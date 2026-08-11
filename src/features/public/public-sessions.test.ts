import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SCHEDULE_FIXTURE } from "@/shared/fixtures/sessions";
import { PublicSessions } from "./public-sessions";

Object.assign(globalThis, { React });

describe("PublicSessions", () => {
  it("renders the fetched schedule into server markup", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSessions, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain(PUBLISHED_SCHEDULE_FIXTURE.event.name);
    expect(html).toContain("Agents");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('aria-label="Read more about Agents"');
  });

  it("uses initialSearch for the markup sent before hydration, matching the PR #71 cache contract", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSessions, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      initialSearch: "no-such-session",
    }));

    expect(html).not.toContain("<h3>Agents</h3>");
    expect(html).toContain("No sessions match those filters");
  });

  it("shows the coming-soon empty state when the event has no published sessions", () => {
    const empty = { ...PUBLISHED_SCHEDULE_FIXTURE, days: [], sessions: [] };
    const html = renderToStaticMarkup(React.createElement(PublicSessions, { eventSlug: "openboard-summit", schedule: empty }));

    expect(html).toContain("Sessions coming soon");
  });

  it("hides the description when the embed field-visibility filter turns it off", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSessions, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      filters: { fields: { description: false } },
    }));

    // "Agents" is still the session title, but the fixture's description
    // paragraph text must not render when the field is hidden.
    expect(html).toContain("Agents");
    expect(html).not.toContain("<p>Agents</p>");
  });

  it("narrows to a single session with a track+format+location combination that excludes it", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSessions, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      filters: { trackIds: ["00000000-0000-4000-8000-000000000999"] },
    }));

    expect(html).not.toContain("<h3>Agents</h3>");
    expect(html).toContain("No sessions match those filters");
  });
});
