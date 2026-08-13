import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessagePreview } from "./message-preview";

Object.assign(globalThis, { React });

describe("MessagePreview", () => {
  it("renders compact chrome, subject metadata, then the message body in order", () => {
    const html = renderToStaticMarkup(<MessagePreview
      label="LIVE PREVIEW"
      hint="Updates as you type"
      message={{ subject: "Your proposal was received", bodyHtml: "<p>Hello Ada</p>" }}
    />);

    expect(html.indexOf("template-preview-heading")).toBeLessThan(html.indexOf("template-preview-subject"));
    expect(html.indexOf("template-preview-subject")).toBeLessThan(html.indexOf("template-preview-body"));
    expect(html).toContain("<small>Subject</small>");
    expect(html).toContain("<b>Your proposal was received</b>");
    expect(html).toContain("<p>Hello Ada</p>");
  });

  it("uses the same contained surface for loading and recovery states", () => {
    const html = renderToStaticMarkup(<MessagePreview
      label="PREVIEW"
      hint="Rendered for the selected recipient"
      status="Rendering…"
    />);

    expect(html).toContain("template-preview-heading");
    expect(html).toContain('class="template-preview-status"');
    expect(html).not.toContain("template-preview-message");
  });

  it("offers the delivered plain-text alternative when the preview includes it", () => {
    const html = renderToStaticMarkup(<MessagePreview
      label="LIVE PREVIEW"
      hint="Updates as you type"
      message={{
        subject: "Your proposal was received",
        bodyHtml: "<p>Hello Ada</p>",
        bodyText: "AI Engineer\n\nHello Ada\n\nAI Engineer · Unsubscribe",
      }}
    />);

    expect(html).toContain('role="group" aria-label="Preview format"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">HTML</button>");
    expect(html).toContain(">Plain text</button>");
    expect(html).toContain("AI Engineer\n\nHello Ada\n\nAI Engineer · Unsubscribe");
    expect(html).toContain("template-preview-plain-text");
  });

  it("keeps previews without a text alternative unchanged", () => {
    const html = renderToStaticMarkup(<MessagePreview
      label="PREVIEW"
      hint="Rendered for the selected recipient"
      message={{ subject: "Hello", bodyHtml: "<p>Hello Ada</p>" }}
    />);

    expect(html).not.toContain("Preview format");
    expect(html).not.toContain("Plain text");
  });
});
