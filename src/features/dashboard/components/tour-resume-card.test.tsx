/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { settle } from "@tests/support/react";
import { TourResumeCard } from "./TourResumeCard";

/**
 * The sixth untested dashboard component, and the only one with a handler.
 *
 * `dashboard-components.test.ts` proves the card *appears* on a paused demo
 * dashboard. What nobody checked is the thing it does when the organizer takes
 * it up on the offer — a compare-and-set against the server's cursor, a mirror
 * that has to be dropped before navigating, and a navigation that must happen
 * even when the write is refused. All three are silent when they break: the
 * page still moves, it just lands somewhere the tour is not.
 */
const apiMock = vi.hoisted(() => vi.fn());
const forgetTourMirrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/app/guided-tour/mirror", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/shared/ui/app/guided-tour/mirror")>(),
  forgetTourMirror: forgetTourMirrorMock,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const resumeHref = `/events/${eventId}/agenda?view=day`;
const props = {
  eventId,
  chapter: "the-grid",
  stepId: "grid.place",
  chapterLabel: "Chapter 7 of 11 — The grid",
  percent: 62,
  resumeHref,
};

let container: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;

function resumeButton(): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!button) throw new Error("The resume button is the card's only affordance");
  return button;
}

beforeEach(async () => {
  apiMock.mockReset();
  forgetTourMirrorMock.mockReset();
  assign = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<TourResumeCard {...props} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("TourResumeCard", () => {
  it("compares against the cursor the server is on, not the one this page was rendered with", async () => {
    // The organizer left the tour on another tab since this dashboard rendered.
    apiMock.mockResolvedValueOnce({ chapter: "the-grid", stepId: "grid.open", status: "paused" });
    apiMock.mockResolvedValueOnce({ chapter: "the-grid", stepId: "grid.place", status: "active" });

    await act(async () => resumeButton().click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/tour`);
    expect(apiMock.mock.calls[0]?.[2]).toBeUndefined();
    expect(apiMock.mock.calls[1]?.[2]).toMatchObject({
      method: "PATCH",
      // `grid.open`, the value that came back from the read — not `grid.place`
      // off the props. A compare-and-set that compares against a stale prop is
      // not a compare-and-set.
      body: { expectedStepId: "grid.open", chapter: "the-grid", stepId: "grid.place", status: "active" },
    });
    expect(assign).toHaveBeenCalledWith(resumeHref);
  });

  it("drops the local mirror before it navigates", async () => {
    apiMock.mockResolvedValue({ chapter: "the-grid", stepId: "grid.place", status: "active" });

    await act(async () => resumeButton().click());
    await settle();

    expect(forgetTourMirrorMock).toHaveBeenCalledWith(eventId);
    // Order matters: a mirror still sitting ahead of the row when the next page
    // boots is adopted on mount, and the engine would then narrate a step the
    // page it just landed on is not showing.
    expect(forgetTourMirrorMock.mock.invocationCallOrder[0] ?? Infinity)
      .toBeLessThan(assign.mock.invocationCallOrder[0] ?? -Infinity);
  });

  it("still puts the organizer on the step when the cursor write is refused", async () => {
    apiMock.mockRejectedValue(new Error("stale cursor"));

    await act(async () => resumeButton().click());
    await settle();

    // The row stays where it was, which is fine — the pill on the destination
    // page is what picks the tour back up from there. Stranding the organizer
    // on the dashboard would not be.
    expect(assign).toHaveBeenCalledWith(resumeHref);
    expect(forgetTourMirrorMock).toHaveBeenCalledWith(eventId);
  });

  it("takes one impatient double-click as one resume", async () => {
    let settleRead: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { settleRead = resolve; }));
    apiMock.mockResolvedValue({ chapter: "the-grid", stepId: "grid.place", status: "active" });

    await act(async () => resumeButton().click());
    expect(resumeButton().disabled).toBe(true);
    expect(resumeButton().textContent).toContain("Picking it up…");

    await act(async () => resumeButton().click());
    await act(async () => settleRead({ chapter: "the-grid", stepId: "grid.place", status: "paused" }));
    await settle();

    // One read plus one write. Two would race the compare-and-set against
    // itself and lose one of them for no reason.
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
