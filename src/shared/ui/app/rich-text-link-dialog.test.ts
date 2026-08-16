import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { richTextLinkError } from "./rich-text-link";

describe("rich-text link dialog", () => {
  it("accepts the same safe protocols as the editor link extension", () => {
    expect(richTextLinkError("https://example.com/path")).toBe("");
    expect(richTextLinkError("http://example.com")).toBe("");
    expect(richTextLinkError("mailto:speaker@example.com")).toBe("");
    expect(richTextLinkError("  https://example.com  ")).toBe("");
  });

  it("returns inline guidance for empty and unsafe links", () => {
    expect(richTextLinkError(" ")).toBe("Enter a link URL.");
    expect(richTextLinkError("https://")).toBe("Enter a complete link URL.");
    expect(richTextLinkError("mailto:")).toBe("Enter a complete link URL.");
    expect(richTextLinkError("javascript:alert(1)")).toBe("Use an http://, https://, or mailto: link.");
    expect(richTextLinkError("example.com")).toBe("Use an http://, https://, or mailto: link.");
  });

  it("uses the designed modal flow instead of native browser dialogs", () => {
    const source = readFileSync(new URL("./rich-text-editor.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.alert");
    expect(source).toContain("<Modal");
    expect(source).toContain('label="Link URL"');
    expect(source).toContain("initialFocusRef={linkInputRef}");
    expect(source).not.toContain("<form");
    expect(source).toContain('event.key !== "Enter"');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("requestAnimationFrame");
  });

  it("restores focus when shared dialogs unmount", () => {
    const uiKit = readFileSync(new URL("../ui-kit.tsx", import.meta.url), "utf8");
    const commandPalette = readFileSync(new URL("../../../features/shell/components/command-palette.tsx", import.meta.url), "utf8");

    // Both shared dialogs — modal and drawer — restore focus on unmount. They
    // now do it through `focusAfterClose`, which keeps the opener when the
    // opener survives and falls back to its nearest surviving ancestor when a
    // destructive confirm unmounted it; see dialog-focus-return.test.ts.
    expect(uiKit.match(/focusAfterClose\(returnFocus, returnFocusAncestors\)/gu)).toHaveLength(2);
    expect(uiKit).toContain("if (opener?.isConnected) { opener.focus(); return opener; }");
    expect(commandPalette).toContain("returnFocus.focus()");
  });
});
