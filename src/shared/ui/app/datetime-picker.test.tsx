import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateTimePicker } from "./datetime-picker";

Object.assign(globalThis, { React });

describe("DateTimePicker", () => {
  it("uses the themed picker action while preserving the native date-time input", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {
      value: "2026-09-15T16:30:00.000Z",
      onChange: () => undefined,
      tz: "America/Los_Angeles",
      invalid: true,
      ariaDescribedBy: "event-end-error",
    }));

    expect(html).toContain('class="datetime-picker is-invalid"');
    expect(html).toContain('value="2026-09-15T09:30"');
    expect(html).toContain('aria-describedby="event-end-error"');
    expect(html).toContain('aria-label="Open date and time picker"');
    expect(html).toContain('class="datetime-picker-button"');
    expect(html).toContain('class="datetime-zone"');
  });

  it("names the date-only action and disables it with its input", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {
      value: null,
      onChange: () => undefined,
      tz: "UTC",
      mode: "date",
      disabled: true,
    }));

    expect(html).toContain('class="datetime-picker is-disabled"');
    expect(html).toContain('aria-label="Open date picker"');
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });
});
