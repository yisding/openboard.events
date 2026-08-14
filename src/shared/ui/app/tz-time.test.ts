import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatTzTime, TzTime } from "./tz-time";

Object.assign(globalThis, { React });

describe("TzTime", () => {
  it("appends a zone label to Intl style shortcuts", () => {
    expect(formatTzTime(
      "2026-10-15T19:00:00.000Z",
      "America/Los_Angeles",
      { dateStyle: "medium" },
    )).toBe("Oct 15, 2026 PDT");
    expect(formatTzTime(
      "2026-10-15T19:00:00.000Z",
      "America/Los_Angeles",
      { timeStyle: "short" },
    )).toBe("12:00 PM PDT");
  });

  it("renders one zone token across a two-line table timestamp", () => {
    const html = renderToStaticMarkup(React.createElement(TzTime, {
      instant: "2026-10-15T19:00:00.000Z",
      tz: "America/Los_Angeles",
      style: "date",
      secondary: "time",
    }));

    expect(html).toContain("Oct 15, 2026<small>12:00 PM PDT</small>");
    expect(html.match(/PDT/gu)).toHaveLength(1);
  });

  it("omits a repeated zone only when its surrounding view supplies that context", () => {
    const html = renderToStaticMarkup(React.createElement(TzTime, {
      instant: "2026-10-15T19:00:00.000Z",
      tz: "America/Los_Angeles",
      style: { hour: "numeric", minute: "2-digit" },
      zoneDisplay: "context",
    }));

    expect(html).toContain(">12:00 PM</time>");
    expect(html).not.toContain("PDT");
  });
});
