import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./ui-kit";
import { STATUS_BADGES, type StatusBadgeValue } from "./status-badge";

describe("StatusBadge", () => {
  it("gives the four submission outcomes distinct semantic tones", () => {
    expect([
      STATUS_BADGES.accepted.tone,
      STATUS_BADGES.accept_queue.tone,
      STATUS_BADGES.pending.tone,
      STATUS_BADGES.declined.tone,
    ]).toEqual(["success", "queued", "review", "danger"]);
  });

  it("renders every accepted value with an authored label and a defined tone rule", () => {
    const stylesheet = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");

    for (const value of Object.keys(STATUS_BADGES) as StatusBadgeValue[]) {
      const definition = STATUS_BADGES[value];
      const markup = renderToStaticMarkup(createElement(StatusBadge, { value }));
      const className = `status-tone-${definition.tone}`;

      expect(markup).toContain(`class="status-badge ${className}"`);
      expect(markup).toContain(definition.label);
      expect(stylesheet).toContain(`.${className}`);
    }
  });

  it("never turns a backend queue enum into visible copy", () => {
    const markup = renderToStaticMarkup(createElement(StatusBadge, { value: "accept_queue" }));
    expect(markup).toContain("Queued to accept");
    expect(markup).not.toContain(">accept_queue<");
  });
});
