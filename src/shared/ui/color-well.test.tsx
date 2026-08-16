import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColorWell } from "./ui-kit";

Object.assign(globalThis, { React });

const CSS = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("ColorWell", () => {
  it("keeps the native picker and gives it the kit's trigger", () => {
    const html = renderToStaticMarkup(
      <ColorWell aria-label="Accent color" value="#00a878" onChange={() => {}} />,
    );

    // Native input, native OS dialog — the DD-2 bargain the date picker already
    // makes. What must not survive is the UA's own swatch chrome.
    expect(html).toContain('type="color"');
    expect(html).toContain('class="color-well"');
    expect(html).toContain('aria-label="Accent color"');
  });

  it("keeps an author-supplied class alongside the kit's", () => {
    const html = renderToStaticMarkup(<ColorWell className="vocab-color" value="#00a878" readOnly />);

    expect(html).toContain('class="color-well vocab-color"');
  });

  it("replaces the UA swatch frame in both engines", () => {
    expect(CSS).toContain(".color-well::-webkit-color-swatch-wrapper { padding: 0; }");
    expect(CSS).toContain(".color-well::-webkit-color-swatch { border: 0; border-radius: 5px; }");
    expect(CSS).toContain(".color-well::-moz-color-swatch { border: 0; border-radius: 5px; }");
  });
});
