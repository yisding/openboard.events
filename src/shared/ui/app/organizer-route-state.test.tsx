import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventWorkspaceLoading, EventsHubLoading } from "./route-loading-state";
import { RouteErrorState } from "./route-error-state";

Object.assign(globalThis, { React });

describe("organizer route recovery states", () => {
  it("announces each loading boundary without exposing decorative skeletons", () => {
    const hub = renderToStaticMarkup(<EventsHubLoading />);
    const workspace = renderToStaticMarkup(<EventWorkspaceLoading />);

    expect(hub).toContain('aria-busy="true"');
    expect(hub).toContain('<p class="sr-only" role="status">Loading your events…</p>');
    expect(hub).toContain('class="event-grid" aria-hidden="true"');
    expect(workspace).toContain('<p class="sr-only" role="status">Loading this event workspace…</p>');
    expect(workspace).toContain('class="route-workspace-loading__grid" aria-hidden="true"');
  });

  it("renders a retry action and a real escape route from errors", () => {
    const html = renderToStaticMarkup(
      <RouteErrorState
        title="This page did not load"
        description="The saved data is safe."
        reset={() => undefined}
        backHref="/events"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).toContain('href="/events"');
    expect(html).toContain("Back to events");
  });

  it("keeps explicit authorization and not-found handling ahead of route failures", () => {
    const layout = readFileSync(new URL("../../../app/events/[eventId]/layout.tsx", import.meta.url), "utf8");
    const parentError = readFileSync(new URL("../../../app/events/error.tsx", import.meta.url), "utf8");
    const eventError = readFileSync(new URL("../../../app/events/[eventId]/error.tsx", import.meta.url), "utf8");

    expect(layout).toContain('if (error.code === "FORBIDDEN")');
    expect(layout).toContain("if (!record) notFound()");
    expect(parentError).toContain('const atHub = usePathname() === "/events"');
    expect(parentError).toContain('backHref={atHub ? "/organizations" : "/events"}');
    expect(eventError).toContain('backHref="/events"');
  });
});
