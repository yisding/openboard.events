import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicBuildMarker } from "./public-build-marker";

Object.assign(globalThis, { React });

describe("PublicBuildMarker", () => {
  it("puts the generating deployment identity inside cached HTML", () => {
    const html = renderToStaticMarkup(React.createElement(PublicBuildMarker, { deploymentId: "run-123" }));
    expect(html).toContain('data-openboard-deployment="run-123"');
  });
});
