/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { EventSwitcher } from "./event-switcher";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.useRealTimers());

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

  it("refreshes lifecycle status when a long-lived switcher opens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<EventSwitcher
        eventId={currentPastId}
        canCreateEvent={false}
        nowIso="2026-08-13T12:00:00.000Z"
        demoEvents={[
          { id: currentPastId, name: "Boundary event", startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-14T12:00:00.000Z", timezone: "UTC" },
        ]}
      />));

      await act(async () => container.querySelector<HTMLButtonElement>(".event-switcher")?.click());

      expect(container.querySelector(".event-switcher-option")?.className).toContain("is-past");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
