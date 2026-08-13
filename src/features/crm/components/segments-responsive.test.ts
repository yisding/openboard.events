import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CRM segment card actions", () => {
  it("lets the header and its action group wrap on narrow cards", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    const header = css.match(/\.crm-segment-card header\{([^}]*)\}/)?.[1] ?? "";
    const actions = css.match(/\.crm-segment-card-actions\{([^}]*)\}/)?.[1] ?? "";

    expect(header).toContain("flex-wrap:wrap");
    expect(actions).toContain("flex-wrap:wrap");
  });
});
