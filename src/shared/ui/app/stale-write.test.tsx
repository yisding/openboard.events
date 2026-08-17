import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaleWriteNotice, staleWriteConfirm } from "./stale-write";

Object.assign(globalThis, { React });

describe("StaleWriteNotice", () => {
  it("announces the conflict, keeps the draft, and only offers to replace it", () => {
    const html = renderToStaticMarkup(<StaleWriteNotice subject="template" onLoadLatest={() => undefined} />);

    // A 409 arrives after the writer has already looked away from Save, so it
    // has to be announced rather than merely drawn.
    expect(html).toContain('role="alert"');
    expect(html).toContain("This template changed since you opened it.");
    expect(html).toContain("Your draft is still here.");
    // There is no "overwrite anyway": the writer cannot see what they would
    // be replacing, so the only offers are keep-mine and load-theirs.
    expect(html).toContain("Load latest");
    expect(html).not.toContain("Save anyway");
  });

  it("names the thing that changed in both halves of the pattern", () => {
    expect(renderToStaticMarkup(<StaleWriteNotice subject="task" onLoadLatest={() => undefined} />))
      .toContain("Load the latest task only when you are ready");
    expect(staleWriteConfirm("task")).toMatchObject({
      title: "Load the latest task?",
      confirmLabel: "Load latest",
      variant: "stale",
    });
    expect(staleWriteConfirm("event").body).toContain("This cannot be undone.");
  });
});
