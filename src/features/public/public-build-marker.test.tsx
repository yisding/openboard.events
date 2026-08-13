import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicBuildMarker } from "./public-build-marker";

Object.assign(globalThis, { React });

describe("PublicBuildMarker", () => {
  it("puts the generating build identity inside cached HTML", () => {
    expect(renderToStaticMarkup(React.createElement(PublicBuildMarker, { sha: "abc123" })))
      .toBe('<span hidden="" data-openboard-build="abc123"></span>');
  });
});
