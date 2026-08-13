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
});
