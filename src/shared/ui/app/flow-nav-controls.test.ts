import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlowNavControls } from "./flow-nav-controls";

Object.assign(globalThis, { React });

describe("FlowNavControls", () => {
  it("announces the newly active record and its position", () => {
    const html = renderToStaticMarkup(React.createElement(FlowNavControls, {
      index: 2,
      total: 9,
      itemLabel: "Ada Lovelace",
      onPrev: () => undefined,
      onNext: () => undefined,
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("Viewing Ada Lovelace, ");
    expect(html).toContain("3 of 9");
  });
});
