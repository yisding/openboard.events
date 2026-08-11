import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoProvider } from "@/shared/demo/demo-provider";
import { initialDemoState } from "@/shared/demo/seed";
import { SpeakerDrawer } from "./speakers-page";

Object.assign(globalThis, { React });

describe("SpeakerDrawer", () => {
  it("renders scheduled sessions in the explicit event timezone and uses non-submit confirmation buttons", () => {
    const speaker = initialDemoState.speakers.find((candidate) => candidate.id === "spk_alex");
    expect(speaker).toBeDefined();

    const html = renderToStaticMarkup(
      React.createElement(
        DemoProvider,
        null,
        React.createElement(SpeakerDrawer, {
          speaker: speaker ?? null,
          eventTimezone: "Pacific/Kiritimati",
          onClose: vi.fn(),
          onOpenPortal: vi.fn(),
          onConfirmation: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("Sep 16, 6:00 AM GMT+14");
    expect(html).not.toContain("Sep 15, 9:00 AM PDT");
    expect(html).toMatch(/<button type="button"[^>]*>unconfirmed<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>confirmed<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>declined<\/button>/);
  });
});
