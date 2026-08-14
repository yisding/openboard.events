import { describe, expect, it } from "vitest";
import { sanitize } from "@/shared/lib/sanitize";
import { templateBodyForMode } from "./template-body-mode";

describe("templateBodyForMode", () => {
  it("keeps literal source in HTML mode and crosses the shared sanitizer when returning to rich text", () => {
    const source = '<h2>Hello</h2><script>alert(1)</script><p><strong>Team</strong> <a href="https://example.com">details</a></p>';

    expect(templateBodyForMode(source, "html")).toBe(source);
    const rich = templateBodyForMode(source, "rich");
    expect(rich).toBe(sanitize(source));
    expect(rich).toContain("<h2>Hello</h2>");
    expect(rich).toContain("<strong>Team</strong>");
    expect(rich).toContain('<a href="https://example.com">details</a>');
    expect(rich).not.toContain("script");
    expect(templateBodyForMode(rich, "rich")).toBe(rich);
  });
});
