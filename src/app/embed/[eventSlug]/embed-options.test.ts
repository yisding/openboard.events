import { describe, expect, it } from "vitest";
import { DEFAULT_EMBED_OPTIONS } from "@/features/public/public-event-shell";
import { resolveEmbedOptions } from "./embed-options";

// See embed-options.ts's top comment: this is the caching-regression fix
// (status.md rev. 11) — style now comes from the saved `embeds.style` DB row
// instead of `searchParams`, which is what let the five `/embed/**` routes
// stop reading `searchParams` and become edge-cacheable like `/e/**`.
describe("resolveEmbedOptions", () => {
  it("falls back to the product defaults for an unconfigured (empty) style row", () => {
    expect(resolveEmbedOptions({})).toEqual(DEFAULT_EMBED_OPTIONS);
  });

  it("carries an admin-saved theme, header, and accent through", () => {
    expect(resolveEmbedOptions({ theme: "dark", showHeader: false, accent: "#123abc" })).toEqual({
      theme: "dark",
      header: false,
      accent: "#123abc",
    });
  });

  it("treats any non-'dark' theme value as light", () => {
    expect(resolveEmbedOptions({ theme: undefined }).theme).toBe("light");
  });

  it("rejects a malformed accent and falls back to the default rather than passing it through to an inline style", () => {
    expect(resolveEmbedOptions({ accent: "javascript:alert(1)" }).accent).toBe(DEFAULT_EMBED_OPTIONS.accent);
    expect(resolveEmbedOptions({ accent: "red" }).accent).toBe(DEFAULT_EMBED_OPTIONS.accent);
  });

  it("accepts every hex shorthand the admin color input can produce", () => {
    for (const accent of ["#abc", "#abcd", "#aabbcc", "#aabbccdd"]) {
      expect(resolveEmbedOptions({ accent }).accent).toBe(accent);
    }
  });
});
