/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventId } from "@/shared/contracts";
import { FIXTURE_OVERVIEW } from "../__fixtures__/overview";
import { MilestoneBanner } from "./MilestoneBanner";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderBanner() {
  await act(async () => root.render(
    <MilestoneBanner eventId={FIXTURE_OVERVIEW.event.id as EventId} overview={FIXTURE_OVERVIEW} />,
  ));
}

describe("MilestoneBanner", () => {
  it("persists a dismissal for this event and milestone", async () => {
    await renderBanner();
    expect(container.textContent).toContain("Your first submission arrived");

    const dismiss = container.querySelector<HTMLButtonElement>('[aria-label="Dismiss Your first submission arrived"]');
    if (!dismiss) throw new Error("First-submission dismissal was not rendered");
    await act(async () => dismiss.click());

    expect(window.localStorage.getItem(`openboard:milestone-seen:${FIXTURE_OVERVIEW.event.id}:first_submission`)).toBe("1");
    expect(container.textContent).not.toContain("Your first submission arrived");

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await renderBanner();
    expect(container.textContent).not.toContain("Your first submission arrived");
  });
});
