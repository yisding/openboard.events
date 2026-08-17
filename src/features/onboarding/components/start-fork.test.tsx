/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationIdSchema } from "@/shared/contracts";
import { demoProvisionStateSchema, type DemoProvisionStateDTO } from "../demo-schemas";
import { StartFork, startForkVariant } from "./start-fork";
import { visibleProvisioningPhases } from "./demo-provisioning-screen";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const organizationId = organizationIdSchema.parse("30000000-0000-4000-8000-000000000001");
const eventId = "40000000-0000-4000-8000-000000000001";

function state(overrides: Partial<DemoProvisionStateDTO> = {}): DemoProvisionStateDTO {
  return demoProvisionStateSchema.parse({
    eventId,
    eventSlug: "ai-engineer-worlds-fair-demo-a1b2c3d4",
    phase: "event",
    phaseIndex: 1,
    phaseCount: 10,
    label: "Booking Moscone West and eight tracks…",
    done: false,
    ...overrides,
  });
}

const ready = state({ phase: "ready", phaseIndex: 10, label: "Your conference is ready.", done: true });

describe("StartFork", () => {
  it("offers two doors of equal weight and one escape hatch to a brand-new organization", () => {
    const html = renderToStaticMarkup(<StartFork organizationId={organizationId} />);

    expect(startForkVariant(null)).toBe("first-run");
    expect(html).toContain("Explore a finished conference");
    expect(html).toContain("Set up my own event");
    // The claims the provisioner actually keeps — a tutorial whose first
    // verifiable statement is false has spent its whole argument.
    expect(html).toContain("18 speakers, 24 proposals");
    expect(html).toContain("None of it is real");
    // Explicit create intent, so the wizard renders instead of this fork.
    expect(html).toContain(`href="/organizations/${organizationId}/onboarding?mode=create"`);
    // A query parameter, not a cookie: App Router cannot set one during a render.
    expect(html).toContain(`href="/organizations/${organizationId}?skip=1"`);
    expect(html).toContain("Skip both");
    // The escape hatch is a real link, not plain inherited-ink text: it needs
    // its own accent styling since it sits outside the two button-chrome doors.
    expect(html).toContain(`<a class="onboarding-skip-link" href="/organizations/${organizationId}?skip=1">Skip both`);
  });

  it("sends an organization that already has a finished demo back into it", () => {
    const html = renderToStaticMarkup(<StartFork organizationId={organizationId} demo={ready} />);

    expect(startForkVariant(ready)).toBe("demo-exists");
    expect(html).toContain(`href="/events/${eventId}/dashboard"`);
    expect(html).toContain("Back to your demo conference");
    // The own-event door never disappears: the demo is the point of departure.
    expect(html).toContain("Set up my own event");
  });

  it("resumes a half-built demo instead of offering to start one again", () => {
    const html = renderToStaticMarkup(<StartFork organizationId={organizationId} demo={state({ phase: "agenda", phaseIndex: 7, label: "Building a schedule with two problems in it…" })} />);

    expect(html).toContain("Building AI Engineer World");
    expect(html).not.toContain("Explore a finished conference");
  });
});

describe("DemoProvisioningScreen", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    pushMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(payload: DemoProvisionStateDTO) {
    return { ok: true, status: 200, json: async () => ({ data: payload }) };
  }

  it("narrates only what has happened, and marks the running phase", () => {
    const lines = visibleProvisioningPhases(state({ phase: "forms", phaseIndex: 3 }), false);

    expect(lines.map((line) => line.key)).toEqual(["event", "people", "forms"]);
    expect(lines.map((line) => line.state)).toEqual(["done", "done", "running"]);
    // The copy is the provisioner's own, so narration cannot drift from what
    // the server actually wrote.
    expect(lines[0]?.label).toContain("Moscone West");
  });

  it("turns the running line amber when a phase will not take", () => {
    const lines = visibleProvisioningPhases(state({ phase: "agenda", phaseIndex: 7 }), true);

    expect(lines.at(-1)?.state).toBe("failed");
    expect(lines.filter((line) => line.state === "done")).toHaveLength(6);
  });

  it("ticks every line once the world is ready", () => {
    expect(visibleProvisioningPhases(ready, false).every((line) => line.state === "done")).toBe(true);
  });

  it("drives one request per phase and hands off to the demo's dashboard", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(state({ phase: "people", phaseIndex: 2 })))
      .mockResolvedValueOnce(respond(ready));

    const container = document.createElement("div");
    document.body.append(container);
    let root: Root | undefined;
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(<StartFork organizationId={organizationId} demo={state()} />);
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/internal/organizations/${organizationId}/demo`);
      expect(pushMock).toHaveBeenCalledWith(`/events/${eventId}/dashboard`);
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it("offers a retry and a way past a phase that fails, and never apologizes generically", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL", message: "nope" } }) });

    const container = document.createElement("div");
    document.body.append(container);
    let root: Root | undefined;
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(<StartFork organizationId={organizationId} demo={state()} />);
      });

      const text = container.textContent ?? "";
      expect(text).toContain("Try that step again");
      expect(text).toContain("Continue without it");
      expect(text).not.toContain("Something went wrong");
      expect(pushMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });
});
