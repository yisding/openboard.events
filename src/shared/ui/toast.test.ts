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

  it("renders a named action separately from the dismiss control", () => {
    const html = renderToStaticMarkup(React.createElement(ToastMessage, {
      message: "Session moved",
      kind: "success",
      action: { label: "Undo", onClick: () => undefined },
      onDismiss: () => undefined,
    }));

    expect(html).toContain('class="toast-action"');
    expect(html).toContain(">Undo</button>");
    expect(html).toContain('class="toast-dismiss"');
    expect(html).toContain('aria-label="Dismiss “Session moved”"');
  });
});
