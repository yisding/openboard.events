/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Switch } from "./ui-kit";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

function SwitchFixture() {
  const [published, setPublished] = useState(true);
  return <>
    <Switch label="Published" checked={published} onClick={() => setPublished((current) => !current)} />
    <Switch label="Locked setting" checked={false} disabled onClick={() => undefined} />
  </>;
}

async function renderFixture(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<SwitchFixture />));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

describe("Switch", () => {
  it("exposes its name and checked state and updates them through interaction", async () => {
    const container = await renderFixture();
    const published = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Published"]');
    if (!published) throw new Error("Published switch did not render");

    expect(published.getAttribute("aria-checked")).toBe("true");
    expect(published.classList.contains("on")).toBe(true);
    await act(async () => published.click());
    expect(published.getAttribute("aria-checked")).toBe("false");
    expect(published.classList.contains("on")).toBe(false);
  });

  it("forwards native disabled behavior", async () => {
    const container = await renderFixture();
    const locked = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Locked setting"]');
    if (!locked) throw new Error("Locked switch did not render");

    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute("aria-checked")).toBe("false");
  });
});
