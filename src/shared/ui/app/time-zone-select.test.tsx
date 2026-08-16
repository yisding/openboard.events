/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimeZoneSelect } from "./time-zone-select";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

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
});

function mount(value: string) {
  act(() => root.render(<TimeZoneSelect value={value} onChange={() => {}} />));
  const select = container.querySelector("select");
  if (!select) throw new Error("no select rendered");
  return select;
}

describe("TimeZoneSelect", () => {
  it("server-renders only the selected zone, so no ICU-derived label can break hydration", () => {
    // Every label is CLDR data from the *rendering* runtime, and the runtime
    // that renders the HTML is never the browser that hydrates it: shipping the
    // whole list means shipping ~419 chances for the two ICU builds to disagree
    // and for React to throw the server tree away.
    const html = renderToStaticMarkup(<TimeZoneSelect value="Antarctica/Palmer" onChange={() => {}} />);

    expect(html.match(/<option /gu) ?? []).toHaveLength(1);
    expect(html).toContain('value="Antarctica/Palmer"');
    expect(html).toContain('selected=""');
  });

  it("offers the full zone list once the browser has hydrated it", () => {
    const select = mount("Europe/London");

    expect(select.options.length).toBeGreaterThan(100);
    expect(select.value).toBe("Europe/London");
    expect([...select.options].map((option) => option.value)).toContain("UTC");
    // Readable labels, never the raw identifier.
    expect(select.selectedOptions[0]?.textContent).toMatch(/London$/u);
    expect(select.selectedOptions[0]?.textContent).not.toContain("/");
  });

  it("keeps an option for a stored zone this runtime no longer lists", () => {
    // Otherwise the control renders blank while the draft still holds a value,
    // and the first save silently rewrites the event's timezone.
    const select = mount("Mars/Olympus_Mons");

    expect(select.value).toBe("Mars/Olympus_Mons");
    expect(select.options[0]?.value).toBe("Mars/Olympus_Mons");
  });
});
