import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpeakerStatusOptions } from "./speaker-status-options";

Object.assign(globalThis, { React });

describe("speaker status selection accessibility", () => {
  it("renders one named button group whose current value is programmatically pressed", () => {
    const html = renderToStaticMarkup(
      <SpeakerStatusOptions
        label="Speaker confirmation status"
        options={["unconfirmed", "confirmed", "declined"]}
        value="confirmed"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('role="group" aria-label="Speaker confirmation status"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true" class="active"[^>]*>confirmed<\/button>/);
  });

  it("uses the shared pressed-state control for confirmation and pipeline status", () => {
    const detail = readFileSync(new URL("./speaker-detail-view.tsx", import.meta.url), "utf8");
    const roster = readFileSync(new URL("./speaker-roster-panels.tsx", import.meta.url), "utf8");

    expect(detail).toContain('<SpeakerStatusOptions');
    expect(detail).toContain('label="Speaker confirmation status"');
    expect(roster).toContain('<SpeakerStatusOptions');
    expect(roster).toContain('label="Speaker pipeline status"');
  });

  it("models combinable speaker-list filters as pressed buttons, with All active only when no chip filter is active", () => {
    const source = readFileSync(new URL("./speakers-admin-view.tsx", import.meta.url), "utf8");

    expect(source).toContain('role="group" aria-label="Filter speakers"');
    expect(source).toContain('aria-pressed={!accepted && !missing}');
    expect(source).toContain('setParams({ accepted: null, missing: null })');
    expect(source).not.toContain('className="abstract-status-tabs" role="tablist"');
  });
});
