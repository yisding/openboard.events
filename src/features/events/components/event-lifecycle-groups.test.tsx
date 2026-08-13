/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventAccessDtoSchema } from "@/shared/contracts";
import { EventLifecycleGroups } from "./event-lifecycle-groups";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.useRealTimers());

describe("EventLifecycleGroups", () => {
  it("moves an event between groups as its start and end boundaries pass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    const event = eventAccessDtoSchema.parse({
      id: "c4300000-0000-4000-8000-000000000031",
      name: "Boundary Conf",
      slug: "boundary-conf",
      eventType: "conference",
      websiteUrl: null,
      location: null,
      physicalAddress: null,
      timezone: "UTC",
      startsAt: "2026-08-13T12:00:01.000Z",
      endsAt: "2026-08-13T12:00:02.000Z",
      theme: null,
      logoFileId: null,
      backgroundFileId: null,
      submissionCapPerUser: 3,
      rowVersion: 1,
      role: "organizer",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<EventLifecycleGroups events={[event]} nowIso="2026-08-13T12:00:00.000Z" />));
      expect(container.textContent).toContain("Upcoming");

      await act(async () => vi.advanceTimersByTime(1_025));
      expect(container.textContent).toContain("Happening now");
      expect(container.textContent).not.toContain("Upcoming");

      await act(async () => vi.advanceTimersByTime(1_000));
      expect(container.textContent).toContain("Past events");
      expect(container.querySelector<HTMLDetailsElement>(".past-events")?.open).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
