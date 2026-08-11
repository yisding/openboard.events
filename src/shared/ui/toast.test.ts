import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastMessage } from "./toast";

Object.assign(globalThis, { React });

describe("ToastMessage", () => {
  it("announces successes politely", () => {
    const html = renderToStaticMarkup(React.createElement(ToastMessage, { message: "Saved", kind: "success", onDismiss: () => undefined }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("announces failures assertively without success iconography", () => {
    const html = renderToStaticMarkup(React.createElement(ToastMessage, { message: "Save failed", kind: "error", onDismiss: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("lucide-circle-alert");
    expect(html).not.toContain("lucide-circle-check-big");
  });
});
