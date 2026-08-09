import { describe, expect, it } from "vitest";
import { sanitize, WIDE_IFRAME_HOSTS } from "./sanitize";

describe("sanitize", () => {
  it("strips executable tags and attributes", () => {
    expect(sanitize("<script>alert(1)</script><p>Safe</p>")).toBe("<p>Safe</p>");
    expect(sanitize('<img src="x" onerror="alert(1)">')).toBe("");
    expect(sanitize('<a href="javascript:alert(1)">bad</a>')).toBe("<a>bad</a>");
  });

  it("allows an allowlisted HTTPS iframe only in the wide profile", () => {
    const iframe = '<iframe src="https://player.vimeo.com/video/123" allowfullscreen></iframe>';
    expect(sanitize(iframe)).toBe("");
    expect(sanitize(iframe, { profile: "wide" })).toContain("player.vimeo.com");
    expect(WIDE_IFRAME_HOSTS).toContain("docs.google.com");
  });

  it.each([
    '<iframe src="http://www.youtube.com/embed/x"></iframe>',
    '<iframe src="https://evil.example/embed/x"></iframe>',
    '<iframe src="https://www.youtube.com/embed/x" srcdoc="<script>alert(1)</script>"></iframe>',
  ])("removes an unsafe wide iframe: %s", (iframe) => {
    expect(sanitize(iframe, { profile: "wide" })).toBe("");
  });

  it("keeps the long-form document set only in wide mode", () => {
    const document = '<hr><table><tbody><tr><th>A</th><td>B</td></tr></tbody></table><img src="https://example.com/x.png" alt="x">';
    expect(sanitize(document)).not.toContain("<table>");
    expect(sanitize(document)).not.toContain("<img");
    const wide = sanitize(document, { profile: "wide" });
    expect(wide).toContain("<table>");
    expect(wide).toContain("https://example.com/x.png");
  });

  it("is idempotent", () => {
    const value = '<h2>Hello</h2><p><strong>World</strong> <a href="https://example.com">link</a></p>';
    expect(sanitize(sanitize(value))).toBe(sanitize(value));
  });
});
