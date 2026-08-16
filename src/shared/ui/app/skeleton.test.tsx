import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonText } from "./skeleton";

Object.assign(globalThis, { React });

const CSS = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

describe("SkeletonText", () => {
  it("draws the shape of the text and leaves the words to the live region", () => {
    const html = renderToStaticMarkup(<SkeletonText lines={3} label="Loading review history…" />);

    expect(html.match(/route-skeleton skeleton-text__line/gu) ?? []).toHaveLength(3);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    // The announcement survives the redesign; only the grey paragraph goes.
    expect(html).toContain('<span class="sr-only">Loading review history…</span>');
    expect(html).not.toContain("<p");
  });

  it("shares the route-level skeleton's sweep, so every placeholder animates alike", () => {
    expect(renderToStaticMarkup(<Skeleton className="route-skeleton--title" />))
      .toContain('class="route-skeleton route-skeleton--title"');
    expect(CSS).toContain(".skeleton-text{display:grid;gap:9px;margin:12px 0}");
    expect(CSS).toContain(".skeleton-text__line{height:12px}");
    expect(CSS).toMatch(/\.route-skeleton\{[^}]*animation:skeleton-sweep/u);
  });
});
