import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BulkActionBar } from "./bulk-action-bar";

Object.assign(globalThis, { React });

describe("BulkActionBar", () => {
  it("keeps its compatible default count and accepts page-scoped wording", () => {
    expect(renderToStaticMarkup(<BulkActionBar count={2} onClear={() => undefined} />)).toContain("2 selected");
    expect(renderToStaticMarkup(<BulkActionBar count={2} countLabel="2 selected on this page" onClear={() => undefined} />))
      .toContain("2 selected on this page");
  });

  it("keeps zero-count notes and trailing actions visible", () => {
    const html = renderToStaticMarkup(<BulkActionBar
      count={0}
      onClear={() => undefined}
      emptyNote={<span>3 decisions queued</span>}
      trailing={<button type="button">Notify 3</button>}
    />);
    expect(html).toContain("3 decisions queued");
    expect(html).toContain("Notify 3");
    expect(html).not.toContain(">Clear<");
  });

  it("pins under the admin topbar instead of being trapped in a non-scrolling panel", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    // `overflow:hidden` makes .data-panel the sticky bar's nearest scrollport, and
    // that panel never scrolls — so the offset can never engage. `clip` is not a
    // scroll container and still clips the panel chrome.
    expect(css).toContain(".data-panel{overflow:clip");
    expect(css).not.toContain(".data-panel{overflow:hidden");
    expect(css).toContain(".bulk-bar{position:sticky;z-index:15;top:var(--admin-topbar-height)");
  });
});
