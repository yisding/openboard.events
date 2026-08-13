import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { EventSwitcher } from "./event-switcher";

Object.assign(globalThis, { React });

const currentPastId = eventIdSchema.parse("c4300000-0000-4000-8000-000000000021");

describe("EventSwitcher lifecycle ordering", () => {
  it("keeps a currently open past event while ordering useful work above history", () => {
    const html = renderToStaticMarkup(<EventSwitcher
      eventId={currentPastId}
      canCreateEvent={false}
      nowIso="2026-08-13T12:00:00.000Z"
      defaultOpen
      demoEvents={[
        { id: "c4300000-0000-4000-8000-000000000022", name: "Later", startsAt: "2026-10-01T12:00:00.000Z", endsAt: "2026-10-02T12:00:00.000Z", timezone: "UTC" },
        { id: currentPastId, name: "Open History", startsAt: "2026-07-01T12:00:00.000Z", endsAt: "2026-07-02T12:00:00.000Z", timezone: "UTC" },
        { id: "c4300000-0000-4000-8000-000000000023", name: "Happening", startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-14T12:00:00.000Z", timezone: "UTC" },
        { id: "c4300000-0000-4000-8000-000000000024", name: "Next", startsAt: "2026-09-01T12:00:00.000Z", endsAt: "2026-09-02T12:00:00.000Z", timezone: "UTC" },
      ]}
    />);

    expect(html.indexOf("Happening")).toBeLessThan(html.indexOf("Next"));
    expect(html.indexOf("Next")).toBeLessThan(html.indexOf("Later"));
    expect(html.indexOf("Later")).toBeLessThan(html.lastIndexOf("Open History"));
    expect(html).toContain('class="event-switcher-option is-past"');
    expect(html).toContain('aria-current="page"');
  });
});
