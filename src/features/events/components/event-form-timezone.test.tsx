/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./event-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

/**
 * `TimeZoneSelect`'s own tests render it bare. These render it where it
 * actually ships, because everything the call site cares about travels through
 * the wrapper's rest spread — including the `required` that
 * `accessibility-form-metadata.test.ts` audits by JSX tag name, one level of
 * indirection away from the DOM control that has to carry it.
 */
describe("EventForm timezone control", () => {
  it("ships one option before hydration, still labelled and still required", () => {
    const html = renderToStaticMarkup(<EventForm />);
    const start = html.indexOf('id="event-timezone"');
    expect(start).toBeGreaterThan(-1);
    const control = html.slice(start, html.indexOf("</select>", start));

    expect(control.match(/<option /gu) ?? []).toHaveLength(1);
    expect(control).toContain('value="America/Los_Angeles"');
    expect(control).toContain('name="timezone"');
    expect(control).toContain("required");
    // The IANA id is the value; the visible text is the readable label.
    expect(control).not.toContain(">America/Los_Angeles</option>");
  });

  it("expands to the full zone list on hydration without losing its form metadata", () => {
    act(() => root.render(<EventForm />));
    const select = container.querySelector<HTMLSelectElement>("#event-timezone");

    expect(select).not.toBeNull();
    expect(select?.name).toBe("timezone");
    expect(select?.required).toBe(true);
    expect(select?.disabled).toBe(false);
    expect(select?.value).toBe("America/Los_Angeles");
    expect(select?.options.length).toBeGreaterThan(100);
    expect(select?.selectedOptions[0]?.textContent).toMatch(/Los Angeles$/u);
  });
});
