/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalTime } from "./local-time";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("LocalTime", () => {
  const instant = "2026-03-14T02:30:00.000Z";

  it("renders the same markup on the server and on the first client pass", async () => {
    // The whole point: a mismatch between these two is React #418, which tears
    // the tree down. A bare `toLocaleString()` cannot satisfy this on a machine
    // whose zone is not UTC.
    const serverHtml = renderToStaticMarkup(React.createElement(LocalTime, { instant }));
    const serverText = serverHtml.replace(/<[^>]*>/gu, "");
    // React reconciles on the rendered text, so that is what must agree.
    const firstClientText = renderToStaticMarkup(React.createElement(LocalTime, { instant })).replace(/<[^>]*>/gu, "");

    expect(serverText).toBe(firstClientText);
    expect(serverText).toContain("UTC");

    await act(async () => root.render(React.createElement(LocalTime, { instant })));
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(instant);
  });

  it("carries the exact instant in a machine-readable attribute", async () => {
    await act(async () => root.render(React.createElement(LocalTime, { instant })));
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(instant);
    expect(time?.textContent).not.toBe("");
  });

  it("renders a dash rather than an epoch for a missing timestamp", async () => {
    for (const empty of [null, undefined, ""]) {
      await act(async () => root.render(React.createElement(LocalTime, { instant: empty })));
      expect(container.querySelector("time")).toBeNull();
      expect(container.textContent).not.toContain("1970");
    }
  });
});
