import { describe, expect, it } from "vitest";
import { sanitizeTemplateBody } from "@/features/comms/template-body";
import { templateBodyForMode } from "./template-body-mode";

describe("templateBodyForMode", () => {
  it("keeps literal source in HTML mode and crosses the shared sanitizer when returning to rich text", () => {
    const source = '<h2>Hello</h2><script>alert(1)</script><p><strong>Team</strong> <a href="https://example.com">details</a></p>';

    expect(templateBodyForMode(source, "html")).toBe(source);
    const rich = templateBodyForMode(source, "rich");
    expect(rich).toBe(sanitizeTemplateBody(source));
    expect(rich).toContain("<h2>Hello</h2>");
    expect(rich).toContain("<strong>Team</strong>");
    expect(rich).toContain('<a href="https://example.com">details</a>');
    expect(rich).not.toContain("script");
    expect(templateBodyForMode(rich, "rich")).toBe(rich);
  });

  it("preserves supported URL merge tokens while rejecting unsafe and non-URL hrefs", () => {
    const source = [
      '<a href="{{portal.magic_link}}">Portal</a>',
      "<a href='{{ unsubscribe.url }}'>Unsubscribe</a>",
      "<a href={{review.queue_url}}>Review</a>",
      '<a href="{{speaker.email}}">Not a URL token</a>',
      '<a href="javascript:alert(1)">Unsafe</a>',
    ].join("");

    const rich = templateBodyForMode(source, "rich");
    expect(rich).toContain('<a href="{{portal.magic_link}}">Portal</a>');
    expect(rich).toContain('<a href="{{unsubscribe.url}}">Unsubscribe</a>');
    expect(rich).toContain('<a href="{{review.queue_url}}">Review</a>');
    expect(rich).toContain("<a>Not a URL token</a>");
    expect(rich).toContain("<a>Unsafe</a>");
  });
});
