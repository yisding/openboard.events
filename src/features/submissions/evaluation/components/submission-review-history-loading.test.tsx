/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "@tests/support/react";
import { SubmissionReviewHistory } from "./submission-review-history";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4200000-0000-4000-8000-000000000001";
const SUBMISSION_ID = "c4200000-0000-4000-8000-000000000002";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(<SubmissionReviewHistory eventId={EVENT_ID} submissionId={SUBMISSION_ID} timezone="America/Los_Angeles" />);
  });
}

describe("abstract drawer review history while loading", () => {
  it("holds the space with a skeleton instead of a line of grey text", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    await render();

    expect(container.querySelector(".skeleton-text")).not.toBeNull();
    expect(container.querySelectorAll(".skeleton-text__line")).toHaveLength(2);
    // The words move into the live region rather than disappearing.
    expect(container.querySelector(".skeleton-text .sr-only")?.textContent).toBe("Loading review history…");
    expect(container.querySelector("p.muted")?.textContent).not.toContain("Loading");
  });

  it("replaces the skeleton with the feed once it arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { entries: [] } }), { status: 200 })));

    await render();
    await settle();

    expect(container.querySelector(".skeleton-text")).toBeNull();
    expect(container.textContent).toContain("No scores have been saved for this submission.");
  });
});
