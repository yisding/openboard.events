import { describe, expect, it } from "vitest";
import { sanitize } from "./sanitize";

describe("sanitize", () => {
  it("strips executable content", () => {
    expect(sanitize("<script>alert(1)</script><p>Safe</p>")).toBe("<p>Safe</p>");
    expect(sanitize('<a href="javascript:alert(1)">bad</a>')).not.toContain("javascript:");
  });
  it("allows iframe embeds only for resources", () => {
    const iframe = '<iframe src="https://player.example.com/demo" allowfullscreen></iframe>';
    expect(sanitize(iframe)).toBe("");
    expect(sanitize(iframe, "wide")).toContain("iframe");
  });
  it("drops author-supplied rel and normalizes target links", () => {
    const result = sanitize('<a href="https://example.com" rel="opener" target="_blank">x</a>');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).not.toContain('rel="opener"');
  });
  it("is idempotent", () => {
    const value = "<h2>Hello</h2><p><strong>World</strong></p>";
    expect(sanitize(sanitize(value))).toBe(sanitize(value));
  });
});
