import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmbedDisabledNotice } from "./embed-disabled-notice";

Object.assign(globalThis, { React });

describe("EmbedDisabledNotice", () => {
  // #676: "sessions list" and "schedule itinerary" read as generated,
  // grammatically off labels once dropped into "This {label} is...". Every
  // embed surface's label must read as a natural sentence.
  it.each([
    ["agenda", "This agenda is not currently available."],
    ["session list", "This session list is not currently available."],
    ["schedule", "This schedule is not currently available."],
    ["speaker list", "This speaker list is not currently available."],
    ["speaker gallery", "This speaker gallery is not currently available."],
  ])("renders %j as %j", (label, expected) => {
    const html = renderToStaticMarkup(React.createElement(EmbedDisabledNotice, { label }));
    expect(html).toContain(expected);
  });
});
