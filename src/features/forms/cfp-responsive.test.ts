import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CFP progress responsive styles", () => {
  it("compacts only the progress labels and connectors through 760px", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const marker = "/* Five labelled CFP steps no longer fit";
    const markerIndex = css.indexOf(marker);
    const breakpointIndex = css.lastIndexOf("@media(max-width:760px){", markerIndex);
    const breakpointEnd = css.indexOf("\n}", markerIndex);

    expect(markerIndex).toBeGreaterThan(breakpointIndex);
    expect(breakpointIndex).toBeGreaterThanOrEqual(0);
    expect(breakpointEnd).toBeGreaterThan(markerIndex);
    expect(css.slice(markerIndex, breakpointEnd)).toContain(".cfp-progress b{display:none}");
    expect(css.slice(markerIndex, breakpointEnd)).toContain(".cfp-progress i{width:25px;margin:0 6px}");
  });
});
