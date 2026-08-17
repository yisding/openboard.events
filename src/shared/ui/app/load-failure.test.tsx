import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadFailure } from "./load-failure";

Object.assign(globalThis, { React });

const CSS = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

describe("LoadFailure", () => {
  it("announces what did not load and offers the way to ask again", () => {
    const html = renderToStaticMarkup(<LoadFailure message="Assignments could not be loaded." onRetry={() => undefined} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Assignments could not be loaded.");
    // One label for the whole product, matching the route-level error boundary.
    expect(html).toContain("Try again");
  });

  it("keeps the alert when there is nothing to retry, and says so while retrying", () => {
    // A terminal failure (gone, forbidden) still has to be announced; what it
    // must not do is offer a button that can only fail the same way again.
    const terminal = renderToStaticMarkup(<LoadFailure message="Submission not found" />);
    expect(terminal).toContain('role="alert"');
    expect(terminal).not.toContain("Try again");

    const retrying = renderToStaticMarkup(<LoadFailure message="Offline" onRetry={() => undefined} retrying />);
    expect(retrying).toContain("Retrying…");
    expect(retrying).toContain("disabled");
  });

  it("is styled once, and the full-surface variant is the same block", () => {
    expect(CSS).toMatch(/\.load-failure\{[^}]*grid-template-columns:16px 1fr auto/u);
    expect(CSS).toContain(".load-failure--surface{");
  });
});
